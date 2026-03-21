import { create } from 'zustand'
import {
  saveAccounts,
  loadAccounts,
  saveMessageTemplates,
  loadMessageTemplates,
  saveScheduledMessages,
  loadScheduledMessages,
  saveApiConfig,
  loadApiConfig,
  saveErrorLogs,
  loadErrorLogs,
  type StoredAccount,
  type StoredMessageTemplate,
  type StoredScheduledMessage,
  type StoredApiConfig,
  type StoredErrorLog,
} from '@/lib/storage'

export interface TelegramAccount {
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

export interface MessageTemplate {
  id: string
  content: string
  name: string
}

export interface ScheduledMessage {
  id: string
  accountIds: string[]
  usernames: string[]
  messageTemplateId: string
  scheduledTime: Date
  delayBetweenMessages: number // milliseconds
  delayBetweenAccounts: number // milliseconds
  isActive: boolean
  sentCount: number
  totalCount: number
}

type Page = 'accounts' | 'messages' | 'scheduler' | 'settings' | 'logs'

export interface ErrorLog {
  id: string
  accountId: string
  accountPhoneNumber?: string
  username: string
  message: string // error veya success mesajı
  timestamp: Date
  logType: 'error' | 'success' | 'info'
  errorType?: 'rate_limit' | 'banned' | 'connection' | 'other' // Sadece error için
}

interface TelegramApiConfig {
  apiId: string
  apiHash: string
}

interface AppState {
  currentPage: Page
  accounts: TelegramAccount[]
  messageTemplates: MessageTemplate[]
  scheduledMessages: ScheduledMessage[]
  errorLogs: ErrorLog[]
  apiConfig: TelegramApiConfig | null
  isLoaded: boolean
  setCurrentPage: (page: Page) => void
  setApiConfig: (config: TelegramApiConfig) => void
  addAccount: (account: TelegramAccount) => void
  removeAccount: (id: string) => void
  updateAccount: (id: string, updates: Partial<TelegramAccount>) => void
  addMessageTemplate: (template: MessageTemplate) => void
  removeMessageTemplate: (id: string) => void
  updateMessageTemplate: (id: string, updates: Partial<MessageTemplate>) => void
  addScheduledMessage: (message: ScheduledMessage) => void
  removeScheduledMessage: (id: string) => void
  updateScheduledMessage: (id: string, updates: Partial<ScheduledMessage>) => void
  addErrorLog: (log: ErrorLog) => void
  clearErrorLogs: () => void
  loadFromStorage: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'settings',
  accounts: [],
  messageTemplates: [],
  scheduledMessages: [],
  errorLogs: [],
  apiConfig: null,
  isLoaded: false,
  
  setCurrentPage: (page) => set({ currentPage: page }),
  
  setApiConfig: (config) => {
    set({ apiConfig: config })
    saveApiConfig(config)
  },
  
  addAccount: (account) => {
    set((state) => {
      const newAccounts = [...state.accounts, account]
      saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  removeAccount: (id) => {
    set((state) => {
      const newAccounts = state.accounts.filter((acc) => acc.id !== id)
      saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  updateAccount: (id, updates) => {
    set((state) => {
      const newAccounts = state.accounts.map((acc) =>
        acc.id === id ? { ...acc, ...updates } : acc
      )
      saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  addMessageTemplate: (template) => {
    set((state) => {
      const newTemplates = [...state.messageTemplates, template]
      saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  removeMessageTemplate: (id) => {
    set((state) => {
      const newTemplates = state.messageTemplates.filter((t) => t.id !== id)
      saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  updateMessageTemplate: (id, updates) => {
    set((state) => {
      const newTemplates = state.messageTemplates.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
      saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  addScheduledMessage: (message) => {
    set((state) => {
      const newMessages = [...state.scheduledMessages, message]
      saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
      })))
      return { scheduledMessages: newMessages }
    })
  },
  
  removeScheduledMessage: (id) => {
    set((state) => {
      const newMessages = state.scheduledMessages.filter((m) => m.id !== id)
      saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
      })))
      return { scheduledMessages: newMessages }
    })
  },
  
  updateScheduledMessage: (id, updates) => {
    set((state) => {
      const newMessages = state.scheduledMessages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      )
      saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
      })))
      return { scheduledMessages: newMessages }
    })
  },
  
  addErrorLog: (log) => {
    set((state) => {
      const newLog: ErrorLog = {
        ...log,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      }
      const newLogs = [...state.errorLogs, newLog]
      saveErrorLogs(newLogs.map((l) => ({
        ...l,
        timestamp: l.timestamp.toISOString(),
      })))
      return { errorLogs: newLogs }
    })
  },
  
  clearErrorLogs: () => {
    set({ errorLogs: [] })
    saveErrorLogs([])
  },
  
  loadFromStorage: () => {
    if (get().isLoaded) return // Zaten yüklendi
    
    const accounts = loadAccounts()
    const templates = loadMessageTemplates()
    const scheduled = loadScheduledMessages()
    const apiConfig = loadApiConfig()
    const errorLogs = loadErrorLogs().map((log) => {
      const message = log.message || (log as any).error || 'Bilinmeyen log'
      let logType = log.logType || ((log as any).error ? 'error' : 'info')
      // Eski bug: errorType vardı ama logType yanlışlıkla info kalmıştı (SchedulerPage error/message karışıklığı)
      if (log.errorType && logType === 'info') {
        logType = 'error'
      }
      return {
        ...log,
        timestamp: new Date(log.timestamp),
        message,
        logType,
      }
    })
    
    set({
      accounts,
      messageTemplates: templates,
      scheduledMessages: scheduled,
      errorLogs,
      apiConfig,
      isLoaded: true,
    })
  },
}))

