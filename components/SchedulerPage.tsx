'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus,
  Trash2,
  Play,
  Pause,
  Clock,
  Edit,
  Eye,
  EyeOff,
  Loader2,
  Users,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore, ScheduledMessage } from '@/store/appStore'
import { messageScheduler } from '@/lib/scheduler'
import {
  telegramManager,
  memberToSendTarget,
  parseCustomPeerList,
  peerTargetsToCustomListLines,
  validateCustomPeerListInput,
  type JoinedGroupInfo,
} from '@/lib/telegram'

/** Yerel saat için datetime-local input değeri (YYYY-MM-DDTHH:mm) */
function toDatetimeLocalString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

export default function SchedulerPage() {
  const accounts = useAppStore((state) => state.accounts)
  const apiConfig = useAppStore((state) => state.apiConfig)
  const messageTemplates = useAppStore((state) => state.messageTemplates)
  const scheduledMessages = useAppStore((state) => state.scheduledMessages)
  const addScheduledMessage = useAppStore((state) => state.addScheduledMessage)
  const removeScheduledMessage = useAppStore((state) => state.removeScheduledMessage)
  const updateScheduledMessage = useAppStore((state) => state.updateScheduledMessage)
  const addErrorLog = useAppStore((state) => state.addErrorLog)
  const pushToast = useAppStore((state) => state.pushToast)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [usernames, setUsernames] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [delayBetweenMessages, setDelayBetweenMessages] = useState(3000) // 3 saniye
  const [delayBetweenAccounts, setDelayBetweenAccounts] = useState(5000) // 5 saniye

  const [recipientMode, setRecipientMode] = useState<'manual' | 'group_members' | 'custom_list'>('manual')
  const [customListRaw, setCustomListRaw] = useState('')
  const [groupsForPicker, setGroupsForPicker] = useState<JoinedGroupInfo[]>([])
  const [selectedGroup, setSelectedGroup] = useState<JoinedGroupInfo | null>(null)
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState('')

  const customListValidation = useMemo(
    () => validateCustomPeerListInput(customListRaw),
    [customListRaw]
  )

  const connectedAccounts = accounts.filter((acc) => acc.isConnected)
  const initializedRef = useRef(false)
  const [timeRemaining, setTimeRemaining] = useState<Map<string, string>>(new Map())
  const [visiblePhones, setVisiblePhones] = useState<Set<string>>(new Set())
  const [modalPortalReady, setModalPortalReady] = useState(false)

  useEffect(() => {
    setModalPortalReady(true)
  }, [])

  useEffect(() => {
    if (!scheduledAt && !editingMessageId) {
      setScheduledAt(toDatetimeLocalString(new Date()))
    }
  }, [])

  useEffect(() => {
    if (!showAddModal || recipientMode !== 'group_members') return
    if (!selectedAccountId) {
      setGroupsForPicker([])
      setGroupsError('')
      return
    }
    const account = accounts.find((a) => a.id === selectedAccountId)
    if (!account?.sessionString) {
      setGroupsForPicker([])
      setGroupsError('Seçili hesapta oturum yok')
      return
    }
    let cancelled = false
    setLoadingGroups(true)
    setGroupsError('')
    const apiId = account.apiId || apiConfig?.apiId
    const apiHash = account.apiHash || apiConfig?.apiHash
    void telegramManager
      .getJoinedGroups(
        account.id,
        account.sessionString,
        account.phoneNumber,
        apiId,
        apiHash
      )
      .then((res) => {
        if (cancelled) return
        if (res.success && res.groups) {
          setGroupsForPicker(res.groups)
          setGroupsError('')
        } else {
          setGroupsForPicker([])
          setGroupsError(res.error || 'Gruplar yüklenemedi')
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setGroupsForPicker([])
        setGroupsError(e instanceof Error ? e.message : 'Hata')
      })
      .finally(() => {
        if (!cancelled) setLoadingGroups(false)
      })
    return () => {
      cancelled = true
    }
  }, [showAddModal, recipientMode, selectedAccountId, accounts, apiConfig])

  // Kalan süreyi hesapla ve güncelle (tüm mesajlar için)
  useEffect(() => {
    const updateTimeRemaining = () => {
      const newTimeRemaining = new Map<string, string>()
      
      scheduledMessages.forEach((msg) => {
        const now = new Date().getTime()
        const scheduledTime = new Date(msg.scheduledTime).getTime()
        const diff = scheduledTime - now
        
        if (msg.isActive) {
          // Tüm mesajlar gönderildiyse "Gönderildi" göster
          if (msg.sentCount >= msg.totalCount && msg.totalCount > 0) {
            newTimeRemaining.set(msg.id, 'Gönderildi ✓')
          } else if (diff > 0) {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24))
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
            const seconds = Math.floor((diff % (1000 * 60)) / 1000)
            
            let timeStr = ''
            if (days > 0) timeStr += `${days}g `
            if (hours > 0) timeStr += `${hours}s `
            if (minutes > 0) timeStr += `${minutes}d `
            timeStr += `${seconds}sn`
            
            newTimeRemaining.set(msg.id, timeStr)
          } else {
            // Zamanı geçti ama henüz gönderilmediyse
            if (msg.sentCount < msg.totalCount) {
              newTimeRemaining.set(msg.id, 'Gönderiliyor...')
            } else {
              newTimeRemaining.set(msg.id, 'Gönderildi ✓')
            }
          }
        } else {
          // Pasif durumda - tüm mesajlar gönderildiyse "Gönderildi" göster
          if (msg.sentCount >= msg.totalCount && msg.totalCount > 0) {
            newTimeRemaining.set(msg.id, 'Gönderildi ✓')
          } else if (diff > 0) {
            const days = Math.floor(diff / (1000 * 60 * 60 * 24))
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
            const seconds = Math.floor((diff % (1000 * 60)) / 1000)
            
            let timeStr = ''
            if (days > 0) timeStr += `${days}g `
            if (hours > 0) timeStr += `${hours}s `
            if (minutes > 0) timeStr += `${minutes}d `
            timeStr += `${seconds}sn`
            
            newTimeRemaining.set(msg.id, timeStr)
          } else {
            newTimeRemaining.set(msg.id, 'Zamanı geçti')
          }
        }
      })
      
      setTimeRemaining(newTimeRemaining)
    }

    updateTimeRemaining()
    const interval = setInterval(updateTimeRemaining, 1000)

    return () => clearInterval(interval)
  }, [scheduledMessages])

  // Sayfa yüklendiğinde aktif mesajları kontrol et ve başlat
  useEffect(() => {
    // Sadece ilk yüklemede ve veriler hazır olduğunda çalış
    if (initializedRef.current) return
    if (scheduledMessages.length === 0 || messageTemplates.length === 0) return
    
    initializedRef.current = true
    
    console.log('🔄 Aktif mesajlar başlatılıyor...', {
      scheduledMessagesCount: scheduledMessages.length,
      messageTemplatesCount: messageTemplates.length
    })
    
    const initializeActiveMessages = async () => {
      for (const scheduledMessage of scheduledMessages) {
        console.log('🔍 Mesaj kontrol ediliyor:', {
          id: scheduledMessage.id,
          isActive: scheduledMessage.isActive,
          scheduledTime: new Date(scheduledMessage.scheduledTime).toISOString()
        })
        
        if (scheduledMessage.isActive) {
          const template = messageTemplates.find(
            (t) => t.id === scheduledMessage.messageTemplateId
          )
          if (!template) {
            console.warn('⚠️ Şablon bulunamadı, mesaj pasif yapılıyor:', scheduledMessage.id)
            updateScheduledMessage(scheduledMessage.id, { isActive: false })
            continue
          }

          // Mesaj zaten zamanlanmış mı kontrol et
          if (messageScheduler.isMessageActive(scheduledMessage.id)) {
            console.log('⏭️ Mesaj zaten zamanlanmış, atlanıyor:', scheduledMessage.id)
            continue // Zaten zamanlanmış, tekrar zamanlama
          }

          console.log('⏰ Mesaj zamanlanıyor:', scheduledMessage.id)
          
          // Zamanlayıcıya ekle (zamanı geçmişse delay 0 olacak ve hemen gönderilecek)
          await messageScheduler.scheduleMessage(
            scheduledMessage,
            (id) => messageTemplates.find((t) => t.id === id),
            (id, sent, total, done) => {
              console.log('📊 İlerleme güncellendi:', { id, sent, total, done })
              /** done veya tümü gönderildi: store'daki isActive kapatılır (closure'daki eski scheduledMessages güvenilmez) */
              if (done === true || (sent >= total && total > 0)) {
                updateScheduledMessage(id, { sentCount: sent, totalCount: total, isActive: false })
              } else {
                updateScheduledMessage(id, { sentCount: sent, totalCount: total })
              }
            },
            (accountId) => {
              const account = accounts.find((a) => a.id === accountId)
              return account ? { 
                sessionString: account.sessionString, 
                phoneNumber: account.phoneNumber,
                apiId: account.apiId,
                apiHash: account.apiHash
              } : undefined
            },
            (log) => {
              addErrorLog({ ...log })
            },
            (err, messageId) => {
              const msg = err instanceof Error ? err.message : String(err)
              pushToast(msg, 'error')
              updateScheduledMessage(messageId, { isActive: false })
            }
          )
        }
      }
      
      console.log('✅ Aktif mesajlar başlatma tamamlandı')
    }

    initializeActiveMessages()
  }, [scheduledMessages, messageTemplates, accounts, updateScheduledMessage, addErrorLog, pushToast])

  const handleAdd = async () => {
    if (!selectedAccountId || !selectedTemplateId || !scheduledAt) {
      pushToast('Hesap, şablon ve gönderim tarihi/saati alanlarını doldurun', 'info')
      return
    }

    const scheduledDateTime = new Date(scheduledAt)
    if (Number.isNaN(scheduledDateTime.getTime())) {
      pushToast('Geçerli bir tarih ve saat seçin', 'info')
      return
    }

    const accountIds = [selectedAccountId]

    if (recipientMode === 'manual' && !usernames.trim()) {
      pushToast('Alıcı listesini doldurun veya başka bir alıcı modunu seçin', 'info')
      return
    }

    if (recipientMode === 'custom_list' && !customListRaw.trim()) {
      pushToast(
        'Özel listeyi yapıştırın (satır başına: kullanıcı ID | access hash veya kullanıcı | ID | access hash)',
        'info'
      )
      return
    }

    if (recipientMode === 'group_members' && !selectedGroup) {
      pushToast('Bir grup seçin', 'info')
      return
    }

    let usernameList: string[] = []
    let totalCount = 0
    let mode: 'manual' | 'group_members' | 'custom_list' = 'manual'
    let groupTarget: JoinedGroupInfo | undefined
    let savedCustomRaw: string | undefined = undefined

    if (recipientMode === 'manual') {
      usernameList = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
      if (usernameList.length === 0) {
        pushToast('En az bir alıcı kullanıcı adı veya kanal tanımlayın', 'info')
        return
      }
      totalCount = accountIds.length * usernameList.length
      mode = 'manual'
    } else if (recipientMode === 'custom_list') {
      const { targets, errors } = parseCustomPeerList(customListRaw)
      if (errors.length > 0) {
        pushToast(errors.join('\n'), 'error')
        return
      }
      if (targets.length === 0) {
        pushToast('En az bir geçerli satır girin.', 'info')
        return
      }
      usernameList = targets
      totalCount = accountIds.length * usernameList.length
      mode = 'custom_list'
      savedCustomRaw = customListRaw.trim()
    } else {
      const firstAccount = accounts.find((a) => a.id === selectedAccountId)
      if (!firstAccount?.sessionString) {
        pushToast('Grup üyelerini kullanmak için seçili hesabın oturumu açık olmalı', 'error')
        return
      }
      const apiId = firstAccount.apiId || apiConfig?.apiId
      const apiHash = firstAccount.apiHash || apiConfig?.apiHash
      const res = await telegramManager.getGroupParticipants(
        firstAccount.id,
        firstAccount.sessionString,
        firstAccount.phoneNumber,
        apiId,
        apiHash,
        selectedGroup!
      )
      if (!res.success) {
        pushToast(res.error || 'Üye listesi alınamadı', 'error')
        return
      }
      const n = (res.members || [])
        .map((m) => memberToSendTarget(m))
        .filter((x): x is string => Boolean(x)).length
      if (n === 0) {
        pushToast(
          'Bu grupta özel mesaj gönderilecek üye yok (yalnızca botlar veya eksik kimlik)',
          'error'
        )
        return
      }
      usernameList = []
      totalCount = accountIds.length * n
      mode = 'group_members'
      groupTarget = selectedGroup!
    }

    // Düzenleme modunda mı?
    if (editingMessageId) {
      const existingMessage = scheduledMessages.find((m) => m.id === editingMessageId)
      if (existingMessage) {
        updateScheduledMessage(editingMessageId, {
          accountIds,
          usernames: usernameList,
          recipientMode: mode,
          groupTarget: mode === 'group_members' ? groupTarget : undefined,
          customListRaw: mode === 'custom_list' ? savedCustomRaw : undefined,
          messageTemplateId: selectedTemplateId,
          scheduledTime: scheduledDateTime,
          delayBetweenMessages,
          delayBetweenAccounts,
          totalCount,
          sentCount: 0,
        })
      }
    } else {
      const newScheduledMessage: ScheduledMessage = {
        id: Date.now().toString(),
        accountIds,
        usernames: usernameList,
        recipientMode: mode,
        groupTarget: mode === 'group_members' ? groupTarget : undefined,
        customListRaw: mode === 'custom_list' ? savedCustomRaw : undefined,
        messageTemplateId: selectedTemplateId,
        scheduledTime: scheduledDateTime,
        delayBetweenMessages,
        delayBetweenAccounts,
        isActive: false,
        sentCount: 0,
        totalCount,
      }

      addScheduledMessage(newScheduledMessage)
    }

    resetForm()
    setShowAddModal(false)
  }

  const resetForm = () => {
    setRecipientMode('manual')
    setCustomListRaw('')
    setSelectedGroup(null)
    setGroupsForPicker([])
    setGroupsError('')
    setEditingMessageId(null)
    setSelectedAccountId('')
    setUsernames('')
    setSelectedTemplateId('')
    setScheduledAt(toDatetimeLocalString(new Date()))
    setDelayBetweenMessages(3000)
    setDelayBetweenAccounts(5000)
  }

  const handleEdit = (scheduledMessage: ScheduledMessage) => {
    // Aktif mesajları düzenleyemez
    if (scheduledMessage.isActive) {
      pushToast('Çalışan gönderim düzenlenemez. Önce durdurun, sonra tekrar deneyin.', 'info')
      return
    }

    // Mesajı durdur (eğer zamanlanmışsa)
    messageScheduler.cancelMessage(scheduledMessage.id)

    // Formu doldur
    setEditingMessageId(scheduledMessage.id)
    setSelectedAccountId(scheduledMessage.accountIds[0] ?? '')
    const rm = scheduledMessage.recipientMode ?? 'manual'
    setRecipientMode(rm)
    setSelectedGroup(scheduledMessage.groupTarget ?? null)
    if (rm === 'custom_list') {
      setCustomListRaw(
        scheduledMessage.customListRaw ??
          peerTargetsToCustomListLines(scheduledMessage.usernames ?? [])
      )
      setUsernames('')
    } else {
      setCustomListRaw('')
      setUsernames(rm === 'group_members' ? '' : scheduledMessage.usernames.join('\n'))
    }
    setSelectedTemplateId(scheduledMessage.messageTemplateId)
    
    setScheduledAt(toDatetimeLocalString(new Date(scheduledMessage.scheduledTime)))
    setDelayBetweenMessages(scheduledMessage.delayBetweenMessages)
    setDelayBetweenAccounts(scheduledMessage.delayBetweenAccounts)
    
    setShowAddModal(true)
  }

  const handleStart = async (scheduledMessage: ScheduledMessage) => {
    console.log('▶️ Başlat butonuna tıklandı:', scheduledMessage.id)
    
    const template = messageTemplates.find(
      (t) => t.id === scheduledMessage.messageTemplateId
    )
    if (!template) {
      console.error('❌ Mesaj şablonu bulunamadı:', scheduledMessage.messageTemplateId)
      pushToast('Seçilen mesaj şablonu bulunamadı veya silinmiş olabilir', 'error')
      return
    }

    console.log('✅ Şablon bulundu:', template.name)
    console.log('📋 Mesaj detayları:', {
      id: scheduledMessage.id,
      scheduledTime: new Date(scheduledMessage.scheduledTime).toISOString(),
      accountIds: scheduledMessage.accountIds,
      usernames: scheduledMessage.usernames
    })

    updateScheduledMessage(scheduledMessage.id, { isActive: true })
    console.log('✅ Mesaj aktif yapıldı:', scheduledMessage.id)

    await messageScheduler.scheduleMessage(
      scheduledMessage,
      (id) => messageTemplates.find((t) => t.id === id),
      (id, sent, total, done) => {
        console.log('📊 İlerleme güncellendi:', { id, sent, total, done })
        if (done === true || (sent >= total && total > 0)) {
          updateScheduledMessage(id, { sentCount: sent, totalCount: total, isActive: false })
        } else {
          updateScheduledMessage(id, { sentCount: sent, totalCount: total })
        }
      },
      (accountId) => {
        const account = accounts.find((a) => a.id === accountId)
        return account ? { 
          sessionString: account.sessionString, 
          phoneNumber: account.phoneNumber,
          apiId: account.apiId,
          apiHash: account.apiHash
        } : undefined
      },
      (log) => {
        addErrorLog({ ...log })
      },
      (err, messageId) => {
        const msg = err instanceof Error ? err.message : String(err)
        pushToast(msg, 'error')
        updateScheduledMessage(messageId, { isActive: false })
      }
    )
    
    console.log('✅ Mesaj zamanlandı:', scheduledMessage.id)
  }

  const handleStop = (id: string) => {
    messageScheduler.cancelMessage(id)
    updateScheduledMessage(id, { isActive: false })
  }

  const handleDelete = (id: string) => {
    if (confirm('Bu zamanlanmış mesajı silmek istediğinize emin misiniz?')) {
      const message = scheduledMessages.find((m) => m.id === id)
      if (message?.isActive) {
        messageScheduler.cancelMessage(id)
      }
      removeScheduledMessage(id)
    }
  }

  const formatDateTime = (date: Date | string) => {
    const dateObj = date instanceof Date ? date : new Date(date)
    
    // Geçersiz tarih kontrolü
    if (isNaN(dateObj.getTime())) {
      return 'Geçersiz tarih'
    }
    
    return new Intl.DateTimeFormat('tr-TR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj)
  }

  return (
    <div className="fade-in relative z-10 min-h-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Zamanlayıcı</h2>
          <p className="text-white/50 text-base font-medium max-w-2xl">
            Tarih ve saat seçin, hesabı ve alıcıları eşleyin; mesajlar arası ve hesaplar arası gecikmeyi
            saniye cinsinden ayarlayın. Plan tek seferlik çalışır.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddModal(true)
          }}
          disabled={connectedAccounts.length === 0 || messageTemplates.length === 0}
          className="btn-primary flex items-center gap-2 px-6 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none"
        >
          <Plus size={20} />
          Zamanlama Ekle
        </button>
      </div>

      {connectedAccounts.length === 0 && (
        <div className="mb-6 p-5 surface-panel rounded-2xl fade-in shadow-xl">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-yellow-400 text-lg font-bold">!</span>
            </div>
            <div className="flex-1">
              <p className="text-yellow-400 font-bold mb-2 text-base">
                Bağlı hesap gerekli
              </p>
              <p className="text-white/60 text-sm leading-relaxed">
                Gönderim başlatmak için en az bir hesabın oturumu açık (bağlı) olmalıdır. Hesaplar sayfasından
                giriş yapın.
              </p>
            </div>
          </div>
        </div>
      )}

      {messageTemplates.length === 0 && (
        <div className="mb-6 p-5 surface-panel rounded-2xl fade-in shadow-xl">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-yellow-400 text-lg font-bold">!</span>
            </div>
            <div className="flex-1">
              <p className="text-yellow-400 font-bold mb-2 text-base">
                Mesaj şablonu gerekli
              </p>
              <p className="text-white/60 text-sm leading-relaxed">
                Gönderilecek metin bir şablondan seçilir. Önce Mesaj şablonları bölümünde en az bir şablon
                oluşturun.
              </p>
            </div>
          </div>
        </div>
      )}

      {scheduledMessages.length === 0 ? (
        <div className="text-center py-24 surface-muted rounded-2xl shadow-2xl fade-in">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
            <Clock size={48} className="text-white/40" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">
            Planlanmış gönderim yok
          </h3>
          <p className="text-white/50 text-sm mb-8 font-medium max-w-md mx-auto">
            Zamanlama Ekle ile şablon, hesap, alıcılar ve gönderim zamanını seçin.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-fr">
          {scheduledMessages.map((scheduledMessage, index) => {
            const template = messageTemplates.find(
              (t) => t.id === scheduledMessage.messageTemplateId
            )
            const selectedAccounts = accounts.filter((acc) =>
              scheduledMessage.accountIds?.includes(acc.id) || false
            )

            return (
              <div
                key={scheduledMessage.id}
                className="surface-panel rounded-xl p-4 card-hover shadow-xl fade-in electric-border relative overflow-hidden w-full"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-xl -mr-12 -mt-12" />
                
                <div className="flex flex-col gap-3 relative z-10">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-white text-lg mb-2 tracking-tight line-clamp-1">
                      {template?.name || 'Şablon silinmiş veya bulunamadı'}
                    </h3>
                  </div>
                  <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Tarih:</span>
                        <span className="text-white font-medium text-xs">{formatDateTime(scheduledMessage.scheduledTime)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Hesaplar:</span>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="text-white font-medium text-xs truncate">
                            {selectedAccounts.map((a) => 
                              visiblePhones.has(a.id) 
                                ? a.phoneNumber 
                                : '•'.repeat(a.phoneNumber.length)
                            ).join(', ')}
                          </span>
                          <button
                            onClick={() => {
                              const allVisible = selectedAccounts.every(a => visiblePhones.has(a.id))
                              const newVisible = new Set(visiblePhones)
                              selectedAccounts.forEach(a => {
                                if (allVisible) {
                                  newVisible.delete(a.id)
                                } else {
                                  newVisible.add(a.id)
                                }
                              })
                              setVisiblePhones(newVisible)
                            }}
                            className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
                            title={selectedAccounts.every(a => visiblePhones.has(a.id)) ? 'Gizle' : 'Göster'}
                          >
                            {selectedAccounts.every(a => visiblePhones.has(a.id)) ? (
                              <EyeOff size={12} className="text-white/40 hover:text-white" />
                            ) : (
                              <Eye size={12} className="text-white/40 hover:text-white" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Alıcılar:</span>
                        <span className="text-white font-medium text-xs line-clamp-2">
                          {(scheduledMessage.recipientMode ?? 'manual') === 'group_members' &&
                          scheduledMessage.groupTarget ? (
                            <>
                              <Users className="inline w-3 h-3 mr-1 opacity-70 align-text-bottom" />
                              {scheduledMessage.groupTarget.title} — tüm üyeler
                            </>
                          ) : (scheduledMessage.recipientMode ?? 'manual') === 'custom_list' ? (
                            <>Özel liste (ID + access hash): {scheduledMessage.usernames?.length || 0} alıcı</>
                          ) : (
                            <>{scheduledMessage.usernames?.length || 0} alıcı</>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Mesajlar Arası:</span>
                        <span className="text-white font-medium text-xs">{scheduledMessage.delayBetweenMessages / 1000}s</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Hesaplar Arası:</span>
                        <span className="text-white font-medium text-xs">{scheduledMessage.delayBetweenAccounts / 1000}s</span>
                      </div>
                      {scheduledMessage.isActive && (
                        <>
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
                            <span className="text-green-400 font-semibold text-xs">İlerleme:</span>
                            <span className="text-green-400 font-bold text-xs">{scheduledMessage.sentCount} / {scheduledMessage.totalCount}</span>
                          </div>
                          {timeRemaining.get(scheduledMessage.id) && (
                            <div className="flex items-center gap-2">
                              <span className="text-blue-400 font-semibold text-xs">Durum:</span>
                              <span className="text-blue-400 font-bold text-xs">{timeRemaining.get(scheduledMessage.id)}</span>
                            </div>
                          )}
                        </>
                      )}
                      {!scheduledMessage.isActive && timeRemaining.get(scheduledMessage.id) && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
                          <span className="text-yellow-400 font-semibold text-xs">Durum:</span>
                          <span className="text-yellow-400 font-bold text-xs">{timeRemaining.get(scheduledMessage.id)}</span>
                        </div>
                      )}
                    </div>
                  <div className="flex gap-2 mt-3 relative z-10 flex-wrap">
                    {scheduledMessage.isActive ? (
                      <button
                        onClick={() => handleStop(scheduledMessage.id)}
                        className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-semibold border border-red-500/20 hover:border-red-500/30 transition-all flex items-center gap-1.5 text-xs"
                      >
                        <Pause size={14} />
                        Durdur
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStart(scheduledMessage)}
                          className="px-3 py-2 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-lg font-semibold border border-green-500/20 hover:border-green-500/30 transition-all flex items-center gap-1.5 text-xs"
                        >
                          <Play size={14} />
                          Başlat
                        </button>
                        <button
                          onClick={() => handleEdit(scheduledMessage)}
                          className="px-2.5 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg font-semibold border border-blue-500/20 hover:border-blue-500/30 transition-all"
                          title="Düzenle"
                        >
                          <Edit size={14} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(scheduledMessage.id)}
                      className="px-2.5 py-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-red-400 rounded-lg font-semibold border border-white/10 hover:border-red-500/20 transition-all"
                      title="Sil"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modalPortalReady &&
        showAddModal &&
        createPortal(
          <div className="fixed inset-0 surface-modal-overlay backdrop-blur-md z-[100] overflow-y-auto overflow-x-hidden fade-in flex min-h-0 items-start justify-center p-4 sm:p-6 sm:items-center">
          <div
            className="surface-modal isolate rounded-2xl w-full max-w-xl shadow-2xl fade-in relative flex flex-col max-h-[min(92vh,calc(100dvh-2rem))] min-h-0 my-auto overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduler-modal-title"
          >
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl"
              aria-hidden
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -ml-32 -mb-32" />
            </div>

            <h3
              id="scheduler-modal-title"
              className="text-xl font-bold text-white px-6 pt-6 pb-3 tracking-tight relative z-20 shrink-0 rounded-t-2xl border-b border-white/[0.08] bg-[rgba(10,10,12,0.98)] backdrop-blur-md"
            >
              {editingMessageId ? 'Zamanlamayı Düzenle' : 'Yeni Zamanlama'}
            </h3>

            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1 sm:max-w-md">
                  <label
                    htmlFor="scheduler-account"
                    className="text-sm text-white/50 font-medium shrink-0"
                  >
                    Hesap
                  </label>
                  <select
                    id="scheduler-account"
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="input-focus flex-1 min-w-0 px-4 py-2.5 rounded-xl text-white text-sm"
                  >
                    <option value="">— Hesap seçin —</option>
                    {connectedAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.firstName || a.phoneNumber}
                        {a.username ? ` (@${a.username})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <span className="block text-sm font-bold text-white mb-2 tracking-tight">
                  Alıcılar
                </span>
                <div className="flex flex-col gap-2 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="recipientMode"
                      checked={recipientMode === 'manual'}
                      onChange={() => setRecipientMode('manual')}
                      className="accent-white"
                    />
                    <span className="text-white text-sm">Manuel liste (satır satır kullanıcı / grup)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="recipientMode"
                      checked={recipientMode === 'group_members'}
                      onChange={() => setRecipientMode('group_members')}
                      className="accent-white"
                    />
                    <span className="text-white text-sm">
                      Seçili gruptaki tüm üyelere (hesabın gruplarından seçin)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="recipientMode"
                      checked={recipientMode === 'custom_list'}
                      onChange={() => setRecipientMode('custom_list')}
                      className="accent-white"
                    />
                    <span className="text-white text-sm">
                      Özel liste (ID | hash veya kullanıcı | ID | hash)
                    </span>
                  </label>
                </div>

                {recipientMode === 'manual' ? (
                  <>
                    <label className="block text-xs font-semibold text-white/70 mb-1">
                      Kullanıcı/Grup adları (her satıra bir)
                    </label>
                    <textarea
                      value={usernames}
                      onChange={(e) => setUsernames(e.target.value)}
                      placeholder="kullanici1&#10;@grup_adi&#10;kullanici2"
                      rows={4}
                      className="input-focus w-full px-3 py-2.5 rounded-xl text-white placeholder-white/30 focus:outline-none resize-none text-sm"
                    />
                    <p className="text-xs text-white/40 mt-2 font-medium">
                      Kullanıcılar: kullanici_adi veya @kullanici_adi · Gruplar: @grup_adi
                    </p>
                  </>
                ) : recipientMode === 'custom_list' ? (
                  <>
                    <label className="block text-xs font-semibold text-white/70 mb-1">
                      Özel alıcı listesi (satır başına iki veya üç sütun)
                    </label>
                    <textarea
                      value={customListRaw}
                      onChange={(e) => setCustomListRaw(e.target.value)}
                      placeholder={
                        '8561815348 | -8130815157666801329\n@kullanici | 6042072565 | 2382142223508890304'
                      }
                      rows={8}
                      className={`input-focus w-full px-3 py-2.5 rounded-xl text-white placeholder-white/25 focus:outline-none resize-y text-sm font-mono transition-shadow ${
                        customListRaw.trim() && customListValidation.isValid
                          ? 'ring-2 ring-emerald-500/35'
                          : customListRaw.trim() && !customListValidation.isValid
                            ? 'ring-2 ring-amber-500/30'
                            : ''
                      }`}
                    />
                    {customListRaw.trim() !== '' && (
                      <div className="mt-2 space-y-2" aria-live="polite">
                        {customListValidation.isValid ? (
                          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/[0.12] px-3 py-2.5 text-xs text-emerald-100/95">
                            <CheckCircle2 size={17} className="shrink-0 text-emerald-400" aria-hidden />
                            <span className="font-semibold">
                              Format doğru — {customListValidation.recipientCount} alıcı
                            </span>
                          </div>
                        ) : (
                          <>
                            {customListValidation.issues.length > 0 && (
                              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.1] px-3 py-2.5 text-xs">
                                <div className="flex items-center gap-2 font-semibold text-amber-200/95 mb-1.5">
                                  <AlertTriangle size={15} className="shrink-0 text-amber-400" aria-hidden />
                                  Düzeltme gerekli
                                </div>
                                <ul className="list-disc pl-4 space-y-1 text-amber-100/85 leading-snug">
                                  {customListValidation.issues.slice(0, 10).map((msg, idx) => (
                                    <li key={idx}>{msg}</li>
                                  ))}
                                </ul>
                                {customListValidation.issues.length > 10 && (
                                  <p className="mt-1.5 text-amber-200/55 pl-4">… ve diğerleri</p>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-white/40 mt-2 font-medium leading-relaxed">
                      <span className="text-white/55">2 sütun:</span> kullanıcı ID <span className="text-white/55">|</span> access
                      hash (Gruplar üyesi tablosundan kopyalayabilirsiniz).{' '}
                      <span className="text-white/55">3 sütun:</span> kullanıcı adı (isteğe @){' '}
                      <span className="text-white/55">|</span> ID <span className="text-white/55">|</span> hash — geçerli
                      kullanıcı adı varsa önce o ile çözülür. Boş satırlar yok sayılır.
                    </p>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-white/50">
                      Gönderim, plan çalıştığında gruptan güncel üye listesi ile yapılır. Botlar atlanır.
                    </p>
                    {!selectedAccountId && (
                      <p className="text-xs text-amber-400/90">Önce yukarıdan bir hesap seçin.</p>
                    )}
                    {loadingGroups && (
                      <div className="flex items-center gap-2 text-white/60 text-sm py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Gruplar yükleniyor…
                      </div>
                    )}
                    {groupsError && (
                      <p className="text-xs text-red-400">{groupsError}</p>
                    )}
                    {!loadingGroups && recipientMode === 'group_members' && selectedAccountId && (
                      <select
                        value={selectedGroup?.id ?? ''}
                        onChange={(e) => {
                          const g = groupsForPicker.find((x) => x.id === e.target.value)
                          setSelectedGroup(g ?? null)
                        }}
                        className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                      >
                        <option value="">Grup seçin…</option>
                        {groupsForPicker.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title}
                            {g.username ? ` (@${g.username.replace(/^@/, '')})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold text-white mb-2 tracking-tight">
                  Mesaj Şablonu
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                >
                  <option value="">Şablon seçin...</option>
                  {messageTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="scheduler-datetime"
                  className="block text-sm font-bold text-white mb-2 tracking-tight"
                >
                  Gönderim tarihi ve saati
                </label>
                <input
                  id="scheduler-datetime"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm [color-scheme:dark]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-white mb-2 tracking-tight">
                    Mesajlar Arası Gecikme (saniye)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={delayBetweenMessages / 1000}
                    onChange={(e) =>
                      setDelayBetweenMessages(parseInt(e.target.value) * 1000)
                    }
                    className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                  />
                  <p className="text-xs text-white/40 mt-1 font-medium">
                    Önerilen: 3-5 saniye
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-white mb-2 tracking-tight">
                    Hesaplar Arası Gecikme (saniye)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={delayBetweenAccounts / 1000}
                    onChange={(e) =>
                      setDelayBetweenAccounts(parseInt(e.target.value) * 1000)
                    }
                    className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                  />
                  <p className="text-xs text-white/40 mt-1 font-medium">
                    Önerilen: 5-10 saniye
                  </p>
                </div>
              </div>
            </div>
            </div>

            <div className="shrink-0 relative z-20 flex gap-3 px-6 py-4 border-t border-white/[0.08] bg-[rgba(10,10,12,0.98)] backdrop-blur-md rounded-b-2xl">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false)
                  resetForm()
                }}
                className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all"
              >
                İptal
              </button>
              <button type="button" onClick={handleAdd} className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold">
                {editingMessageId ? 'Kaydet' : 'Ekle'}
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}

