'use client'

import { liveLog } from '@/lib/botLiveLog'
import { messageScheduler } from '@/lib/scheduler'
import type { SchedulerOnProgress } from '@/lib/scheduler'
import { useAppStore, type ErrorLog } from '@/store/appStore'

/** scheduleMessage için ortak geri çağrılar (ilerleme anahtarları localStorage ile kalıcı) */
export function getSchedulerScheduleMessageArgs() {
  const getState = () => useAppStore.getState()

  const onProgress: SchedulerOnProgress = (id, sent, total, done, meta) => {
    const { updateScheduledMessage, scheduledMessages } = getState()
    const msg = scheduledMessages.find((m) => m.id === id)
    const prevKeys = msg?.completedSendKeys ?? []
    const nextKeys =
      meta?.completedKey && !prevKeys.includes(meta.completedKey)
        ? [...prevKeys, meta.completedKey]
        : prevKeys

    if (done === true || (sent >= total && total > 0)) {
      updateScheduledMessage(id, {
        sentCount: sent,
        totalCount: total,
        isActive: false,
        completedSendKeys: undefined,
        runStartedAt: undefined,
      })
    } else {
      updateScheduledMessage(id, {
        sentCount: sent,
        totalCount: total,
        ...(meta?.completedKey ? { completedSendKeys: nextKeys } : {}),
      })
    }
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
