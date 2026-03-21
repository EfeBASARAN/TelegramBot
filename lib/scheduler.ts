import { telegramManager } from './telegram'
import { ScheduledMessage } from '@/store/appStore'

class MessageScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map()
  private activeJobs: Map<string, boolean> = new Map()
  private activeExecutions: Set<string> = new Set() // Çalışan executeMessage'ları takip et

  async scheduleMessage(
    scheduledMessage: ScheduledMessage,
    getMessageTemplate: (id: string) => { content: string; name?: string } | undefined,
    onProgress?: (id: string, sent: number, total: number) => void,
    getAccountInfo?: (accountId: string) => { sessionString?: string; phoneNumber?: string } | undefined,
    addErrorLog?: (log: { accountId: string; accountPhoneNumber?: string; username: string; message: string; timestamp: Date; logType: 'error' | 'success' | 'info'; errorType?: 'rate_limit' | 'banned' | 'connection' | 'other' }) => void
  ): Promise<void> {
    console.log('🔵 scheduleMessage çağrıldı:', scheduledMessage.id)
    
    if (this.activeJobs.get(scheduledMessage.id)) {
      console.log('⚠️ Mesaj zaten aktif, tekrar zamanlanmıyor:', scheduledMessage.id)
      return
    }

    this.activeJobs.set(scheduledMessage.id, true)

    const now = new Date().getTime()
    const scheduledTime = new Date(scheduledMessage.scheduledTime).getTime()
    const delay = Math.max(0, scheduledTime - now)

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
    if (delay <= 100) { // 100ms içindeyse hemen gönder
      console.log('⚡ Zaman geldi veya geçti, hemen gönderiliyor:', scheduledMessage.id)
      this.executeMessage(scheduledMessage, getMessageTemplate, onProgress, getAccountInfo, addErrorLog)
        .then(() => {
          console.log('✅ Mesaj gönderimi tamamlandı:', scheduledMessage.id)
          this.activeJobs.delete(scheduledMessage.id)
          // Execution flag'ini de temizle
          const executionKey = `exec_${scheduledMessage.id}`
          this.activeExecutions.delete(executionKey)
        })
        .catch((error) => {
          console.error('❌ Mesaj gönderim hatası:', scheduledMessage.id, error)
          console.error('❌ Hata detayları:', error)
          this.activeJobs.delete(scheduledMessage.id)
          // Execution flag'ini de temizle
          const executionKey = `exec_${scheduledMessage.id}`
          this.activeExecutions.delete(executionKey)
        })
      return
    }

    // Gelecekteki mesajlar için timer oluştur
    const timer = setTimeout(async () => {
      try {
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
    getMessageTemplate: (id: string) => { content: string; name?: string } | undefined,
    onProgress?: (id: string, sent: number, total: number) => void,
    getAccountInfo?: (accountId: string) => { sessionString?: string; phoneNumber?: string; apiId?: string; apiHash?: string } | undefined,
    addErrorLog?: (log: { accountId: string; accountPhoneNumber?: string; username: string; message: string; timestamp: Date; logType: 'error' | 'success' | 'info'; errorType?: 'rate_limit' | 'banned' | 'connection' | 'other' }) => void
  ): Promise<void> {
    console.log('🚀 ========== executeMessage BAŞLADI ==========')
    console.log('🚀 Mesaj ID:', scheduledMessage.id)
    
    // Çift çalışmayı önle - eğer bu mesaj zaten çalışıyorsa, işlemi durdur
    if (!this.activeJobs.get(scheduledMessage.id)) {
      console.warn('⚠️ Mesaj aktif değil, executeMessage iptal ediliyor:', scheduledMessage.id)
      return
    }
    
    // Çalışan mesaj kontrolü - eğer başka bir executeMessage çalışıyorsa bekle
    const executionKey = `exec_${scheduledMessage.id}`
    if (this.activeExecutions.has(executionKey)) {
      console.warn('⚠️ Bu mesaj zaten çalışıyor, tekrar çalıştırma iptal ediliyor:', scheduledMessage.id)
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
      throw new Error(`Mesaj şablonu bulunamadı: ${scheduledMessage.messageTemplateId}`)
    }

    console.log('✅ Şablon bulundu:', {
      templateId: scheduledMessage.messageTemplateId,
      templateName: template.name || 'İsimsiz',
      contentLength: template.content.length,
      contentPreview: template.content.substring(0, 100) + '...'
    })

    let sentCount = 0
    const totalCount =
      scheduledMessage.accountIds.length * scheduledMessage.usernames.length

    console.log('📊 ========== GÖNDERİM PLANI ==========')
    console.log('📊 Plan detayları:', {
      accountCount: scheduledMessage.accountIds.length,
      usernameCount: scheduledMessage.usernames.length,
      totalMessages: totalCount,
      delayBetweenMessages: scheduledMessage.delayBetweenMessages,
      delayBetweenMessagesSeconds: scheduledMessage.delayBetweenMessages / 1000,
      delayBetweenAccounts: scheduledMessage.delayBetweenAccounts,
      delayBetweenAccountsSeconds: scheduledMessage.delayBetweenAccounts / 1000
    })

    console.log('🔄 ========== HESAPLAR DÖNGÜSÜ BAŞLADI ==========')
    console.log('🔄 Toplam hesap sayısı:', scheduledMessage.accountIds.length)
    console.log('🔄 Hesap ID\'leri:', scheduledMessage.accountIds)
    
    // Tüm hesaplar için başarısız grupları takip et
    const globalFailedGroups = new Set<string>()
    
    for (const accountId of scheduledMessage.accountIds) {
      const accountIndex = scheduledMessage.accountIds.indexOf(accountId) + 1
      console.log('👤 ========== HESAP İŞLENİYOR ==========')
      console.log('👤 Hesap bilgileri:', {
        accountId,
        accountIndex,
        totalAccounts: scheduledMessage.accountIds.length,
        remainingAccounts: scheduledMessage.accountIds.length - accountIndex
      })
      
      let accountRateLimited = false // Bu hesap için rate limit hatası alındı mı?
      let accountHasCriticalError = false // Bu hesap için kritik hata alındı mı?
      let accountErrorMessages: string[] = [] // Bu hesap için alınan hatalar
      
      console.log('🔄 ========== KULLANICI/GRUP DÖNGÜSÜ BAŞLADI ==========')
      console.log('🔄 Toplam alıcı sayısı:', scheduledMessage.usernames.length)
      console.log('🔄 Alıcılar:', scheduledMessage.usernames)
      
      for (const username of scheduledMessage.usernames) {
        // Eğer bu hesap kritik hata aldıysa, bu hesap için döngüyü kır
        if (accountRateLimited || accountHasCriticalError) {
          const reason = accountRateLimited ? 'rate limit' : 'kritik hata'
          console.log(`⏰ Bu hesap ${reason} aldı, diğer alıcılara mesaj gönderilmeyecek:`, accountId)
          break
        }
        
        // Eğer bu grup daha önce başarısız olduysa, atla
        if (globalFailedGroups.has(username)) {
          console.log(`⏭️ Bu grup daha önce başarısız oldu, atlanıyor:`, username)
          continue
        }
        const usernameIndex = scheduledMessage.usernames.indexOf(username) + 1
        console.log('📨 ========== MESAJ GÖNDERİMİ BAŞLADI ==========')
        console.log('📨 Mesaj bilgileri:', {
          accountId,
          username,
          usernameIndex,
          totalUsernames: scheduledMessage.usernames.length,
          accountIndex,
          totalAccounts: scheduledMessage.accountIds.length,
          currentProgress: `${sentCount}/${totalCount}`
        })
        
        if (!this.activeJobs.get(scheduledMessage.id)) {
          console.log('⚠️ Mesaj durduruldu, gönderim iptal ediliyor:', scheduledMessage.id)
          break
        }

        // Telegram ban önleme: Her mesaj arasında delay
        console.log('⏳ Mesajlar arası gecikme başlıyor:', scheduledMessage.delayBetweenMessages, 'ms')
        await this.delay(scheduledMessage.delayBetweenMessages)
        console.log('⏳ Mesajlar arası gecikme tamamlandı')

        try {
          console.log('📤 Mesaj gönderiliyor:', {
            accountId,
            username,
            template: template.name || 'İsimsiz',
            contentPreview: template.content.substring(0, 50) + '...'
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
            username,
            template.content,
            accountInfo?.sessionString,
            accountInfo?.phoneNumber,
            accountInfo?.apiId,
            accountInfo?.apiHash
          )

          console.log('📥 Gönderim sonucu:', {
            accountId,
            username,
            success: result.success,
            error: result.error
          })

          if (result.success) {
            sentCount++
            console.log('✅ ========== MESAJ BAŞARILI ==========')
            console.log('✅ Mesaj başarıyla gönderildi:', accountId, '->', username, `(${sentCount}/${totalCount})`)
            
            // Başarılı log ekle
            if (addErrorLog) {
              const accountInfo = getAccountInfo ? getAccountInfo(accountId) : undefined
              addErrorLog({
                accountId,
                accountPhoneNumber: accountInfo?.phoneNumber,
                username,
                message: `Mesaj başarıyla gönderildi (${sentCount}/${totalCount})`,
                timestamp: new Date(),
                logType: 'success'
              })
            }
            
            onProgress?.(scheduledMessage.id, sentCount, totalCount)
          } else {
            console.error('❌ ========== MESAJ BAŞARISIZ ==========')
            console.error('❌ Mesaj gönderilemedi:', accountId, '->', username)
            console.error('❌ Hata mesajı:', result.error)
            console.error('❌ Detaylar:', {
              accountId,
              username,
              error: result.error,
              currentProgress: `${sentCount}/${totalCount}`
            })
            
            // Hata mesajını kaydet
            if (result.error) {
              accountErrorMessages.push(`${username}: ${result.error}`)
              
              // Hata logunu kaydet
              const errorMsg = result.error || ''
              let errorType: 'rate_limit' | 'banned' | 'connection' | 'other' = 'other'
              
              if (errorMsg.includes('rate limit') || 
                  errorMsg.includes('Rate limit') ||
                  errorMsg.includes('wait of') ||
                  errorMsg.includes('beklenmesi gerekiyor') ||
                  errorMsg.includes('FLOOD_WAIT')) {
                errorType = 'rate_limit'
              } else if (errorMsg.includes('USER_BANNED_IN_CHANNEL') ||
                        errorMsg.includes('yasaklanmış')) {
                errorType = 'banned'
              } else if (errorMsg.includes('bağlı değil') ||
                        errorMsg.includes('session bilgisi bulunamadı') ||
                        errorMsg.includes('yeniden bağlanılamadı') ||
                        errorMsg.includes('client bulunamadı')) {
                errorType = 'connection'
              }
              
              // Error log ekle
              if (addErrorLog) {
                const accountInfo = getAccountInfo ? getAccountInfo(accountId) : undefined
                addErrorLog({
                  accountId,
                  accountPhoneNumber: accountInfo?.phoneNumber,
                  username,
                  message: result.error,
                  timestamp: new Date(),
                  logType: 'error',
                  errorType
                })
              }
              
              // Bu grup için başarısız işaretle (sadece grup hataları için)
              // Rate limit veya connection hatası hesap seviyesinde, banned grup seviyesinde olabilir
              if (errorType === 'banned' || errorType === 'other') {
                globalFailedGroups.add(username)
                console.log(`⏭️ Grup başarısız işaretlendi, diğer hesaplar için atlanacak:`, username)
              }
            }
            
            // Kritik hata kontrolü - bu hesap için mesaj gönderimini durdur
            const errorMsg = result.error || ''
            const isRateLimit = errorMsg.includes('rate limit') || 
                               errorMsg.includes('Rate limit') ||
                               errorMsg.includes('wait of') ||
                               errorMsg.includes('beklenmesi gerekiyor') ||
                               errorMsg.includes('FLOOD_WAIT')
            
            const isBanned = errorMsg.includes('USER_BANNED_IN_CHANNEL') ||
                            errorMsg.includes('yasaklanmış')
            
            const isConnectionError = errorMsg.includes('bağlı değil') ||
                                     errorMsg.includes('session bilgisi bulunamadı') ||
                                     errorMsg.includes('yeniden bağlanılamadı') ||
                                     errorMsg.includes('client bulunamadı')
            
            const isCriticalError = isRateLimit || isBanned || isConnectionError
            
            if (isCriticalError) {
              if (isRateLimit) {
                console.error('⏰ Rate limit hatası tespit edildi, bu hesap için gönderim durduruluyor:', accountId)
                accountRateLimited = true
              } else if (isBanned) {
                console.error('🚫 Hesap yasaklanmış, bu hesap için gönderim durduruluyor:', accountId)
                accountHasCriticalError = true
              } else if (isConnectionError) {
                console.error('🔌 Bağlantı hatası, bu hesap için gönderim durduruluyor:', accountId)
                accountHasCriticalError = true
              }
              
              console.error('⏰ Bu hesap için diğer mesajlar atlanacak, diğer hesaplara geçilecek')
              
              // Bu hesap için döngüyü kır (break) - diğer hesaplara geç
              break
            }
            
            // Hata olsa bile ilerlemeyi güncelle (gönderilmeyen mesajlar da sayılır)
            // Ancak sentCount'u artırmıyoruz çünkü mesaj gönderilmedi
            // Hata olsa bile devam et, diğer mesajları göndermeyi dene
          }
        } catch (error) {
          console.error('❌ ========== MESAJ GÖNDERME EXCEPTION ==========')
          console.error('❌ Exception:', accountId, '->', username)
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error('❌ Hata detayları:', {
            error: errorMsg,
            stack: error instanceof Error ? error.stack : 'No stack',
            errorObject: error,
            accountId,
            username
          })
          
          // Exception'ı da hata listesine ekle
          accountErrorMessages.push(`${username}: Exception - ${errorMsg}`)
          
          // Kritik exception kontrolü
          if (errorMsg.includes('rate limit') || 
              errorMsg.includes('wait of') ||
              errorMsg.includes('BANNED') ||
              errorMsg.includes('bağlı değil')) {
            console.error('⏰ Kritik exception tespit edildi, bu hesap için gönderim durduruluyor:', accountId)
            accountHasCriticalError = true
            break
          }
          
          // Hata olsa bile devam et
        }

        console.log('📨 ========== MESAJ GÖNDERİMİ TAMAMLANDI ==========')
        console.log('📨 Son durum:', {
          accountId,
          username,
          sentCount,
          totalCount,
          progress: `${sentCount}/${totalCount}`
        })

        // Her kullanıcıya mesaj gönderdikten sonra ek delay
        console.log('⏳ Ek gecikme başlıyor: 1000ms')
        await this.delay(1000) // Minimum 1 saniye
        console.log('⏳ Ek gecikme tamamlandı')
      }
      
      console.log('🔄 ========== KULLANICI/GRUP DÖNGÜSÜ TAMAMLANDI ==========')

      // Her hesap arasında delay
      if (scheduledMessage.accountIds.indexOf(accountId) < scheduledMessage.accountIds.length - 1) {
        console.log('⏳ Hesaplar arası gecikme başlıyor:', scheduledMessage.delayBetweenAccounts, 'ms')
        await this.delay(scheduledMessage.delayBetweenAccounts)
        console.log('⏳ Hesaplar arası gecikme tamamlandı')
      }
      
      console.log('👤 ========== HESAP İŞLEMİ TAMAMLANDI ==========')
      console.log('👤 Hesap özeti:', {
        accountId,
        accountIndex,
        totalAccounts: scheduledMessage.accountIds.length,
        sentCount,
        totalCount,
        progress: `${sentCount}/${totalCount}`,
        accountRateLimited,
        accountHasCriticalError,
        errorCount: accountErrorMessages.length
      })
      
      // Eğer bu hesap sorun çıkardıysa, logla
      if (accountRateLimited || accountHasCriticalError || accountErrorMessages.length > 0) {
        console.error('⚠️ ========== SORUN ÇIKARAN HESAP ==========')
        console.error('⚠️ Hesap ID:', accountId)
        console.error('⚠️ Sorun türü:', {
          rateLimited: accountRateLimited,
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
    
    // Execution flag'ini temizle
    this.activeExecutions.delete(`exec_${scheduledMessage.id}`)
    
    onProgress?.(scheduledMessage.id, sentCount, totalCount)
  }

  cancelMessage(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
    this.activeJobs.delete(id)
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  isMessageActive(id: string): boolean {
    return this.activeJobs.get(id) || false
  }
}

export const messageScheduler = new MessageScheduler()

