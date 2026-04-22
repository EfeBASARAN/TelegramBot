'use client'

import { useState, useEffect, useMemo } from 'react'
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
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import { useAppStore, ScheduledMessage } from '@/store/appStore'
import { messageScheduler } from '@/lib/scheduler'
import { getSchedulerScheduleMessageArgs } from '@/lib/schedulerClient'
import SchedulerRunProgress from '@/components/SchedulerRunProgress'
import {
  telegramManager,
  memberToSendTarget,
  parseCustomPeerList,
  peerTargetsToCustomListLines,
  validateCustomPeerListInput,
  type JoinedGroupInfo,
} from '@/lib/telegram'
import { TELEGRAM_PARTICIPANTS_ADMIN_NOTICE_TR } from '@/lib/telegramErrorMessages'

/** Yerel saat için datetime-local input değeri (YYYY-MM-DDTHH:mm) */
function toDatetimeLocalString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}:${min}`
}

/** Üye sayısına göre azalan (yüksek üstte); bilinmeyenler sonda, eşitlikte başlık. */
function sortGroupsByMemberCount(groups: JoinedGroupInfo[]): JoinedGroupInfo[] {
  return [...groups].sort((a, b) => {
    const ca = a.membersCount
    const cb = b.membersCount
    if (ca == null && cb == null) {
      return a.title.localeCompare(b.title, 'tr', { sensitivity: 'base' })
    }
    if (ca == null) return 1
    if (cb == null) return -1
    if (cb !== ca) return cb - ca
    return a.title.localeCompare(b.title, 'tr', { sensitivity: 'base' })
  })
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
  /** Seçili hesaplar; sıra `connectedAccounts` listesindeki sıradır (bölüştürmede önemli). */
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set())
  const [accountDistribution, setAccountDistribution] = useState<
    'each_to_all' | 'split_recipients'
  >('each_to_all')
  const [usernames, setUsernames] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [delayBetweenMessages, setDelayBetweenMessages] = useState(3000) // 3 saniye
  const [delayBetweenAccounts, setDelayBetweenAccounts] = useState(5000) // 5 saniye
  /** Boş: tek tur. Dolu: bu zamana kadar her tur bitince yeniden başlar (datetime-local) */
  const [repeatUntilAt, setRepeatUntilAt] = useState('')

  const [recipientMode, setRecipientMode] = useState<
    'manual' | 'group_members' | 'custom_list' | 'joined_groups'
  >('manual')
  const [customListRaw, setCustomListRaw] = useState('')
  const [groupsForPicker, setGroupsForPicker] = useState<JoinedGroupInfo[]>([])
  const [selectedGroup, setSelectedGroup] = useState<JoinedGroupInfo | null>(null)
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [groupsError, setGroupsError] = useState('')
  /** Grup modunda: üye listesi / getJoinedGroups bu hesapla (gönderimdeki çoklu seçimden ayrı). */
  const [groupListAccountId, setGroupListAccountId] = useState('')
  const [joinedGroupsLoading, setJoinedGroupsLoading] = useState(false)
  const [joinedGroupsError, setJoinedGroupsError] = useState('')

  const customListValidation = useMemo(
    () => validateCustomPeerListInput(customListRaw),
    [customListRaw]
  )

  const selectedTemplateAntiSpam = useMemo(
    () => messageTemplates.find((t) => t.id === selectedTemplateId)?.antiSpamDelay === true,
    [messageTemplates, selectedTemplateId]
  )

  const connectedAccounts = accounts.filter((acc) => acc.isConnected)

  /** Adım 3 özet önizlemesi (hesaplar, alıcılar, şablon, zaman) */
  const schedulerPreview = useMemo(() => {
    const accountLabels = connectedAccounts
      .filter((a) => selectedAccountIds.has(a.id))
      .map((a) => `${a.firstName || a.phoneNumber}${a.username ? ` (@${a.username})` : ''}`)

    const distLabel =
      accountDistribution === 'each_to_all'
        ? 'Her hesap tüm alıcılara'
        : 'Alıcıları hesaplara böl'

    let recipientTitle = ''
    let recipientExtra = ''
    if (recipientMode === 'manual') {
      const n = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0).length
      recipientTitle = `Manuel liste · ${n} satır`
    } else if (recipientMode === 'custom_list') {
      const n = customListValidation.isValid ? customListValidation.recipientCount : null
      recipientTitle =
        n != null ? `Özel liste · ${n} alıcı` : 'Özel liste · formatı kontrol edin'
    } else if (recipientMode === 'group_members') {
      recipientTitle = 'Seçili grup üyeleri'
      recipientExtra = selectedGroup
        ? `${selectedGroup.title}${
            selectedGroup.username
              ? ` (@${selectedGroup.username.replace(/^@/, '')})`
              : ''
          }${
            selectedGroup.membersCount != null
              ? ` · ~${selectedGroup.membersCount.toLocaleString('tr-TR')} üye (yaklaşık)`
              : ''
          }`
        : 'Grup seçilmedi'
    } else {
      const n = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0).length
      recipientTitle = `Katıldığım gruplar · ${n} kullanıcı adı`
      recipientExtra = groupListAccountId
        ? 'Liste, seçilen hesabın katıldığı kullanıcı adlı gruplardan otomatik doldurulur.'
        : 'Hesap seçilmedi'
    }

    const tmpl = messageTemplates.find((t) => t.id === selectedTemplateId)
    const contentSnippet = tmpl
      ? tmpl.content.length > 320
        ? `${tmpl.content.slice(0, 320)}…`
        : tmpl.content
      : ''

    let scheduledLabel = '—'
    if (scheduledAt) {
      const d = new Date(scheduledAt)
      if (!Number.isNaN(d.getTime())) {
        scheduledLabel = d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
      }
    }

    let repeatUntilLabel = ''
    if (repeatUntilAt) {
      const d = new Date(repeatUntilAt)
      if (!Number.isNaN(d.getTime())) {
        repeatUntilLabel = d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
      }
    }

    return {
      accountLabels,
      distLabel,
      recipientTitle,
      recipientExtra,
      templateName: tmpl?.name ?? '',
      contentSnippet,
      scheduledLabel,
      repeatUntilLabel,
      delayMsgSec: delayBetweenMessages / 1000,
      delayAccSec: delayBetweenAccounts / 1000,
      antiSpam: selectedTemplateAntiSpam,
    }
  }, [
    connectedAccounts,
    selectedAccountIds,
    accountDistribution,
    recipientMode,
    usernames,
    customListValidation.isValid,
    customListValidation.recipientCount,
    selectedGroup,
    groupListAccountId,
    messageTemplates,
    selectedTemplateId,
    scheduledAt,
    repeatUntilAt,
    delayBetweenMessages,
    delayBetweenAccounts,
    selectedTemplateAntiSpam,
  ])

  const firstConnectedAccountId = connectedAccounts[0]?.id
  const groupListPickerValue = connectedAccounts.some((a) => a.id === groupListAccountId)
    ? groupListAccountId
    : ''
  const [timeRemaining, setTimeRemaining] = useState<Map<string, string>>(new Map())
  const [visiblePhones, setVisiblePhones] = useState<Set<string>>(new Set())
  const [modalPortalReady, setModalPortalReady] = useState(false)
  const [modalStep, setModalStep] = useState<1 | 2 | 3>(1)

  useEffect(() => {
    setModalPortalReady(true)
  }, [])

  useEffect(() => {
    if (!scheduledAt && !editingMessageId) {
      setScheduledAt(toDatetimeLocalString(new Date()))
    }
  }, [])

  /** Grup modlarında liste hesabı yoksa veya artık bağlı değilse ilk bağlı hesabı kullan. */
  useEffect(() => {
    if (!showAddModal || (recipientMode !== 'group_members' && recipientMode !== 'joined_groups')) return
    if (!firstConnectedAccountId) return
    setGroupListAccountId((prev) => {
      if (prev && connectedAccounts.some((a) => a.id === prev)) return prev
      return firstConnectedAccountId
    })
  }, [showAddModal, recipientMode, firstConnectedAccountId, connectedAccounts])

  useEffect(() => {
    if (!showAddModal || recipientMode !== 'group_members') return
    if (!groupListAccountId) {
      setGroupsForPicker([])
      setGroupsError(
        connectedAccounts.length === 0
          ? 'Grup listesi için önce bir hesabı bağlayın (Hesaplar sayfasından giriş).'
          : ''
      )
      return
    }
    const account = accounts.find((a) => a.id === groupListAccountId)
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
          const ordered = sortGroupsByMemberCount(res.groups)
          setGroupsForPicker(ordered)
          setGroupsError('')
          setSelectedGroup((prev) => {
            if (!prev) return prev
            const ok = ordered.some((g) => g.id === prev.id)
            return ok ? prev : null
          })
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
  }, [
    showAddModal,
    recipientMode,
    groupListAccountId,
    accounts,
    apiConfig,
    connectedAccounts.length,
  ])

  useEffect(() => {
    if (!showAddModal || recipientMode !== 'joined_groups') return
    if (!groupListAccountId) {
      setJoinedGroupsError(
        connectedAccounts.length === 0
          ? 'Grup listesi için önce bir hesabı bağlayın (Hesaplar sayfasından giriş).'
          : ''
      )
      setUsernames('')
      return
    }
    const account = accounts.find((a) => a.id === groupListAccountId)
    if (!account?.sessionString) {
      setJoinedGroupsError('Seçili hesapta oturum yok')
      setUsernames('')
      return
    }

    let cancelled = false
    setJoinedGroupsLoading(true)
    setJoinedGroupsError('')
    const apiId = account.apiId || apiConfig?.apiId
    const apiHash = account.apiHash || apiConfig?.apiHash
    void telegramManager
      .getJoinedGroupUsernames(
        account.id,
        account.sessionString,
        account.phoneNumber,
        apiId,
        apiHash
      )
      .then((res) => {
        if (cancelled) return
        if (!res.success) {
          setUsernames('')
          setJoinedGroupsError(res.error || 'Katılınan gruplar yüklenemedi')
          return
        }
        const list = res.usernames || []
        setUsernames(list.join('\n'))
        setJoinedGroupsError(
          list.length === 0
            ? 'Bu hesap için kullanıcı adı olan grup/kanal bulunamadı.'
            : ''
        )
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setUsernames('')
        setJoinedGroupsError(e instanceof Error ? e.message : 'Hata')
      })
      .finally(() => {
        if (!cancelled) setJoinedGroupsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    showAddModal,
    recipientMode,
    groupListAccountId,
    accounts,
    apiConfig,
    connectedAccounts.length,
  ])

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

  const handleAdd = async () => {
    if (!selectedTemplateId || !scheduledAt) {
      pushToast('Şablon ve gönderim tarihi/saati alanlarını doldurun', 'info')
      return
    }

    const accountIds = connectedAccounts
      .filter((a) => selectedAccountIds.has(a.id))
      .map((a) => a.id)
    if (accountIds.length === 0) {
      pushToast('En az bir bağlı hesap seçin', 'info')
      return
    }

    const scheduledDateTime = new Date(scheduledAt)
    if (Number.isNaN(scheduledDateTime.getTime())) {
      pushToast('Geçerli bir tarih ve saat seçin', 'info')
      return
    }

    let repeatUntilDate: Date | undefined
    if (repeatUntilAt.trim()) {
      const ru = new Date(repeatUntilAt)
      if (Number.isNaN(ru.getTime())) {
        pushToast('Bitiş tarihi ve saati geçerli değil', 'info')
        return
      }
      if (ru.getTime() <= scheduledDateTime.getTime()) {
        pushToast('Bitiş zamanı, ilk gönderim zamanından sonra olmalıdır', 'info')
        return
      }
      repeatUntilDate = ru
    }

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

    if (recipientMode === 'group_members') {
      if (!groupListAccountId) {
        pushToast('Grup listesi için bir hesap seçin', 'info')
        return
      }
      if (!connectedAccounts.some((a) => a.id === groupListAccountId)) {
        pushToast('Grup listesi hesabı bağlı değil veya geçersiz', 'info')
        return
      }
    }

    if (recipientMode === 'group_members' && !selectedGroup) {
      pushToast('Bir grup seçin', 'info')
      return
    }

    let usernameList: string[] = []
    let totalCount = 0
    let mode: 'manual' | 'group_members' | 'custom_list' | 'joined_groups' = 'manual'
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
      totalCount =
        accountDistribution === 'split_recipients'
          ? usernameList.length
          : accountIds.length * usernameList.length
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
      totalCount =
        accountDistribution === 'split_recipients'
          ? usernameList.length
          : accountIds.length * usernameList.length
      mode = 'custom_list'
      savedCustomRaw = customListRaw.trim()
    } else if (recipientMode === 'group_members') {
      const listAccount = accounts.find((a) => a.id === groupListAccountId)
      if (!listAccount?.sessionString) {
        pushToast('Grup listesi hesabının oturumu açık olmalı', 'error')
        return
      }
      const apiId = listAccount.apiId || apiConfig?.apiId
      const apiHash = listAccount.apiHash || apiConfig?.apiHash
      const res = await telegramManager.getGroupParticipants(
        listAccount.id,
        listAccount.sessionString,
        listAccount.phoneNumber,
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
      totalCount =
        accountDistribution === 'split_recipients' ? n : accountIds.length * n
      mode = 'group_members'
      groupTarget = selectedGroup!
    } else {
      usernameList = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
      if (usernameList.length === 0) {
        pushToast('Katıldığın gruplar listesi boş. Hesap seçip tekrar dene.', 'info')
        return
      }
      totalCount =
        accountDistribution === 'split_recipients'
          ? usernameList.length
          : accountIds.length * usernameList.length
      mode = 'joined_groups'
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
          groupListAccountId:
            mode === 'group_members' || mode === 'joined_groups' ? groupListAccountId : undefined,
          customListRaw: mode === 'custom_list' ? savedCustomRaw : undefined,
          messageTemplateId: selectedTemplateId,
          scheduledTime: scheduledDateTime,
          delayBetweenMessages,
          delayBetweenAccounts,
          accountDistribution,
          totalCount,
          sentCount: 0,
          repeatUntil: repeatUntilDate,
        })
      }
    } else {
      const newScheduledMessage: ScheduledMessage = {
        id: Date.now().toString(),
        accountIds,
        usernames: usernameList,
        recipientMode: mode,
        groupTarget: mode === 'group_members' ? groupTarget : undefined,
        groupListAccountId:
          mode === 'group_members' || mode === 'joined_groups' ? groupListAccountId : undefined,
        customListRaw: mode === 'custom_list' ? savedCustomRaw : undefined,
        messageTemplateId: selectedTemplateId,
        scheduledTime: scheduledDateTime,
        delayBetweenMessages,
        delayBetweenAccounts,
        accountDistribution,
        isActive: false,
        sentCount: 0,
        totalCount,
        repeatUntil: repeatUntilDate,
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
    setJoinedGroupsError('')
    setEditingMessageId(null)
    setSelectedAccountIds(new Set())
    setAccountDistribution('each_to_all')
    setUsernames('')
    setSelectedTemplateId('')
    setScheduledAt(toDatetimeLocalString(new Date()))
    setDelayBetweenMessages(3000)
    setDelayBetweenAccounts(5000)
    setRepeatUntilAt('')
    setGroupListAccountId('')
    setJoinedGroupsLoading(false)
    setModalStep(1)
  }

  const validateSchedulerStep1 = (): boolean => {
    const accountIds = connectedAccounts
      .filter((a) => selectedAccountIds.has(a.id))
      .map((a) => a.id)
    if (accountIds.length === 0) {
      pushToast('En az bir bağlı hesap seçin', 'info')
      return false
    }
    return true
  }

  const validateSchedulerStep2 = (): boolean => {
    if (recipientMode === 'manual') {
      const lines = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
      if (lines.length === 0) {
        pushToast('Alıcı listesini doldurun', 'info')
        return false
      }
    } else if (recipientMode === 'custom_list') {
      if (!customListRaw.trim()) {
        pushToast(
          'Özel listeyi yapıştırın (satır başına: kullanıcı ID | access hash veya kullanıcı | ID | access hash)',
          'info'
        )
        return false
      }
      if (!customListValidation.isValid) {
        pushToast('Özel liste satırlarını düzeltin', 'error')
        return false
      }
    } else if (recipientMode === 'group_members') {
      if (!groupListAccountId || !connectedAccounts.some((a) => a.id === groupListAccountId)) {
        pushToast('Grup listesi için bir hesap seçin', 'info')
        return false
      }
      if (loadingGroups) {
        pushToast('Gruplar yükleniyor, birkaç saniye bekleyin', 'info')
        return false
      }
      if (groupsError) {
        pushToast('Grup listesi yüklenemedi; hata mesajını kontrol edin', 'error')
        return false
      }
      if (!selectedGroup) {
        pushToast('Bir grup seçin', 'info')
        return false
      }
    } else if (recipientMode === 'joined_groups') {
      if (!groupListAccountId || !connectedAccounts.some((a) => a.id === groupListAccountId)) {
        pushToast('Grup listesi için bir hesap seçin', 'info')
        return false
      }
      if (joinedGroupsLoading) {
        pushToast('Katılınan gruplar yükleniyor, birkaç saniye bekleyin', 'info')
        return false
      }
      if (joinedGroupsError) {
        pushToast('Katılınan gruplar alınamadı; hata mesajını kontrol edin', 'error')
        return false
      }
      const lines = usernames
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
      if (lines.length === 0) {
        pushToast('Bu hesap için kullanıcı adı olan grup bulunamadı', 'info')
        return false
      }
    }
    return true
  }

  const goSchedulerBack = () => {
    setModalStep(modalStep === 3 ? 2 : 1)
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
    setSelectedAccountIds(new Set(scheduledMessage.accountIds ?? []))
    setAccountDistribution(scheduledMessage.accountDistribution ?? 'each_to_all')
    setGroupListAccountId(
      scheduledMessage.groupListAccountId ?? scheduledMessage.accountIds[0] ?? ''
    )
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
    setRepeatUntilAt(
      scheduledMessage.repeatUntil
        ? toDatetimeLocalString(new Date(scheduledMessage.repeatUntil))
        : ''
    )

    setModalStep(1)
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

    // Yarım kalan tur (hata / durdurma sonrası tekrar başlat): ilerlemeyi koru.
    // Tur bittiyse (sentCount >= totalCount) yeni çalıştırma için sayaç ve anahtarları sıfırla.
    const tourIncomplete =
      scheduledMessage.totalCount > 0 &&
      scheduledMessage.sentCount < scheduledMessage.totalCount

    updateScheduledMessage(scheduledMessage.id, {
      isActive: true,
      ...(tourIncomplete
        ? {}
        : { completedSendKeys: [], sentCount: 0 }),
      runStartedAt: new Date(),
    })
    console.log('✅ Mesaj aktif yapıldı:', scheduledMessage.id)

    const fresh = useAppStore.getState().scheduledMessages.find((x) => x.id === scheduledMessage.id)
    if (!fresh) return

    const schedArgs = getSchedulerScheduleMessageArgs()
    await messageScheduler.scheduleMessage(
      fresh,
      schedArgs.getMessageTemplate,
      schedArgs.onProgress,
      schedArgs.getAccountInfo,
      schedArgs.addErrorLog,
      schedArgs.onExecutionError
    )
    
    console.log('✅ Mesaj zamanlandı:', scheduledMessage.id)
  }

  const handleStop = (id: string) => {
    messageScheduler.cancelMessage(id)
    updateScheduledMessage(id, { isActive: false, runStartedAt: undefined })
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
            saniye cinsinden ayarlayın. İsteğe bağlı bitiş zamanı ile aynı planı bitişe kadar tekrarlayan
            turlar halinde çalıştırabilirsiniz.
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
            const accountNames = selectedAccounts
              .map((a) => `${a.firstName || a.phoneNumber}${a.username ? ` (@${a.username})` : ''}`)
              .join(', ')

            return (
              <div
                key={scheduledMessage.id}
                className="surface-panel rounded-xl p-4 card-hover shadow-xl fade-in electric-border relative overflow-hidden w-full"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-xl -mr-12 -mt-12" />
                
                <div className="flex flex-col gap-3 relative z-10">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-white text-lg mb-2 tracking-tight line-clamp-1 flex items-center gap-2 min-w-0">
                      {template?.name || 'Şablon silinmiş veya bulunamadı'}
                      {accountNames && (
                        <span className="text-xs font-medium text-white/60 truncate">
                          · {accountNames}
                        </span>
                      )}
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
                          ) : (scheduledMessage.recipientMode ?? 'manual') === 'joined_groups' ? (
                            <>Katıldığı gruplar: {scheduledMessage.usernames?.length || 0} kullanıcı adı</>
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
                      <div className="flex items-center gap-2">
                        <span className="text-white/50 font-semibold min-w-[100px] text-xs">Dağıtım:</span>
                        <span className="text-white font-medium text-xs">
                          {(scheduledMessage.accountDistribution ?? 'each_to_all') === 'split_recipients'
                            ? 'Alıcılar bölündü'
                            : 'Her hesap tümü'}
                        </span>
                      </div>
                      {scheduledMessage.repeatUntil && (
                        <div className="flex items-center gap-2">
                          <span className="text-white/50 font-semibold min-w-[100px] text-xs">
                            Çoklu tur bitiş:
                          </span>
                          <span className="text-white font-medium text-xs">
                            {formatDateTime(scheduledMessage.repeatUntil)}
                          </span>
                        </div>
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
                  {scheduledMessage.isActive && (
                    <SchedulerRunProgress
                      sentCount={scheduledMessage.sentCount}
                      totalCount={scheduledMessage.totalCount}
                      runStartedAt={scheduledMessage.runStartedAt}
                      statusLine={timeRemaining.get(scheduledMessage.id)}
                    />
                  )}
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

            <div className="shrink-0 rounded-t-2xl border-b border-white/[0.08] bg-[rgba(10,10,12,0.98)] backdrop-blur-md px-6 pt-6 pb-3 relative z-20">
              <h3
                id="scheduler-modal-title"
                className="text-xl font-bold text-white tracking-tight"
              >
                {editingMessageId ? 'Zamanlamayı Düzenle' : 'Yeni Zamanlama'}
              </h3>
              <div
                className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-3 mt-3 text-[11px] sm:text-xs font-semibold"
                role="navigation"
                aria-label="Adımlar"
              >
                <span className={modalStep === 1 ? 'text-emerald-400' : 'text-white/40'}>
                  1 · Hesaplar
                </span>
                <span className="text-white/25" aria-hidden>
                  →
                </span>
                <span className={modalStep === 2 ? 'text-emerald-400' : 'text-white/40'}>
                  2 · Alıcılar
                </span>
                <span className="text-white/25" aria-hidden>
                  →
                </span>
                <span className={modalStep === 3 ? 'text-emerald-400' : 'text-white/40'}>
                  3 · Şablon ve zaman
                </span>
              </div>
            </div>

            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="space-y-4">
              {modalStep === 1 && (
              <>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-bold text-white tracking-tight">Hesaplar</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedAccountIds(new Set(connectedAccounts.map((a) => a.id)))
                      }
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/80 border border-white/10"
                    >
                      Tümünü seç
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedAccountIds(new Set())}
                      className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 border border-white/10"
                    >
                      Temizle
                    </button>
                  </div>
                </div>
                <p className="text-xs text-white/45 mb-2 leading-relaxed">
                  Çoklu seçim: listedeki sıra, &quot;alıcıları böl&quot; modunda hangi aralığın hangi hesaba
                  gideceğini belirler (üstten alta).
                </p>
                <div className="max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-black/20 px-2 py-2 space-y-1.5">
                  {connectedAccounts.length === 0 ? (
                    <p className="text-xs text-amber-400/90 px-1 py-1">Bağlı hesap yok.</p>
                  ) : (
                    connectedAccounts.map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccountIds.has(a.id)}
                          onChange={() => {
                            setSelectedAccountIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(a.id)) next.delete(a.id)
                              else next.add(a.id)
                              return next
                            })
                          }}
                          className="accent-white shrink-0"
                        />
                        <span className="text-sm text-white/90 truncate">
                          {a.firstName || a.phoneNumber}
                          {a.username ? ` (@${a.username})` : ''}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div>
                <span className="block text-sm font-bold text-white mb-2 tracking-tight">
                  Çoklu hesap kullanımı
                </span>
                <div className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="accountDistribution"
                      checked={accountDistribution === 'each_to_all'}
                      onChange={() => setAccountDistribution('each_to_all')}
                      className="accent-white mt-0.5 shrink-0"
                    />
                    <span className="text-white text-sm leading-snug">
                      Her hesap tüm alıcılara göndersin (toplam: hesap sayısı × alıcı sayısı)
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="accountDistribution"
                      checked={accountDistribution === 'split_recipients'}
                      onChange={() => setAccountDistribution('split_recipients')}
                      className="accent-white mt-0.5 shrink-0"
                    />
                    <span className="text-white text-sm leading-snug">
                      Alıcıları hesaplara böl (her alıcıya tek gönderim; toplam ≈ alıcı sayısı)
                    </span>
                  </label>
                </div>
              </div>
              </>
              )}

              {modalStep === 2 && (
              <>
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
                      Seçili gruptaki tüm üyelere (grup listesi ayrı hesaptan seçilir)
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
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-white/5 border border-white/5">
                    <input
                      type="radio"
                      name="recipientMode"
                      checked={recipientMode === 'joined_groups'}
                      onChange={() => setRecipientMode('joined_groups')}
                      className="accent-white"
                    />
                    <span className="text-white text-sm">
                      Katıldığım tüm gruplar (kullanıcı adları otomatik doldurulsun)
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
                ) : recipientMode === 'group_members' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-white/50">
                      Gönderim, plan çalıştığında gruptan güncel üye listesi ile yapılır. Botlar atlanır.
                    </p>
                    <p className="text-xs text-white/45 leading-relaxed">
                      Aşağıdaki grup listesi, üye çekilebilecek sohbetlerle sınırlıdır; yönetici olmadığınız
                      yayın kanalları burada listelenmez.
                    </p>
                    <p className="text-xs text-amber-100/85 leading-relaxed rounded-lg border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2.5">
                      {TELEGRAM_PARTICIPANTS_ADMIN_NOTICE_TR}
                    </p>
                    <div>
                      <label
                        htmlFor="scheduler-group-list-account"
                        className="block text-xs font-semibold text-white/70 mb-1.5"
                      >
                        Grup listesi ve üye çekme hesabı
                      </label>
                      <p className="text-xs text-white/40 mb-2 leading-relaxed">
                        Bu hesap, hangi Telegram oturumundan grupların listeleneceğini ve üyelerin
                        okunacağını belirler. Yukarıdaki &quot;Hesaplar&quot; kutusu ise mesajı hangi
                        hesapların göndereceğini seçer; ikisi farklı olabilir.
                      </p>
                      <select
                        id="scheduler-group-list-account"
                        value={groupListPickerValue}
                        onChange={(e) => {
                          const v = e.target.value
                          setGroupListAccountId(v)
                          setSelectedGroup(null)
                        }}
                        className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                      >
                        <option value="">— Grup listesi için hesap seçin —</option>
                        {connectedAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.firstName || a.phoneNumber}
                            {a.username ? ` (@${a.username})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    {loadingGroups && (
                      <div className="flex items-center gap-2 text-white/60 text-sm py-1">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Gruplar yükleniyor…
                      </div>
                    )}
                    {groupsError && (
                      <p className="text-xs text-red-400">{groupsError}</p>
                    )}
                    {!loadingGroups &&
                      recipientMode === 'group_members' &&
                      groupListPickerValue &&
                      !groupsError &&
                      groupsForPicker.length === 0 && (
                        <p className="text-xs text-amber-400/90">
                          Bu hesap için listelenecek uygun grup/kanal yok (üye listesi çekilebilecek klasik
                          grup/süper grup veya yönetici olduğunuz yayın kanalı). Abone olduğunuz
                          yönetici olmadığınız kanallar gösterilmez.
                        </p>
                      )}
                    {!loadingGroups && recipientMode === 'group_members' && groupListPickerValue && (
                      <div>
                        <label
                          htmlFor="scheduler-pick-group"
                          className="block text-xs font-semibold text-white/70 mb-1.5"
                        >
                          Grup
                        </label>
                        <select
                          id="scheduler-pick-group"
                          value={selectedGroup?.id ?? ''}
                          onChange={(e) => {
                            const g = groupsForPicker.find((x) => x.id === e.target.value)
                            setSelectedGroup(g ?? null)
                          }}
                          className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
                        >
                          <option value="">
                            {groupsForPicker.length === 0 ? 'Önce yukarıdan grup listesi hesabını seçin' : 'Grup seçin…'}
                          </option>
                          {groupsForPicker.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.title}
                              {g.username ? ` (@${g.username.replace(/^@/, '')})` : ''}
                              {g.membersCount != null
                                ? ` — ${g.membersCount.toLocaleString('tr-TR')} üye`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-white/50">
                      Seçilen hesapta katıldığın kullanıcı adı olan grup/kanal adları otomatik çekilir ve
                      alıcı listesine eklenir.
                    </p>
                    <div>
                      <label
                        htmlFor="scheduler-joined-groups-account"
                        className="block text-xs font-semibold text-white/70 mb-1.5"
                      >
                        Grup listesini çekilecek hesap
                      </label>
                      <select
                        id="scheduler-joined-groups-account"
                        value={groupListPickerValue}
                        onChange={(e) => setGroupListAccountId(e.target.value)}
                        className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm"
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
                    {joinedGroupsLoading && (
                      <div className="flex items-center gap-2 text-white/60 text-sm py-1">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Katılınan gruplar yükleniyor…
                      </div>
                    )}
                    {joinedGroupsError && <p className="text-xs text-amber-300">{joinedGroupsError}</p>}
                    <div>
                      <label className="block text-xs font-semibold text-white/70 mb-1">
                        Otomatik doldurulan alıcı listesi
                      </label>
                      <textarea
                        value={usernames}
                        readOnly
                        rows={7}
                        className="input-focus w-full px-3 py-2.5 rounded-xl text-white/90 placeholder-white/25 focus:outline-none resize-y text-sm font-mono"
                        placeholder="Hesap seçildiğinde kullanıcı adları burada listelenir"
                      />
                    </div>
                  </div>
                )}
              </div>
              </>
              )}

              {modalStep === 3 && (
              <>
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

              <div>
                <label
                  htmlFor="scheduler-repeat-until"
                  className="block text-sm font-bold text-white mb-2 tracking-tight"
                >
                  Çoklu tur — bitiş (isteğe bağlı)
                </label>
                <p className="text-xs text-white/45 mb-2 leading-relaxed">
                  Doluysa: her tur tamamlanınca birkaç saniye bekleyip yeniden başlar; bu zamana kadar
                  çalışır. Boş bırakırsanız tek tur gönderilir.
                </p>
                <input
                  id="scheduler-repeat-until"
                  type="datetime-local"
                  value={repeatUntilAt}
                  onChange={(e) => setRepeatUntilAt(e.target.value)}
                  className="input-focus w-full px-3 py-2.5 rounded-xl text-white focus:outline-none text-sm [color-scheme:dark]"
                />
              </div>

              {selectedTemplateAntiSpam && (
                <p className="text-xs text-emerald-400/90 leading-relaxed -mt-1 mb-1">
                  Anti-spam açık: aşağıdaki saniyeler <span className="text-emerald-300/95 font-semibold">sabit bekleme değildir</span>
                  — rastgele aralığın <span className="text-emerald-300/95 font-semibold">taban (referans)</span> değeridir. Metin de her
                  gönderimde hafifçe çeşitlenir.
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-white mb-2 tracking-tight">
                    {selectedTemplateAntiSpam
                      ? 'Mesajlar arası taban süre (sn)'
                      : 'Mesajlar Arası Gecikme (saniye)'}
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
                    {selectedTemplateAntiSpam
                      ? 'Gerçek bekleme bu sürenin etrafında her seferinde rastgele seçilir.'
                      : 'Önerilen: 3-5 saniye'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-white mb-2 tracking-tight">
                    {selectedTemplateAntiSpam
                      ? 'Hesaplar arası taban süre (sn)'
                      : 'Hesaplar Arası Gecikme (saniye)'}
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
                    {selectedTemplateAntiSpam
                      ? 'Çoklu hesapta geçişlerde de aynı şekilde rastgele aralık kullanılır.'
                      : 'Önerilen: 5-10 saniye'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/25 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.08] bg-white/[0.04]">
                  <Eye size={16} className="text-emerald-400/90 shrink-0" aria-hidden />
                  <span className="text-xs font-bold text-white/90 tracking-tight">Önizleme</span>
                </div>
                <div className="px-3 py-3 space-y-3 text-xs text-white/80">
                  <div>
                    <span className="font-semibold text-white/55 block mb-1">Hesaplar</span>
                    {schedulerPreview.accountLabels.length > 0 ? (
                      <ul className="list-disc pl-4 space-y-0.5 text-white/85">
                        {schedulerPreview.accountLabels.map((label, i) => (
                          <li key={i} className="break-words">
                            {label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-amber-400/90">Henüz hesap seçilmedi</p>
                    )}
                    <p className="text-white/50 mt-1.5">{schedulerPreview.distLabel}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-white/55 block mb-1">Alıcılar</span>
                    <p>{schedulerPreview.recipientTitle}</p>
                    {schedulerPreview.recipientExtra ? (
                      <p className="text-white/60 mt-1 break-words">{schedulerPreview.recipientExtra}</p>
                    ) : null}
                  </div>
                  <div>
                    <span className="font-semibold text-white/55 block mb-1">Şablon</span>
                    {schedulerPreview.templateName ? (
                      <>
                        <p className="font-medium text-white/90">{schedulerPreview.templateName}</p>
                        {schedulerPreview.contentSnippet ? (
                          <pre className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-white/75 whitespace-pre-wrap break-words font-sans">
                            {schedulerPreview.contentSnippet}
                          </pre>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-amber-400/90">Şablon seçilmedi</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-white/[0.06]">
                    <div>
                      <span className="font-semibold text-white/55 block mb-0.5">Gönderim zamanı</span>
                      <p className="text-white/90">{schedulerPreview.scheduledLabel}</p>
                    </div>
                    <div>
                      <span className="font-semibold text-white/55 block mb-0.5">Gecikmeler (sn)</span>
                      <p className="text-white/90">
                        Mesajlar: {schedulerPreview.delayMsgSec} · Hesaplar: {schedulerPreview.delayAccSec}
                      </p>
                      {schedulerPreview.antiSpam ? (
                        <p className="text-emerald-400/85 text-[10px] mt-1 leading-snug">
                          Anti-spam: süreler taban; gerçek bekleme rastgele.
                        </p>
                      ) : null}
                    </div>
                    {schedulerPreview.repeatUntilLabel ? (
                      <div className="sm:col-span-2">
                        <span className="font-semibold text-white/55 block mb-0.5">Çoklu tur bitişi</span>
                        <p className="text-white/90">{schedulerPreview.repeatUntilLabel}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              </>
              )}
            </div>
            </div>

            <div className="shrink-0 relative z-20 flex flex-wrap gap-2 sm:gap-3 px-6 py-4 border-t border-white/[0.08] bg-[rgba(10,10,12,0.98)] backdrop-blur-md rounded-b-2xl">
              {modalStep > 1 && (
                <button
                  type="button"
                  onClick={goSchedulerBack}
                  className="px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-1.5 shrink-0"
                >
                  <ChevronLeft size={18} aria-hidden />
                  Geri
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false)
                  resetForm()
                }}
                className="flex-1 min-w-[6rem] px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all"
              >
                İptal
              </button>
              {modalStep === 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (validateSchedulerStep1()) setModalStep(2)
                  }}
                  className="btn-primary flex-1 min-w-[8rem] px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-1.5"
                >
                  İleri
                  <ChevronRight size={18} aria-hidden />
                </button>
              ) : modalStep === 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (validateSchedulerStep2()) setModalStep(3)
                  }}
                  className="btn-primary flex-1 min-w-[8rem] px-4 py-3 rounded-xl font-bold flex items-center justify-center gap-1.5"
                >
                  İleri
                  <ChevronRight size={18} aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAdd}
                  className="btn-primary flex-1 min-w-[8rem] px-4 py-3 rounded-xl font-bold"
                >
                  {editingMessageId ? 'Güncellemeyi onayla' : 'Onayla'}
                </button>
              )}
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}

