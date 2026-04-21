import { assertLicenseActive } from './licenseRuntime'
import { telegramManager, memberToSendTarget } from './telegram'
import { memberDisplayLabel, formatRecipientDisplayLabel } from './recipientLabels'
import { buildSchedulerErrorLogParts, buildSchedulerSuccessLogParts } from './errorLogHelpers'
import { formatUserFacingTelegramError } from './telegramErrorMessages'
import { ScheduledMessage } from '@/store/appStore'
import { varyMessageAntiSpam } from '@/lib/antiSpamText'
import { liveLog, trunc } from '@/lib/botLiveLog'

/** Zamanlayıcıdaki mesajlar/hesaplar arası (ms) değerine göre her beklemede rastgele süre; üst/alt sınır otomatik. */
function randomAntiSpamGapMs(baseMs: number): number {
  const b = Math.max(2000, baseMs)
  const lo = Math.max(2500, Math.round(b * 0.45))
  const hi = Math.max(lo + 2000, Math.round(b * 2.85))
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function randomAntiSpamTailMs(): number {
  return 500 + Math.floor(Math.random() * 1700)
}

type SchedulerTemplate = { content: string; name?: string; antiSpamDelay?: boolean }

export type SchedulerOnProgressMeta = {
  completedKey?: string
  /** Bitiş zamanı doldu; çoklu tur modunda gönderim başlamadan kapat */
  repeatWindowEnded?: boolean
  /** Kullanıcı durdurdu; çoklu tur tekrarlanmaz */
  userStopped?: boolean
  /**
   * false: bağlantı vb. yüzünden tüm alıcı sırası tamamlanmadı — çoklu tur (repeatUntil) tekrarlanmamalı,
   * aksi halde kısmi tur “bitti” sanılıp liste başa sarılıyor.
   */
  fullPassComplete?: boolean
}

export type SchedulerOnProgress = (
  id: string,
  sent: number,
  total: number,
  done?: boolean,
  meta?: SchedulerOnProgressMeta
) => void

/** Alıcıları sırayla hesaplara böler; ilk kalan öğeler ilk hesaplara düşer. */
function splitRecipientsAcrossAccounts<T>(items: T[], accountCount: number): T[][] {
  const chunks: T[][] = Array.from({ length: Math.max(0, accountCount) }, () => [])
  if (accountCount <= 0 || items.length === 0) return chunks
  const n = items.length
  const base = Math.floor(n / accountCount)
  const remainder = n % accountCount
  let start = 0
  for (let i = 0; i < accountCount; i++) {
    const size = i < remainder ? base + 1 : base
    chunks[i] = items.slice(start, start + size)
    start += size
  }
  return chunks
}

class MessageScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map()
  private activeJobs: Map<string, boolean> = new Map()
  private activeExecutions: Set<string> = new Set() // Çalışan executeMessage'ları takip et

  async scheduleMessage(
    scheduledMessage: ScheduledMessage,
    getMessageTemplate: (id: string) => SchedulerTemplate | undefined,
    /** done: executeMessage bittiğinde true (kısmi başarı dahil — UI isActive kapatır) */
    onProgress?: SchedulerOnProgress,
    getAccountInfo?: (accountId: string) => { sessionString?: string; phoneNumber?: string } | undefined,
    addErrorLog?: (log: {
      accountId: string
      accountPhoneNumber?: string
      username: string
      recipientDisplayName?: string
      message: string
      timestamp: Date
      logType: 'error' | 'success' | 'info'
      errorType?: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other'
      summary?: string
      detail?: string
      hint?: string
    }) => void,
    /** executeMessage tamamen çökünce (ör. grup üyeleri alınamadı) */
    onExecutionError?: (error: unknown, messageId: string) => void
  ): Promise<void> {
    const lic = await assertLicenseActive()
    if (!lic.ok) {
      console.warn('⚠️ Zamanlayıcı: lisans yok veya geçersiz:', lic.reason)
      liveLog('warn', 'Zamanlayıcı: lisans kontrolü başarısız', lic.reason)
      return
    }

    console.log('🔵 scheduleMessage çağrıldı:', scheduledMessage.id)
    
    if (this.activeJobs.get(scheduledMessage.id)) {
      console.log('⚠️ Mesaj zaten aktif, tekrar zamanlanmıyor:', scheduledMessage.id)
      liveLog('info', 'Bu plan zaten çalışıyor — tekrar kuyruğa alınmadı', `id: ${scheduledMessage.id}`)
      return
    }

    this.activeJobs.set(scheduledMessage.id, true)

    const now = new Date().getTime()
    const scheduledTime = new Date(scheduledMessage.scheduledTime).getTime()
    const delay = Math.max(0, scheduledTime - now)

    liveLog(
      'step',
      'Mesaj gönderim işlemi başlatıldı',
      `Plan #${scheduledMessage.id} · ${delay <= 100 ? 'hemen çalıştırılıyor' : `~${Math.round(delay / 1000)} sn sonra tetiklenecek`}`
    )

    console.log('⏰ Zamanlama detayları:', {
      id: scheduledMessage.id,
      now: new Date(now).toISOString(),
      scheduledTime: new Date(scheduledTime).toISOString(),
      delay: delay,
      delaySeconds: Math.floor(delay / 1000),
      delayMinutes: Math.floor(delay / 60000),
      isPast: delay === 0
    })

    // Zamanı geçmişse veya çok yakınsa hemen gönder
    if (delay <= 100) {
      // 100ms içindeyse hemen gönder
      console.log('⚡ Zaman geldi veya geçti, hemen gönderiliyor:', scheduledMessage.id)
      liveLog('step', 'Planlanan zaman geldi — gönderim motoru başlıyor', `id: ${scheduledMessage.id}`)
      try {
        await this.executeMessage(
          scheduledMessage,
          getMessageTemplate,
          onProgress,
          getAccountInfo,
          addErrorLog
        )
        console.log('✅ Mesaj gönderimi tamamlandı:', scheduledMessage.id)
      } catch (error) {
        console.error('❌ Mesaj gönderim hatası:', scheduledMessage.id, error)
        const raw = error instanceof Error ? error.message : String(error)
        liveLog('err', 'Gönderim hatası (anında çalıştırma)', trunc(raw, 200))
        onExecutionError?.(
          new Error(formatUserFacingTelegramError(raw, 'general')),
          scheduledMessage.id
        )
      } finally {
        this.activeJobs.delete(scheduledMessage.id)
        const executionKey = `exec_${scheduledMessage.id}`
        this.activeExecutions.delete(executionKey)
      }
      return
    }

    // Gelecekteki mesajlar için timer oluştur
    liveLog(
      'info',
      'Zamanlayıcı kuruldu — bekleniyor',
      `~${Math.round(delay / 1000)} sn · ${new Date(scheduledTime).toLocaleString('tr-TR')}`
    )
    const timer = setTimeout(async () => {
      try {
        liveLog('step', 'Zamanlayıcı tetiklendi — gönderim başlıyor', `id: ${scheduledMessage.id}`)
        console.log('✅ ZAMAN GELDİ! Mesaj gönderiliyor:', scheduledMessage.id, 'Zaman:', new Date(scheduledMessage.scheduledTime).toISOString())
        console.log('📋 Mesaj detayları:', {
          accountIds: scheduledMessage.accountIds,
          usernames: scheduledMessage.usernames,
          templateId: scheduledMessage.messageTemplateId
        })
        await this.executeMessage(scheduledMessage, getMessageTemplate, onProgress, getAccountInfo, addErrorLog)
        console.log('✅ Mesaj gönderimi tamamlandı:', scheduledMessage.id)
      } catch (error) {
        console.error('❌ Mesaj gönderim hatası:', scheduledMessage.id, error)
        console.error('❌ Hata detayları:', error)
        const raw = error instanceof Error ? error.message : String(error)
        liveLog('err', 'Gönderim hatası (zamanlanmış çalıştırma)', trunc(raw, 200))
        onExecutionError?.(
          new Error(formatUserFacingTelegramError(raw, 'general')),
          scheduledMessage.id
        )
      } finally {
        this.activeJobs.delete(scheduledMessage.id)
        this.timers.delete(scheduledMessage.id)
        // Execution flag'ini de temizle
        const executionKey = `exec_${scheduledMessage.id}`
        this.activeExecutions.delete(executionKey)
        console.log('🧹 Timer temizlendi:', scheduledMessage.id)
      }
    }, delay)
    
    console.log('⏱️ Timer oluşturuldu:', scheduledMessage.id, 'Delay:', delay, 'ms', 'Zaman:', new Date(scheduledTime).toISOString())

    this.timers.set(scheduledMessage.id, timer)
    console.log('📝 Aktif timer sayısı:', this.timers.size)
  }

  private async executeMessage(
    scheduledMessage: ScheduledMessage,
    getMessageTemplate: (id: string) => SchedulerTemplate | undefined,
    /** done: executeMessage bittiğinde true (kısmi başarı dahil — UI isActive kapatır) */
    onProgress?: SchedulerOnProgress,
    getAccountInfo?: (accountId: string) => { sessionString?: string; phoneNumber?: string; apiId?: string; apiHash?: string } | undefined,
    addErrorLog?: (log: {
      accountId: string
      accountPhoneNumber?: string
      username: string
      recipientDisplayName?: string
      message: string
      timestamp: Date
      logType: 'error' | 'success' | 'info'
      errorType?: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other'
      summary?: string
      detail?: string
      hint?: string
    }) => void
  ): Promise<void> {
    const lic = await assertLicenseActive()
    if (!lic.ok) {
      console.warn('⚠️ executeMessage: lisans yok veya geçersiz:', lic.reason)
      liveLog('warn', 'executeMessage durdu: lisans', lic.reason)
      return
    }

    console.log('🚀 ========== executeMessage BAŞLADI ==========')
    console.log('🚀 Mesaj ID:', scheduledMessage.id)
    
    // Çift çalışmayı önle - eğer bu mesaj zaten çalışıyorsa, işlemi durdur
    if (!this.activeJobs.get(scheduledMessage.id)) {
      console.warn('⚠️ Mesaj aktif değil, executeMessage iptal ediliyor:', scheduledMessage.id)
      liveLog('warn', 'Gönderim iptal — plan artık aktif değil', scheduledMessage.id)
      return
    }
    
    // Çalışan mesaj kontrolü - eğer başka bir executeMessage çalışıyorsa bekle
    const executionKey = `exec_${scheduledMessage.id}`
    if (this.activeExecutions.has(executionKey)) {
      console.warn('⚠️ Bu mesaj zaten çalışıyor, tekrar çalıştırma iptal ediliyor:', scheduledMessage.id)
      liveLog('info', 'Aynı plan için gönderim zaten sürüyor — çift çalıştırma yok', scheduledMessage.id)
      return
    }
    
    // Execution flag'ini set et
    this.activeExecutions.add(executionKey)
    console.log('📋 Mesaj detayları:', {
      id: scheduledMessage.id,
      messageTemplateId: scheduledMessage.messageTemplateId,
      accountIds: scheduledMessage.accountIds,
      accountCount: scheduledMessage.accountIds.length,
      usernames: scheduledMessage.usernames,
      usernameCount: scheduledMessage.usernames.length,
      delayBetweenMessages: scheduledMessage.delayBetweenMessages,
      delayBetweenAccounts: scheduledMessage.delayBetweenAccounts,
      isActive: scheduledMessage.isActive
    })
    
    const template = getMessageTemplate(scheduledMessage.messageTemplateId)
    if (!template) {
      console.error('❌ ========== ŞABLON BULUNAMADI ==========')
      console.error('❌ Mesaj şablonu bulunamadı:', scheduledMessage.messageTemplateId)
      console.error('❌ Scheduled message:', scheduledMessage)
      liveLog('err', 'Şablon bulunamadı — gönderim durdu', scheduledMessage.messageTemplateId)
      throw new Error(`Mesaj şablonu bulunamadı: ${scheduledMessage.messageTemplateId}`)
    }

    liveLog('step', 'Şablon yüklendi, alıcılar hazırlanıyor', template.name || scheduledMessage.messageTemplateId)

    console.log('✅ Şablon bulundu:', {
      templateId: scheduledMessage.messageTemplateId,
      templateName: template.name || 'İsimsiz',
      contentLength: template.content.length,
      contentPreview: template.content.substring(0, 100) + '...'
    })

    const useAntiSpam = template.antiSpamDelay === true

    const recipientMode = scheduledMessage.recipientMode ?? 'manual'
    type RecipientRow = { target: string; displayLabel: string }
    let recipients: RecipientRow[] = scheduledMessage.usernames.map((t) => ({
      target: t,
      displayLabel: formatRecipientDisplayLabel(t),
    }))

    if (recipientMode === 'group_members' && scheduledMessage.groupTarget) {
      liveLog(
        'step',
        'Grup üyeleri Telegram’dan çekiliyor',
        trunc(scheduledMessage.groupTarget.title, 80)
      )
      const firstAccountId =
        scheduledMessage.groupListAccountId ?? scheduledMessage.accountIds[0]
      const accountInfo = getAccountInfo?.(firstAccountId)
      if (!accountInfo?.sessionString) {
        this.activeExecutions.delete(executionKey)
        liveLog('err', 'Grup modu: hesap oturumu yok', firstAccountId)
        throw new Error('Grup üyeleri alınamadı: ilk hesabın oturumu yok')
      }
      const res = await telegramManager.getGroupParticipants(
        firstAccountId,
        accountInfo.sessionString,
        accountInfo.phoneNumber,
        accountInfo.apiId,
        accountInfo.apiHash,
        scheduledMessage.groupTarget
      )
      if (!res.success || !res.members?.length) {
        this.activeExecutions.delete(executionKey)
        liveLog('err', 'Grup üyeleri alınamadı', trunc(res.error || 'Bilinmeyen', 160))
        throw new Error(res.error || 'Üye listesi alınamadı')
      }
      liveLog('ok', `Üye listesi alındı: ${res.members.length} kayıt`, 'Botlar ve eksik kimlikler sonradan elenir')
      recipients = res.members
        .map((m) => {
          const target = memberToSendTarget(m)
          if (!target) return null
          return { target, displayLabel: memberDisplayLabel(m) }
        })
        .filter((x): x is RecipientRow => x !== null)
      if (recipients.length === 0) {
        this.activeExecutions.delete(executionKey)
        throw new Error('Gönderilecek üye yok (tümü bot veya kimlik eksik)')
      }
    }

    const accountIds = scheduledMessage.accountIds
    const distribution = scheduledMessage.accountDistribution ?? 'each_to_all'
    const perAccountRecipients: RecipientRow[][] =
      distribution === 'split_recipients'
        ? splitRecipientsAcrossAccounts(recipients, accountIds.length)
        : accountIds.map(() => recipients)
    const totalCount =
      distribution === 'split_recipients'
        ? recipients.length
        : accountIds.length * recipients.length

    const repeatEndMs = scheduledMessage.repeatUntil
      ? new Date(scheduledMessage.repeatUntil).getTime()
      : NaN
    if (Number.isFinite(repeatEndMs) && Date.now() >= repeatEndMs) {
      liveLog('info', 'Çoklu tur: bitiş zamanı geldi — gönderim yapılmadan kapatılıyor', scheduledMessage.id)
      this.activeExecutions.delete(executionKey)
      onProgress?.(scheduledMessage.id, 0, totalCount, true, { repeatWindowEnded: true })
      return
    }

    const taskKeysForMessage = new Set<string>()
    for (let ai = 0; ai < accountIds.length; ai++) {
      const aid = accountIds[ai]
      for (const row of perAccountRecipients[ai] ?? []) {
        taskKeysForMessage.add(`${aid}::${row.target}`)
      }
    }
    const completedKeySet = new Set(
      (scheduledMessage.completedSendKeys ?? []).filter((k) => taskKeysForMessage.has(k))
    )
    let sentCount = completedKeySet.size

    if (taskKeysForMessage.size > 0 && completedKeySet.size === taskKeysForMessage.size) {
      console.log('✅ Tüm gönderimler önceki oturumda tamamlanmış (anahtarlar eşleşti), atlanıyor')
      liveLog('ok', 'Bu planda zaten tüm başarılı gönderimler tamamlanmış — atlanıyor', scheduledMessage.id)
      this.activeExecutions.delete(executionKey)
      onProgress?.(scheduledMessage.id, sentCount, totalCount, true, { fullPassComplete: true })
      return
    }

    if (completedKeySet.size > 0) {
      liveLog(
        'info',
        `Önceki oturumdan ${completedKeySet.size} başarılı gönderim atlanacak`,
        'Çift mesaj önleniyor'
      )
    }

    liveLog(
      'step',
      'Gönderim planı hazır',
      `${totalCount} mesaj · ${accountIds.length} hesap · ${distribution === 'split_recipients' ? 'alıcılar bölündü' : 'her hesap tüm alıcılara'}`
    )

    console.log('📊 ========== GÖNDERİM PLANI ==========')
    console.log('📊 Plan detayları:', {
      accountDistribution: distribution,
      accountCount: accountIds.length,
      usernameCount: recipients.length,
      totalMessages: totalCount,
      antiSpamRandomGaps: useAntiSpam,
      delayBetweenMessages: scheduledMessage.delayBetweenMessages,
      delayBetweenMessagesSeconds: scheduledMessage.delayBetweenMessages / 1000,
      delayBetweenAccounts: scheduledMessage.delayBetweenAccounts,
      delayBetweenAccountsSeconds: scheduledMessage.delayBetweenAccounts / 1000
    })

    console.log('🔄 ========== HESAPLAR DÖNGÜSÜ BAŞLADI ==========')
    console.log('🔄 Toplam hesap sayısı:', accountIds.length)
    console.log('🔄 Hesap ID\'leri:', accountIds)
    
    // Tüm hesaplar için başarısız grupları takip et
    const globalFailedGroups = new Set<string>()

    /** Tüm (hesap × alıcı) sırası denendi mi; erken çıkışta çoklu tur tekrarını engellemek için */
    let fullPassComplete = true

    for (let ai = 0; ai < accountIds.length; ai++) {
      const accountId = accountIds[ai]
      const accountRecipients = perAccountRecipients[ai] ?? []
      const accountIndex = ai + 1
      if (accountRecipients.length === 0) {
        liveLog(
          'info',
          `Hesap ${accountIndex}/${accountIds.length}: atanmış alıcı yok`,
          distribution === 'split_recipients'
            ? 'Bölünmüş listede bu hesaba düşen alıcı yok — atlanıyor (gönderim sayılmaz)'
            : 'Atlanıyor'
        )
      }
      liveLog(
        'step',
        `Hesap sırası ${accountIndex}/${accountIds.length}`,
        `Hesap ${trunc(accountId, 24)} · bu turda ${accountRecipients.length} alıcı`
      )
      console.log('👤 ========== HESAP İŞLENİYOR ==========')
      console.log('👤 Hesap bilgileri:', {
        accountId,
        accountIndex,
        totalAccounts: accountIds.length,
        remainingAccounts: accountIds.length - accountIndex
      })
      
      let accountHasCriticalError = false // Oturum/bağlantı: bu hesap için gönderim anlamsız
      let accountErrorMessages: string[] = [] // Bu hesap için alınan hatalar
      
      console.log('🔄 ========== KULLANICI/GRUP DÖNGÜSÜ BAŞLADI ==========')
      console.log('🔄 Bu hesap için alıcı sayısı:', accountRecipients.length)
      console.log('🔄 Alıcılar:', accountRecipients.map((r) => ({ hedef: r.target, etiket: r.displayLabel })))
      
      for (let i = 0; i < accountRecipients.length; i++) {
        const { target, displayLabel } = accountRecipients[i]
        // Eğer bu hesap kritik hata aldıysa, bu hesap için döngüyü kır
        if (accountHasCriticalError) {
          console.log('⏰ Bu hesap kritik oturum/bağlantı hatası aldı, diğer alıcılara geçilmiyor:', accountId)
          break
        }
        
        // Eğer bu grup daha önce başarısız olduysa, atla
        if (globalFailedGroups.has(target)) {
          console.log(`⏭️ Bu grup daha önce başarısız oldu, atlanıyor:`, target)
          continue
        }

        const pairKey = `${accountId}::${target}`
        if (completedKeySet.has(pairKey)) {
          console.log('⏭️ Önceden gönderilmiş (sayfa yenileme sonrası devam), atlanıyor:', pairKey)
          continue
        }

        liveLog(
          'step',
          'Sıradaki alıcı için hazırlanıyor',
          `${trunc(displayLabel, 48)} · ilerleme ${sentCount}/${totalCount}`
        )

        const usernameIndex = i + 1
        console.log('📨 ========== MESAJ GÖNDERİMİ BAŞLADI ==========')
        console.log('📨 Mesaj bilgileri:', {
          accountId,
          username: target,
          displayLabel,
          usernameIndex,
          totalUsernames: accountRecipients.length,
          accountIndex,
          totalAccounts: accountIds.length,
          currentProgress: `${sentCount}/${totalCount}`
        })
        
        if (!this.activeJobs.get(scheduledMessage.id)) {
          console.log('⚠️ Mesaj durduruldu, gönderim iptal ediliyor:', scheduledMessage.id)
          liveLog('warn', 'Gönderim durduruldu (durdur veya iptal)', scheduledMessage.id)
          break
        }

        // Telegram ban önleme: sabit veya (şablonda) rastgele aralık
        const baseGap = scheduledMessage.delayBetweenMessages
        const gapMs = useAntiSpam ? randomAntiSpamGapMs(baseGap) : baseGap
        liveLog(
          'info',
          `Mesajlar arası bekleme: ~${(gapMs / 1000).toFixed(1)} sn`,
          useAntiSpam ? 'Anti-spam: rastgele aralık' : 'Sabit gecikme'
        )
        console.log(
          '⏳ Mesajlar arası gecikme başlıyor:',
          gapMs,
          'ms',
          useAntiSpam ? `(anti-spam, taban ${baseGap}ms)` : ''
        )
        await this.delay(gapMs)
        console.log('⏳ Mesajlar arası gecikme tamamlandı')

        try {
          const outgoingText = useAntiSpam ? varyMessageAntiSpam(template.content) : template.content

          liveLog(
            'step',
            'Telegram’a gönderim isteği gönderiliyor',
            `${trunc(displayLabel, 40)} · ${trunc(template.name || 'Şablon', 32)}`
          )

          console.log('📤 Mesaj gönderiliyor:', {
            accountId,
            username: target,
            displayLabel,
            template: template.name || 'İsimsiz',
            contentPreview: outgoingText.substring(0, 50) + '...',
            antiSpamText: useAntiSpam,
          })
          
          // Account bilgilerini al (session string, phone number ve API bilgileri için)
          const accountInfo = getAccountInfo ? getAccountInfo(accountId) : undefined
          console.log('📋 Account bilgileri:', {
            accountId,
            hasSessionString: !!accountInfo?.sessionString,
            sessionStringLength: accountInfo?.sessionString?.length || 0,
            phoneNumber: accountInfo?.phoneNumber || 'YOK',
            hasApiId: !!accountInfo?.apiId,
            hasApiHash: !!accountInfo?.apiHash,
            apiId: accountInfo?.apiId || 'YOK',
            apiHash: accountInfo?.apiHash ? `${accountInfo.apiHash.substring(0, 10)}...` : 'YOK'
          })
          
          if (!accountInfo) {
            console.error('❌ Account bilgileri bulunamadı!', accountId)
          }
          
          if (!accountInfo?.sessionString) {
            console.error('❌ Session string yok!', accountId)
          }
          
          if (!accountInfo?.apiId || !accountInfo?.apiHash) {
            console.warn('⚠️ API bilgileri eksik!', {
              accountId,
              hasApiId: !!accountInfo?.apiId,
              hasApiHash: !!accountInfo?.apiHash
            })
          }

          const result = await telegramManager.sendMessage(
            accountId,
            target,
            outgoingText,
            accountInfo?.sessionString,
            accountInfo?.phoneNumber,
            accountInfo?.apiId,
            accountInfo?.apiHash
          )

          console.log('📥 Gönderim sonucu:', {
            accountId,
            username: target,
            success: result.success,
            error: result.error
          })

          if (result.success) {
            sentCount++
            completedKeySet.add(pairKey)
            console.log('✅ ========== MESAJ BAŞARILI ==========')
            console.log('✅ Mesaj başarıyla gönderildi:', accountId, '->', displayLabel, `(${sentCount}/${totalCount})`)
            
            // Başarılı log ekle
            if (addErrorLog) {
              const accountInfo = getAccountInfo ? getAccountInfo(accountId) : undefined
              const okParts = buildSchedulerSuccessLogParts(
                displayLabel,
                sentCount,
                totalCount,
                template.name,
                target
              )
              addErrorLog({
                accountId,
                accountPhoneNumber: accountInfo?.phoneNumber,
                username: target,
                recipientDisplayName: displayLabel,
                message: okParts.message,
                summary: okParts.summary,
                detail: okParts.detail,
                hint: okParts.hint,
                timestamp: new Date(),
                logType: 'success'
              })
            }
            
            liveLog(
              'ok',
              'Gönderim başarılı — sıradaki adıma geçiliyor',
              `${sentCount}/${totalCount} · ${trunc(displayLabel, 48)}`
            )
            onProgress?.(scheduledMessage.id, sentCount, totalCount, false, { completedKey: pairKey })

            console.log('📨 ========== MESAJ GÖNDERİMİ TAMAMLANDI ==========')
            console.log('📨 Son durum:', {
              accountId,
              username: target,
              displayLabel,
              sentCount,
              totalCount,
              progress: `${sentCount}/${totalCount}`,
            })

            const tailMs = useAntiSpam ? randomAntiSpamTailMs() : 1000
            console.log('⏳ Ek gecikme başlıyor:', tailMs, 'ms')
            await this.delay(tailMs)
            console.log('⏳ Ek gecikme tamamlandı')
          } else {
            liveLog(
              'warn',
              'Gönderim başarısız — sıradaki alıcıya geçiliyor',
              `${trunc(displayLabel, 48)} · ${trunc(result.error || 'Hata', 120)}`
            )
            console.error('❌ ========== MESAJ BAŞARISIZ ==========')
            console.error('❌ Mesaj gönderilemedi:', accountId, '->', displayLabel)
            console.error('❌ Hata mesajı:', result.error)
            console.error('❌ Detaylar:', {
              accountId,
              username: target,
              error: result.error,
              currentProgress: `${sentCount}/${totalCount}`
            })
            
            // Hata mesajını kaydet
            if (result.error) {
              accountErrorMessages.push(`${displayLabel}: ${result.error}`)
              
              const errorMsg = result.error || ''
              const errParts = buildSchedulerErrorLogParts(errorMsg, displayLabel, target)

              // Error log ekle
              if (addErrorLog) {
                const accountInfo = getAccountInfo ? getAccountInfo(accountId) : undefined
                addErrorLog({
                  accountId,
                  accountPhoneNumber: accountInfo?.phoneNumber,
                  username: target,
                  recipientDisplayName: displayLabel,
                  message: errParts.message,
                  summary: errParts.summary,
                  detail: errParts.detail,
                  hint: errParts.hint,
                  timestamp: new Date(),
                  logType: 'error',
                  errorType: errParts.errorType,
                })
              }
              
              // Bu grup için başarısız işaretle (sadece grup hataları için)
              // Rate limit veya connection hatası hesap seviyesinde, banned grup seviyesinde olabilir
              if (errParts.errorType === 'banned' || errParts.errorType === 'other' || errParts.errorType === 'peer') {
                globalFailedGroups.add(target)
                console.log(`⏭️ Grup başarısız işaretlendi, diğer hesaplar için atlanacak:`, target)
              }
            }
            
            // Oturum/bağlantı: dur. Diğer tüm hatalar (flood dahil): beklemeden sıradaki alıcı.
            const errorMsg = result.error || ''
            const isRateLimit =
              errorMsg.includes('rate limit') ||
              errorMsg.includes('Rate limit') ||
              errorMsg.includes('wait of') ||
              errorMsg.includes('beklenmesi gerekiyor') ||
              errorMsg.includes('FLOOD_WAIT')

            const isConnectionError =
              errorMsg.includes('bağlı değil') ||
              errorMsg.includes('session bilgisi bulunamadı') ||
              errorMsg.includes('yeniden bağlanılamadı') ||
              errorMsg.includes('client bulunamadı')

            if (isConnectionError) {
              console.error('🔌 Bağlantı hatası, bu hesap için gönderim durduruluyor:', accountId)
              accountHasCriticalError = true
              fullPassComplete = false
              console.error('⏰ Bu hesap için diğer mesajlar atlanacak, diğer hesaplara geçilecek')
              break
            }

            if (isRateLimit) {
              liveLog(
                'warn',
                'Hız limiti — beklemeden sıradaki gruba geçiliyor',
                trunc(displayLabel, 48)
              )
            }

            continue
          }
        } catch (error) {
          console.error('❌ ========== MESAJ GÖNDERME EXCEPTION ==========')
          console.error('❌ Exception:', accountId, '->', displayLabel)
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error('❌ Hata detayları:', {
            error: errorMsg,
            stack: error instanceof Error ? error.stack : 'No stack',
            errorObject: error,
            accountId,
            username: target,
          })
          
          // Exception'ı da hata listesine ekle
          accountErrorMessages.push(`${displayLabel}: Exception - ${errorMsg}`)
          
          const em = errorMsg.toLowerCase()
          const connEx =
            em.includes('bağlı değil') ||
            (em.includes('session') && (em.includes('bulunamadı') || em.includes('invalid')))
          if (connEx) {
            console.error('🔌 Oturum/bağlantı exception, bu hesap için gönderim durduruluyor:', accountId)
            accountHasCriticalError = true
            fullPassComplete = false
            break
          }
          const floodEx =
            em.includes('rate limit') ||
            em.includes('flood_wait') ||
            (em.includes('wait of') && em.includes('second'))
          if (floodEx) {
            liveLog('warn', 'Hız limiti (istisna) — sıradaki gruba geçiliyor', trunc(displayLabel, 48))
          }

          continue
        }
      }
      
      console.log('🔄 ========== KULLANICI/GRUP DÖNGÜSÜ TAMAMLANDI ==========')

      // Her hesap arasında delay
      if (ai < accountIds.length - 1) {
        const accBase = scheduledMessage.delayBetweenAccounts
        const accGap = useAntiSpam ? randomAntiSpamGapMs(accBase) : accBase
        liveLog(
          'info',
          `Hesaplar arası bekleme: ~${(accGap / 1000).toFixed(1)} sn`,
          'Sıradaki hesaba geçiliyor'
        )
        console.log(
          '⏳ Hesaplar arası gecikme başlıyor:',
          accGap,
          'ms',
          useAntiSpam ? `(anti-spam, taban ${accBase}ms)` : ''
        )
        await this.delay(accGap)
        console.log('⏳ Hesaplar arası gecikme tamamlandı')
      }
      
      console.log('👤 ========== HESAP İŞLEMİ TAMAMLANDI ==========')
      console.log('👤 Hesap özeti:', {
        accountId,
        accountIndex,
        totalAccounts: accountIds.length,
        sentCount,
        totalCount,
        progress: `${sentCount}/${totalCount}`,
        accountHasCriticalError,
        errorCount: accountErrorMessages.length
      })
      
      // Eğer bu hesap sorun çıkardıysa, logla
      if (accountHasCriticalError || accountErrorMessages.length > 0) {
        console.error('⚠️ ========== SORUN ÇIKARAN HESAP ==========')
        console.error('⚠️ Hesap ID:', accountId)
        console.error('⚠️ Sorun türü:', {
          criticalError: accountHasCriticalError,
          errorCount: accountErrorMessages.length
        })
        console.error('⚠️ Hata mesajları:', accountErrorMessages)
        console.error('⚠️ Bu hesap atlandı, diğer hesaplarla devam ediliyor')
      }
    }

    console.log('✅ ========== executeMessage TAMAMLANDI ==========')
    console.log('✅ Özet:', {
      scheduledMessageId: scheduledMessage.id,
      sentCount,
      totalCount,
      progress: `${sentCount}/${totalCount}`,
      successRate: totalCount > 0 ? `${Math.round((sentCount / totalCount) * 100)}%` : '0%'
    })
    
    // Tüm mesajlar gönderildiyse veya işlem tamamlandıysa, son ilerleme güncellemesini yap
    // Not: Bazı mesajlar atlanmış olabilir (failed groups), bu yüzden sentCount < totalCount olabilir
    // Ama tüm hesaplar işlendi, bu yüzden mesaj tamamlandı sayılır
    console.log('🎉 Mesaj gönderimi tamamlandı!', scheduledMessage.id)
    liveLog(
      'ok',
      'Gönderim turu tamamlandı',
      `Plan ${scheduledMessage.id} · başarılı: ${sentCount}/${totalCount}`
    )
    
    const aborted = !this.activeJobs.get(scheduledMessage.id)
    this.activeExecutions.delete(`exec_${scheduledMessage.id}`)

    if (aborted) {
      onProgress?.(scheduledMessage.id, sentCount, totalCount, true, { userStopped: true })
      return
    }

    onProgress?.(scheduledMessage.id, sentCount, totalCount, true, { fullPassComplete })
  }

  cancelMessage(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
    const wasActive = this.activeJobs.get(id)
    this.activeJobs.delete(id)
    if (wasActive) {
      liveLog(
        'warn',
        timer ? 'Bekleyen zamanlayıcı iptal edildi' : 'Gönderim durduruldu',
        `Plan ${id}`
      )
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  isMessageActive(id: string): boolean {
    return this.activeJobs.get(id) || false
  }
}

export const messageScheduler = new MessageScheduler()

