// LocalStorage ile veri saklama ve yükleme

import type { JoinedGroupInfo } from '@/lib/telegram'
import type { TemplatePhotoPayload } from '@/lib/templatePhoto'

const STORAGE_KEYS = {
  ACCOUNTS: 'telegram_accounts',
  MESSAGE_TEMPLATES: 'telegram_message_templates',
  SCHEDULED_MESSAGES: 'telegram_scheduled_messages',
  API_CONFIG: 'telegram_api_config',
  ERROR_LOGS: 'telegram_error_logs',
}

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
  /** Opsiyonel: dosya seçiciyle yüklenen görsel (localStorage’da base64). */
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
  message: string // error veya success mesajı
  timestamp: string // ISO string
  logType: 'error' | 'success' | 'info'
  errorType?: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other' // Sadece error için
  summary?: string
  detail?: string
  hint?: string
}

// Accounts
export const saveAccounts = (accounts: StoredAccount[]): void => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts))
    } catch (error) {
      console.error('Accounts kaydedilemedi:', error)
    }
  }
}

export const loadAccounts = (): StoredAccount[] => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ACCOUNTS)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Accounts yüklenemedi:', error)
      return []
    }
  }
  return []
}

// Message Templates
export const saveMessageTemplates = (templates: StoredMessageTemplate[]): void => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.MESSAGE_TEMPLATES, JSON.stringify(templates))
    } catch (error) {
      console.error('Message templates kaydedilemedi:', error)
    }
  }
}

export const loadMessageTemplates = (): StoredMessageTemplate[] => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.MESSAGE_TEMPLATES)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Message templates yüklenemedi:', error)
      return []
    }
  }
  return []
}

// Scheduled Messages
export const saveScheduledMessages = (messages: StoredScheduledMessage[]): void => {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEYS.SCHEDULED_MESSAGES, JSON.stringify(messages))
    } catch (error) {
      console.error('Scheduled messages kaydedilemedi:', error)
    }
  }
}

export const loadScheduledMessages = (): Array<
  Omit<StoredScheduledMessage, 'scheduledTime' | 'runStartedAt' | 'repeatUntil'> & {
    scheduledTime: Date
    runStartedAt?: Date
    repeatUntil?: Date
  }
> => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SCHEDULED_MESSAGES)
      if (!data) return []
      
      const messages = JSON.parse(data)
      // Date string'lerini Date objelerine çevir - geçersiz tarihleri filtrele
      type Row = Omit<StoredScheduledMessage, 'scheduledTime' | 'runStartedAt' | 'repeatUntil'> & {
        scheduledTime: Date
        runStartedAt?: Date
        repeatUntil?: Date
      }
      return (messages as StoredScheduledMessage[])
        .map((msg: StoredScheduledMessage): Row | null => {
          const date = new Date(msg.scheduledTime)
          if (isNaN(date.getTime())) {
            return null
          }
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
          return {
            ...msg,
            scheduledTime: date,
            runStartedAt,
            repeatUntil,
          }
        })
        .filter((msg): msg is Row => msg !== null)
    } catch (error) {
      console.error('Scheduled messages yüklenemedi:', error)
      return []
    }
  }
  return []
}

// API Config
export const saveApiConfig = (config: StoredApiConfig | null): void => {
  if (typeof window !== 'undefined') {
    try {
      if (config) {
        localStorage.setItem(STORAGE_KEYS.API_CONFIG, JSON.stringify(config))
      } else {
        localStorage.removeItem(STORAGE_KEYS.API_CONFIG)
      }
    } catch (error) {
      console.error('API config kaydedilemedi:', error)
    }
  }
}

export const loadApiConfig = (): StoredApiConfig | null => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.API_CONFIG)
      return data ? JSON.parse(data) : null
    } catch (error) {
      console.error('API config yüklenemedi:', error)
      return null
    }
  }
  return null
}

// Error Logs
export const saveErrorLogs = (logs: StoredErrorLog[]): void => {
  if (typeof window !== 'undefined') {
    try {
      // Son 2000 logu sakla (hem hata hem başarılı)
      const logsToSave = logs.slice(-2000)
      localStorage.setItem(STORAGE_KEYS.ERROR_LOGS, JSON.stringify(logsToSave))
    } catch (error) {
      console.error('Error logs kaydedilemedi:', error)
    }
  }
}

export const loadErrorLogs = (): StoredErrorLog[] => {
  if (typeof window !== 'undefined') {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.ERROR_LOGS)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Error logs yüklenemedi:', error)
      return []
    }
  }
  return []
}

// Tüm verileri temizle
export const clearAllData = (): void => {
  if (typeof window !== 'undefined') {
    try {
      Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key)
      })
    } catch (error) {
      console.error('Veriler temizlenemedi:', error)
    }
  }
}

