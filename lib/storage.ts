// Uygulama verileri yalnızca sunucudaki data/*.json dosyalarında tutulur (tarayıcı depolaması yok).

import { clearLicenseToken } from '@/lib/licenseStorage'
import type { JoinedGroupInfo } from '@/lib/telegram'
import type { TemplatePhotoPayload } from '@/lib/templatePhoto'

export type DataCollectionKey =
  | 'accounts'
  | 'messageTemplates'
  | 'scheduledMessages'
  | 'apiConfig'
  | 'errorLogs'

export interface StoredAccount {
  id: string
  phoneNumber: string
  apiId?: string
  apiHash?: string
  firstName?: string
  lastName?: string
  username?: string
  isConnected: boolean
  sessionString?: string
}

export interface StoredMessageTemplate {
  id: string
  content: string
  name: string
  /** Opsiyonel: dosya seçiciyle yüklenen görsel (base64). */
  mediaPhoto?: TemplatePhotoPayload
  antiSpamDelay?: boolean
}

export interface StoredScheduledMessage {
  id: string
  accountIds: string[]
  usernames: string[]
  recipientMode?: 'manual' | 'group_members' | 'custom_list' | 'joined_groups'
  customListRaw?: string
  groupTarget?: JoinedGroupInfo
  groupListAccountId?: string
  messageTemplateId: string
  scheduledTime: string // ISO string
  delayBetweenMessages: number
  delayBetweenAccounts: number
  accountDistribution?: 'each_to_all' | 'split_recipients'
  isActive: boolean
  sentCount: number
  totalCount: number
  completedSendKeys?: string[]
  runStartedAt?: string
  repeatUntil?: string
}

export interface StoredApiConfig {
  apiId: string
  apiHash: string
}

export interface StoredErrorLog {
  id: string
  accountId: string
  accountPhoneNumber?: string
  username: string
  recipientDisplayName?: string
  message: string
  timestamp: string
  logType: 'error' | 'success' | 'info'
  errorType?: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other'
  summary?: string
  detail?: string
  hint?: string
}

export interface AppDataSnapshot {
  accounts: StoredAccount[]
  messageTemplates: StoredMessageTemplate[]
  scheduledMessages: StoredScheduledMessage[]
  apiConfig: StoredApiConfig | null
  errorLogs: StoredErrorLog[]
}

const EMPTY_SNAPSHOT: AppDataSnapshot = {
  accounts: [],
  messageTemplates: [],
  scheduledMessages: [],
  apiConfig: null,
  errorLogs: [],
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw new Error(`Veri isteği başarısız: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function persistKey(key: DataCollectionKey, data: unknown): Promise<void> {
  await fetchJson('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data }),
  })
}

export async function loadAllAppData(): Promise<AppDataSnapshot> {
  if (typeof window === 'undefined') return { ...EMPTY_SNAPSHOT }

  try {
    const res = await fetchJson<{ data: Partial<AppDataSnapshot> }>('/api/data')
    const snapshot: AppDataSnapshot = {
      accounts: res.data.accounts ?? [],
      messageTemplates: res.data.messageTemplates ?? [],
      scheduledMessages: res.data.scheduledMessages ?? [],
      apiConfig: res.data.apiConfig ?? null,
      errorLogs: res.data.errorLogs ?? [],
    }
    return snapshot
  } catch (error) {
    console.error('Uygulama verileri yüklenemedi:', error)
    return { ...EMPTY_SNAPSHOT }
  }
}

export const saveAccounts = async (accounts: StoredAccount[]): Promise<void> => {
  try {
    await persistKey('accounts', accounts)
  } catch (error) {
    console.error('Accounts kaydedilemedi:', error)
  }
}

export const saveMessageTemplates = async (templates: StoredMessageTemplate[]): Promise<void> => {
  try {
    await persistKey('messageTemplates', templates)
  } catch (error) {
    console.error('Message templates kaydedilemedi:', error)
  }
}

export const saveScheduledMessages = async (messages: StoredScheduledMessage[]): Promise<void> => {
  try {
    await persistKey('scheduledMessages', messages)
  } catch (error) {
    console.error('Scheduled messages kaydedilemedi:', error)
  }
}

export const saveApiConfig = async (config: StoredApiConfig | null): Promise<void> => {
  try {
    await persistKey('apiConfig', config)
  } catch (error) {
    console.error('API config kaydedilemedi:', error)
  }
}

export const saveErrorLogs = async (logs: StoredErrorLog[]): Promise<void> => {
  try {
    const logsToSave = logs.slice(-2000)
    await persistKey('errorLogs', logsToSave)
  } catch (error) {
    console.error('Error logs kaydedilemedi:', error)
  }
}

export const clearAllData = async (): Promise<void> => {
  try {
    await Promise.all([
      persistKey('accounts', []),
      persistKey('messageTemplates', []),
      persistKey('scheduledMessages', []),
      persistKey('apiConfig', null),
      persistKey('errorLogs', []),
      clearLicenseToken(),
    ])
  } catch (error) {
    console.error('Veriler temizlenemedi:', error)
  }
}

export function parseScheduledMessages(
  messages: StoredScheduledMessage[]
): Array<
  Omit<StoredScheduledMessage, 'scheduledTime' | 'runStartedAt' | 'repeatUntil'> & {
    scheduledTime: Date
    runStartedAt?: Date
    repeatUntil?: Date
  }
> {
  type Row = Omit<StoredScheduledMessage, 'scheduledTime' | 'runStartedAt' | 'repeatUntil'> & {
    scheduledTime: Date
    runStartedAt?: Date
    repeatUntil?: Date
  }
  return messages
    .map((msg): Row | null => {
      const date = new Date(msg.scheduledTime)
      if (isNaN(date.getTime())) return null
      let runStartedAt: Date | undefined
      if (msg.runStartedAt) {
        const rs = new Date(msg.runStartedAt)
        if (!isNaN(rs.getTime())) runStartedAt = rs
      }
      let repeatUntil: Date | undefined
      if (msg.repeatUntil) {
        const ru = new Date(msg.repeatUntil)
        if (!isNaN(ru.getTime())) repeatUntil = ru
      }
      return { ...msg, scheduledTime: date, runStartedAt, repeatUntil }
    })
    .filter((msg): msg is Row => msg !== null)
}
