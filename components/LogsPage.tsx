'use client'

import { useState, useMemo } from 'react'
import { AlertCircle, Trash2, X, ChevronDown, ChevronUp, Clock, User, MessageSquare, CheckCircle, Info } from 'lucide-react'
import { useAppStore, ErrorLog } from '@/store/appStore'

export default function LogsPage() {
  const errorLogs = useAppStore((state) => state.errorLogs)
  const accounts = useAppStore((state) => state.accounts)
  const clearErrorLogs = useAppStore((state) => state.clearErrorLogs)
  
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Hesaplara göre grupla
  const logsByAccount = useMemo(() => {
    const grouped: Record<string, { account: { id: string; phoneNumber?: string }, logs: ErrorLog[] }> = {}
    
    errorLogs.forEach((log) => {
      if (!grouped[log.accountId]) {
        const account = accounts.find((a) => a.id === log.accountId)
        grouped[log.accountId] = {
          account: {
            id: log.accountId,
            phoneNumber: log.accountPhoneNumber || account?.phoneNumber
          },
          logs: []
        }
      }
      grouped[log.accountId].logs.push(log)
    })
    
    // Her hesap için logları tarihe göre sırala (en yeni önce)
    Object.values(grouped).forEach((group) => {
      group.logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    })
    
    return grouped
  }, [errorLogs, accounts])

  // Gruplara göre grupla (hesap içinde)
  const logsByGroup = useMemo(() => {
    const grouped: Record<string, Record<string, ErrorLog[]>> = {}
    
    Object.entries(logsByAccount).forEach(([accountId, accountData]) => {
      grouped[accountId] = {}
      accountData.logs.forEach((log) => {
        if (!grouped[accountId][log.username]) {
          grouped[accountId][log.username] = []
        }
        grouped[accountId][log.username].push(log)
      })
    })
    
    return grouped
  }, [logsByAccount])

  const toggleAccount = (accountId: string) => {
    const newExpanded = new Set(expandedAccounts)
    if (newExpanded.has(accountId)) {
      newExpanded.delete(accountId)
    } else {
      newExpanded.add(accountId)
    }
    setExpandedAccounts(newExpanded)
  }

  const toggleGroup = (accountId: string, username: string) => {
    const key = `${accountId}-${username}`
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedGroups(newExpanded)
  }

  const getLogTypeColor = (logType: string, errorType?: string) => {
    if (logType === 'success') {
      return 'bg-green-500/10 text-green-400 border-green-500/20'
    }
    if (logType === 'info') {
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    }
    // error type
    switch (errorType) {
      case 'rate_limit':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
      case 'banned':
        return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'connection':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20'
      default:
        return 'bg-red-500/10 text-red-400 border-red-500/20'
    }
  }

  const getLogTypeLabel = (logType: string, errorType?: string) => {
    if (logType === 'success') {
      return 'Başarılı'
    }
    if (logType === 'info') {
      return 'Bilgi'
    }
    // error type
    switch (errorType) {
      case 'rate_limit':
        return 'Hız limiti'
      case 'banned':
        return 'Yasak / kısıtlama'
      case 'connection':
        return 'Bağlantı sorunu'
      default:
        return 'Hata'
    }
  }

  const getLogTypeIcon = (logType: string) => {
    if (logType === 'success') {
      return <CheckCircle size={14} className="text-green-400" />
    }
    if (logType === 'info') {
      return <Info size={14} className="text-blue-400" />
    }
    return <AlertCircle size={14} className="text-red-400" />
  }

  const formatDate = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days} gün önce`
    if (hours > 0) return `${hours} saat önce`
    if (minutes > 0) return `${minutes} dakika önce`
    return 'Az önce'
  }

  const formatFullDate = (date: Date) => {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date)
  }

  return (
    <div className="fade-in relative z-10 min-h-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Gönderim günlüğü</h2>
          <p className="text-white/50 text-base font-medium max-w-2xl">
            Başarılı gönderimler, bilgi satırları ve hatalar hesap ve alıcıya göre gruplanır. Kayıtlar yalnızca bu
            tarayıcıda (localStorage) tutulur.
          </p>
        </div>
        {errorLogs.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Tüm gönderim kayıtlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
                clearErrorLogs()
              }
            }}
            className="btn-primary flex items-center gap-2 px-6 py-3 rounded-xl font-semibold"
          >
            <Trash2 size={20} />
            Tüm kayıtları sil
          </button>
        )}
      </div>

      {errorLogs.length === 0 ? (
        <div className="text-center py-24 surface-muted rounded-2xl shadow-2xl fade-in">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
            <AlertCircle size={48} className="text-white/40" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">
            Henüz kayıt yok
          </h3>
          <p className="text-white/50 text-sm mb-8 font-medium max-w-md mx-auto">
            Zamanlayıcı gönderimleri çalıştıkça başarı ve hata satırları burada listelenir.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(logsByAccount).map(([accountId, accountData]) => {
            const isExpanded = expandedAccounts.has(accountId)
            const account = accounts.find((a) => a.id === accountId)
            const groupLogs = logsByGroup[accountId] || {}
            const groupCount = Object.keys(groupLogs).length

            return (
              <div
                key={accountId}
                className="surface-panel rounded-2xl overflow-hidden shadow-2xl fade-in"
              >
                {/* Hesap Header */}
                <button
                  onClick={() => toggleAccount(accountId)}
                  className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1 text-left">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/15 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
                      <User size={24} className="text-white/80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg mb-1 truncate">
                        {account?.firstName || account?.phoneNumber || accountData.account.phoneNumber || 'Bilinmeyen Hesap'}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-white/50">
                        <span className="flex items-center gap-1.5">
                          <MessageSquare size={14} />
                          {accountData.logs.length} kayıt
                        </span>
                        <span className="flex items-center gap-1.5">
                          <AlertCircle size={14} />
                          {groupCount} alıcı
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${getLogTypeColor(accountData.logs[0]?.logType || 'error', accountData.logs[0]?.errorType)}`}>
                      {getLogTypeLabel(accountData.logs[0]?.logType || 'error', accountData.logs[0]?.errorType)}
                    </div>
                    {isExpanded ? (
                      <ChevronUp size={20} className="text-white/60" />
                    ) : (
                      <ChevronDown size={20} className="text-white/60" />
                    )}
                  </div>
                </button>

                {/* Hesap İçeriği */}
                {isExpanded && (
                  <div className="px-6 pb-6 space-y-3 border-t border-white/10 pt-4">
                    {Object.entries(groupLogs).map(([username, groupErrors]) => {
                      const groupKey = `${accountId}-${username}`
                      const isGroupExpanded = expandedGroups.has(groupKey)

                      return (
                        <div
                          key={username}
                          className="surface-muted rounded-xl overflow-hidden"
                        >
                          {/* Grup Header */}
                          <button
                            onClick={() => toggleGroup(accountId, username)}
                            className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center gap-3 flex-1 text-left">
                              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                                <MessageSquare size={18} className="text-white/60" />
                              </div>
                              <div>
                                <h4 className="font-bold text-white text-sm mb-1">
                                  {username}
                                </h4>
                                <p className="text-xs text-white/50">
                                  {groupErrors.length} kayıt
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 ${getLogTypeColor(groupErrors[0]?.logType || 'info', groupErrors[0]?.errorType)}`}>
                                {getLogTypeIcon(groupErrors[0]?.logType || 'info')}
                                {getLogTypeLabel(groupErrors[0]?.logType || 'info', groupErrors[0]?.errorType)}
                              </div>
                              {isGroupExpanded ? (
                                <ChevronUp size={16} className="text-white/60" />
                              ) : (
                                <ChevronDown size={16} className="text-white/60" />
                              )}
                            </div>
                          </button>

                          {/* Grup Hataları */}
                          {isGroupExpanded && (
                            <div className="px-4 pb-4 space-y-2 border-t border-white/10 pt-3">
                              {groupErrors.map((log) => (
                                <div
                                  key={log.id}
                                  className="surface-panel rounded-lg p-4"
                                >
                                  <div className="flex items-start justify-between gap-4 mb-2">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-2">
                                        <div className={`px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 ${getLogTypeColor(log.logType, log.errorType)}`}>
                                          {getLogTypeIcon(log.logType)}
                                          {getLogTypeLabel(log.logType, log.errorType)}
                                        </div>
                                        <span className="text-xs text-white/40 flex items-center gap-1">
                                          <Clock size={12} />
                                          {formatDate(log.timestamp)}
                                        </span>
                                      </div>
                                      <p className={`text-sm font-medium ${log.logType === 'success' ? 'text-green-300' : log.logType === 'error' ? 'text-red-300' : 'text-white/80'}`}>
                                        {log.message}
                                      </p>
                                    </div>
                                  </div>
                                  <p className="text-xs text-white/30 mt-2">
                                    {formatFullDate(log.timestamp)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
