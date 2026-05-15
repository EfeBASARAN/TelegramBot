import { create } from 'zustand'
import { reportActivityToTelegram } from '@/lib/activityTelemetry'
import {
  saveAccounts,
  saveMessageTemplates,
  saveScheduledMessages,
  saveApiConfig,
  saveErrorLogs,
  loadAllAppData,
  parseScheduledMessages,
} from '@/lib/storage'
import type { JoinedGroupInfo } from '@/lib/telegram'
import type { TemplatePhotoPayload } from '@/lib/templatePhoto'

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
  /** Opsiyonel: dosya seçiciyle eklenen görsel (yalnızca bu cihazda; base64). */
  mediaPhoto?: TemplatePhotoPayload
  /** Açıksa: rastgele gecikmeler + her gönderimde metne hafif görünmez/boşluk varyasyonu (aynı metin imzasını kırar). */
  antiSpamDelay?: boolean
}

export interface ScheduledMessage {
  id: string
  accountIds: string[]
  usernames: string[]
  /** Varsayılan: manuel liste. group_members: seçili grubun üyeleri. custom_list: kullanıcı|id|hash. joined_groups: katılınan grupların kullanıcı adları. */
  recipientMode?: 'manual' | 'group_members' | 'custom_list' | 'joined_groups'
  /** custom_list seçildiğinde orijinal metin (düzenleme ekranı için) */
  customListRaw?: string
  groupTarget?: JoinedGroupInfo
  /** group_members: grupları ve üye listesini hangi hesabın oturumuyla çekeceğimiz (gönderim hesaplarından bağımsız). */
  groupListAccountId?: string
  messageTemplateId: string
  scheduledTime: Date
  delayBetweenMessages: number // milliseconds
  delayBetweenAccounts: number // milliseconds
  /** each_to_all: her hesap tüm alıcılara (hesap × alıcı). split_recipients: alıcı listesi hesaplara bölünür, her alıcıya bir gönderim. */
  accountDistribution?: 'each_to_all' | 'split_recipients'
  isActive: boolean
  sentCount: number
  totalCount: number
  /** Başarılı gönderim çiftleri (hesapId::hedef); sayfa yenilemede kaldığı yerden devam için */
  completedSendKeys?: string[]
  /** Gönderim çalışırken başlatıldığı an (geçen süre için) */
  runStartedAt?: Date
  /** Varsa: bu zamana kadar her tur bittiğinde yeni tur başlar (tek tur: boş bırakın) */
  repeatUntil?: Date
}

type Page =
  | 'accounts'
  | 'groups'
  | 'group_finder'
  | 'messages'
  | 'scheduler'
  | 'settings'
  | 'logs'
  | 'live'
  | 'join'

/** Canlı konsol satırı (bellekte; sayfa yenilenince sıfırlanır) */
export type LiveBotLogLevel = 'info' | 'ok' | 'warn' | 'err' | 'step'

export interface LiveBotLogEntry {
  id: string
  ts: number
  level: LiveBotLogLevel
  message: string
  detail?: string
}

export interface ErrorLog {
  id: string
  accountId: string
  accountPhoneNumber?: string
  /** Telegram gönderim hedefi (teknik: __peer_user__:… veya @kullanıcı) — gruplama anahtarı */
  username: string
  /** Arayüzde gösterilecek alıcı adı / @kullanıcı / isim (username ham dizesi olabilir) */
  recipientDisplayName?: string
  message: string // error veya success mesajı
  timestamp: Date
  logType: 'error' | 'success' | 'info'
  errorType?: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other' // Sadece error için
  /** Kısa başlık (örn. "Mesaj iletildi") */
  summary?: string
  /** Uzun açıklama / teknik metin */
  detail?: string
  /** Kullanıcıya ne yapılabileceği */
  hint?: string
}

interface TelegramApiConfig {
  apiId: string
  apiHash: string
}

export interface AppToast {
  id: string
  message: string
  variant: 'error' | 'success' | 'info'
}

interface AppState {
  currentPage: Page
  accounts: TelegramAccount[]
  messageTemplates: MessageTemplate[]
  scheduledMessages: ScheduledMessage[]
  errorLogs: ErrorLog[]
  /** Geçici arayüz bildirimleri (alert yerine) */
  toasts: AppToast[]
  apiConfig: TelegramApiConfig | null
  isLoaded: boolean
  /** Bot canlı izle konsolu (anlık işlem günlüğü) */
  liveBotLogs: LiveBotLogEntry[]
  pushLiveBotLog: (entry: Omit<LiveBotLogEntry, 'id' | 'ts'>) => void
  clearLiveBotLogs: () => void
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
  updateScheduledMessage: (
    id: string,
    updates:
      | Partial<ScheduledMessage>
      | ((prev: ScheduledMessage) => Partial<ScheduledMessage>)
  ) => void
  addErrorLog: (log: Omit<ErrorLog, 'id'>) => void
  clearErrorLogs: () => void
  loadFromStorage: () => Promise<void>
  pushToast: (message: string, variant?: AppToast['variant']) => void
  dismissToast: (id: string) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'settings',
  accounts: [],
  messageTemplates: [],
  scheduledMessages: [],
  errorLogs: [],
  toasts: [],
  apiConfig: null,
  isLoaded: false,
  liveBotLogs: [],

  pushLiveBotLog: (entry) => {
    void reportActivityToTelegram({
      type: 'action_log',
      level: entry.level,
      message: entry.message,
      detail: entry.detail,
      happenedAtIso: new Date().toISOString(),
    })
    set((state) => {
      const newLine: LiveBotLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        ts: Date.now(),
        ...entry,
      }
      return { liveBotLogs: [...state.liveBotLogs, newLine].slice(-3000) }
    })
  },

  clearLiveBotLogs: () => set({ liveBotLogs: [] }),

  setCurrentPage: (page) => {
    void reportActivityToTelegram({
      type: 'page_visit',
      level: 'info',
      message: `Sayfa: ${page}`,
      happenedAtIso: new Date().toISOString(),
    })
    set({ currentPage: page })
  },
  
  setApiConfig: (config) => {
    set({ apiConfig: config })
    void saveApiConfig(config)
  },
  
  addAccount: (account) => {
    set((state) => {
      const newAccounts = [...state.accounts, account]
      void saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  removeAccount: (id) => {
    set((state) => {
      const newAccounts = state.accounts.filter((acc) => acc.id !== id)
      void saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  updateAccount: (id, updates) => {
    set((state) => {
      const newAccounts = state.accounts.map((acc) =>
        acc.id === id ? { ...acc, ...updates } : acc
      )
      void saveAccounts(newAccounts)
      return { accounts: newAccounts }
    })
  },
  
  addMessageTemplate: (template) => {
    set((state) => {
      const newTemplates = [...state.messageTemplates, template]
      void saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  removeMessageTemplate: (id) => {
    set((state) => {
      const newTemplates = state.messageTemplates.filter((t) => t.id !== id)
      void saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  updateMessageTemplate: (id, updates) => {
    set((state) => {
      const newTemplates = state.messageTemplates.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
      void saveMessageTemplates(newTemplates)
      return { messageTemplates: newTemplates }
    })
  },
  
  addScheduledMessage: (message) => {
    set((state) => {
      const newMessages = [...state.scheduledMessages, message]
      void saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
        runStartedAt: m.runStartedAt?.toISOString(),
        repeatUntil: m.repeatUntil?.toISOString(),
      })))
      return { scheduledMessages: newMessages }
    })
  },
  
  removeScheduledMessage: (id) => {
    set((state) => {
      const newMessages = state.scheduledMessages.filter((m) => m.id !== id)
      void saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
        runStartedAt: m.runStartedAt?.toISOString(),
        repeatUntil: m.repeatUntil?.toISOString(),
      })))
      return { scheduledMessages: newMessages }
    })
  },
  
  updateScheduledMessage: (id, updates) => {
    set((state) => {
      const newMessages = state.scheduledMessages.map((m) => {
        if (m.id !== id) return m
        const patch = typeof updates === 'function' ? updates(m) : updates
        return { ...m, ...patch }
      })
      void saveScheduledMessages(newMessages.map((m) => ({
        ...m,
        scheduledTime: m.scheduledTime.toISOString(),
        runStartedAt: m.runStartedAt?.toISOString(),
        repeatUntil: m.repeatUntil?.toISOString(),
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
      void saveErrorLogs(newLogs.map((l) => ({
        ...l,
        timestamp: l.timestamp.toISOString(),
      })))
      return { errorLogs: newLogs }
    })
  },
  
  clearErrorLogs: () => {
    set({ errorLogs: [] })
    void saveErrorLogs([])
  },

  pushToast: (message, variant = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, message, variant }].slice(-5),
    }))
    const duration = variant === 'error' ? 12000 : 8000
    setTimeout(() => {
      get().dismissToast(id)
    }, duration)
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  loadFromStorage: async () => {
    if (get().isLoaded) return

    const snapshot = await loadAllAppData()
    const accounts = snapshot.accounts
    const templates = snapshot.messageTemplates
    const scheduled = parseScheduledMessages(snapshot.scheduledMessages)
    const apiConfig = snapshot.apiConfig
    const errorLogs = snapshot.errorLogs.map((log) => {
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

