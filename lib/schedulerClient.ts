'use client'

import { liveLog } from '@/lib/botLiveLog'
import { messageScheduler } from '@/lib/scheduler'
import type { SchedulerOnProgress } from '@/lib/scheduler'
import { useAppStore, type ErrorLog } from '@/store/appStore'

/** İki tur arası bekleme (ms); bitiş zamanına kadar tekrarlayan planlarda kullanılır */
const BETWEEN_TOURS_MS = 4000

/** scheduleMessage için ortak geri çağrılar (ilerleme anahtarları localStorage ile kalıcı) */
export function getSchedulerScheduleMessageArgs() {
  const getState = () => useAppStore.getState()

  const onProgress: SchedulerOnProgress = (id, sent, total, done, meta) => {
    const { updateScheduledMessage, scheduledMessages } = getState()
    const msg = scheduledMessages.find((m) => m.id === id)

    // Sadece done===true tam tur biter (executeMessage sonu). Son başarılı gönderimde de
    // sent===total olur ama done hâlâ false; sent>=total ile "tur bitti" sanmak yanlış —
    // çoklu tur modunda turu erken sıfırlayıp ilk gruba döner.
    const terminalTour = done === true

    if (terminalTour) {
      if (meta?.repeatWindowEnded || meta?.userStopped) {
        updateScheduledMessage(id, {
          sentCount: sent,
          totalCount: total,
          isActive: false,
          completedSendKeys: undefined,
          runStartedAt: undefined,
        })
        return
      }

      // Kısmi tur (ör. bağlantı koptu): çoklu tur tekrarını yapma; anahtarları koru
      if (meta?.fullPassComplete === false) {
        updateScheduledMessage(id, {
          sentCount: sent,
          totalCount: total,
          isActive: false,
          runStartedAt: undefined,
        })
        return
      }

      const repeatUntilMs = msg?.repeatUntil ? new Date(msg.repeatUntil).getTime() : NaN
      const loopWhileBeforeEnd =
        Number.isFinite(repeatUntilMs) && Date.now() < repeatUntilMs

      if (loopWhileBeforeEnd) {
        const nextSlot = new Date(Date.now() + BETWEEN_TOURS_MS)
        updateScheduledMessage(id, {
          sentCount: 0,
          totalCount: total,
          completedSendKeys: [],
          isActive: true,
          scheduledTime: nextSlot,
          runStartedAt: new Date(),
        })
        liveLog(
          'step',
          'Turlar arası bekleme — sonraki tur zamanlanıyor',
          `~${Math.round(BETWEEN_TOURS_MS / 1000)} sn sonra`
        )
        queueMicrotask(() => {
          const args = getSchedulerScheduleMessageArgs()
          const fresh = getState().scheduledMessages.find((m) => m.id === id)
          if (!fresh?.isActive) return
          void messageScheduler.scheduleMessage(
            fresh,
            args.getMessageTemplate,
            args.onProgress,
            args.getAccountInfo,
            args.addErrorLog,
            args.onExecutionError
          )
        })
        return
      }

      updateScheduledMessage(id, {
        sentCount: sent,
        totalCount: total,
        isActive: false,
        completedSendKeys: undefined,
        runStartedAt: undefined,
      })
      return
    }

    // Tamamlanan anahtarları her zaman güncel kayıttan türet (ardışık güncellemelerde üst üste binmeyi önler)
    updateScheduledMessage(id, (prev) => {
      const prevKeys = prev.completedSendKeys ?? []
      const nextKeys =
        meta?.completedKey && !prevKeys.includes(meta.completedKey)
          ? [...prevKeys, meta.completedKey]
          : prevKeys
      const reconciled =
        meta?.completedKey !== undefined
          ? Math.min(total, Math.max(sent, nextKeys.length))
          : sent
      return {
        sentCount: reconciled,
        totalCount: total,
        ...(meta?.completedKey ? { completedSendKeys: nextKeys } : {}),
      }
    })
  }

  return {
    getMessageTemplate: (templateId: string) =>
      getState().messageTemplates.find((t) => t.id === templateId),
    onProgress,
    getAccountInfo: (accountId: string) => {
      const account = getState().accounts.find((a) => a.id === accountId)
      return account
        ? {
            sessionString: account.sessionString,
            phoneNumber: account.phoneNumber,
            apiId: account.apiId,
            apiHash: account.apiHash,
          }
        : undefined
    },
    addErrorLog: (log: Omit<ErrorLog, 'id'>) => getState().addErrorLog(log),
    onExecutionError: (err: unknown, messageId: string) => {
      const raw = err instanceof Error ? err.message : String(err)
      getState().pushToast(raw, 'error')
      getState().updateScheduledMessage(messageId, { isActive: false, runStartedAt: undefined })
    },
  }
}

/**
 * Sayfa yenilemeden sonra: aktif zamanlayıcıları yeniden bağlar (Scheduler sayfası açık olmasa da).
 * Çift gönderimler için completedSendKeys kullanılır; eski kısmi kayıt anahtarsızsa gönderim durdurulur.
 */
export async function resumeActiveScheduledMessagesAfterLoad(): Promise<void> {
  const getState = () => useAppStore.getState()
  if (!getState().isLoaded) return

  const args = getSchedulerScheduleMessageArgs()
  const { scheduledMessages, messageTemplates, updateScheduledMessage, pushToast } = getState()

  for (const m of scheduledMessages) {
    if (!m.isActive) continue

    const template = messageTemplates.find((t) => t.id === m.messageTemplateId)
    if (!template) {
      updateScheduledMessage(m.id, { isActive: false, runStartedAt: undefined })
      continue
    }

    if (messageScheduler.isMessageActive(m.id)) continue

    liveLog('step', 'Sayfa yüklendi — aktif plan yeniden bağlanıyor', `Plan ${m.id} · ${template.name || 'Şablon'}`)

    if (
      m.sentCount > 0 &&
      m.sentCount < m.totalCount &&
      (!m.completedSendKeys || m.completedSendKeys.length === 0)
    ) {
      pushToast(
        'Yarım kalan gönderim (eski kayıt) yenilemeden sonra güvenle devam edilemiyor. Zamanlayıcıda durdurup tekrar başlatın.',
        'info'
      )
      updateScheduledMessage(m.id, { isActive: false, runStartedAt: undefined })
      continue
    }

    if (!m.runStartedAt) {
      updateScheduledMessage(m.id, { runStartedAt: new Date() })
    }
    const mFresh = getState().scheduledMessages.find((x) => x.id === m.id) ?? m

    await messageScheduler.scheduleMessage(
      mFresh,
      args.getMessageTemplate,
      args.onProgress,
      args.getAccountInfo,
      args.addErrorLog,
      args.onExecutionError
    )
  }
}
