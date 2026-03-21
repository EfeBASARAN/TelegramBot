'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  RefreshCw,
  Hash,
  ChevronDown,
  ChevronUp,
  Users,
  Globe,
  Lock,
  Loader2,
  AlertCircle,
  Pin,
  Clock,
  MessageSquare,
  X,
  Search,
  FileSpreadsheet,
} from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { telegramManager, type JoinedGroupInfo, type GroupMemberInfo } from '@/lib/telegram'
import { exportRowsToExcel, sanitizeExcelFilename } from '@/lib/excelExport'

function formatListActivity(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return ''
  }
}

export default function GroupsPage() {
  const accounts = useAppStore((state) => state.accounts)
  const apiConfig = useAppStore((state) => state.apiConfig)
  const pushToast = useAppStore((state) => state.pushToast)

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => Boolean(a.sessionString)),
    [accounts]
  )

  const [selectedAccountId, setSelectedAccountId] = useState<string>('')
  const [groups, setGroups] = useState<JoinedGroupInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [hasFetched, setHasFetched] = useState(false)
  const [membersByGroupId, setMembersByGroupId] = useState<Record<string, GroupMemberInfo[]>>({})
  const [loadingMembersId, setLoadingMembersId] = useState<string | null>(null)
  const [membersError, setMembersError] = useState<{ id: string; message: string } | null>(null)
  const [membersPanelGroup, setMembersPanelGroup] = useState<JoinedGroupInfo | null>(null)
  const [memberSearchQuery, setMemberSearchQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  )

  const loadGroups = useCallback(async () => {
    if (!selectedAccount) {
      setError('Önce bir hesap seçin')
      return
    }
    if (!selectedAccount.sessionString) {
      setError('Bu hesapta oturum bilgisi yok')
      return
    }

    setLoading(true)
    setError('')
    setHasFetched(false)
    try {
      const apiId = selectedAccount.apiId || apiConfig?.apiId
      const apiHash = selectedAccount.apiHash || apiConfig?.apiHash
      const res = await telegramManager.getJoinedGroups(
        selectedAccount.id,
        selectedAccount.sessionString,
        selectedAccount.phoneNumber,
        apiId,
        apiHash
      )
      if (res.success && res.groups) {
        setGroups(res.groups)
        setSearchQuery('')
        setHasFetched(true)
        setMembersByGroupId({})
        setMembersPanelGroup(null)
      } else {
        setGroups([])
        setError(res.error || 'Liste alınamadı')
      }
    } catch (e: unknown) {
      setGroups([])
      setError(e instanceof Error ? e.message : 'Beklenmeyen hata')
    } finally {
      setLoading(false)
    }
  }, [selectedAccount, apiConfig])

  const loadMembers = useCallback(
    async (g: JoinedGroupInfo) => {
      if (!selectedAccount?.sessionString) return
      setLoadingMembersId(g.id)
      setMembersError(null)
      try {
        const apiId = selectedAccount.apiId || apiConfig?.apiId
        const apiHash = selectedAccount.apiHash || apiConfig?.apiHash
        const res = await telegramManager.getGroupParticipants(
          selectedAccount.id,
          selectedAccount.sessionString,
          selectedAccount.phoneNumber,
          apiId,
          apiHash,
          g
        )
        if (res.success && res.members) {
          setMembersByGroupId((prev) => ({ ...prev, [g.id]: res.members! }))
          setMembersError(null)
        } else {
          const errMsg = res.error || 'Üyeler yüklenemedi'
          setMembersError({ id: g.id, message: errMsg })
          pushToast(errMsg, 'error')
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Hata'
        setMembersError({ id: g.id, message: msg })
        pushToast(msg, 'error')
      } finally {
        setLoadingMembersId(null)
      }
    },
    [selectedAccount, apiConfig, pushToast]
  )

  const openMembersPanel = useCallback(
    (g: JoinedGroupInfo) => {
      setMembersPanelGroup(g)
      setMembersError(null)
      if (!membersByGroupId[g.id]) {
        void loadMembers(g)
      }
    },
    [membersByGroupId, loadMembers]
  )

  const closeMembersPanel = useCallback(() => {
    setMembersPanelGroup(null)
    setMembersError(null)
    setMemberSearchQuery('')
  }, [])

  const refreshPanelMembers = useCallback(() => {
    if (membersPanelGroup) void loadMembers(membersPanelGroup)
  }, [membersPanelGroup, loadMembers])

  useEffect(() => {
    if (!membersPanelGroup) return
    const stillExists = groups.some((x) => x.id === membersPanelGroup.id)
    if (!stillExists) setMembersPanelGroup(null)
  }, [groups, membersPanelGroup])

  const panelMembers = membersPanelGroup ? membersByGroupId[membersPanelGroup.id] : undefined
  const panelLoading = membersPanelGroup && loadingMembersId === membersPanelGroup.id

  const filteredPanelMembers = useMemo((): GroupMemberInfo[] => {
    if (!panelMembers?.length) return []
    const raw = memberSearchQuery.trim()
    if (!raw) return panelMembers
    const q = raw.toLowerCase()
    return panelMembers.filter((m) => {
      const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ').toLowerCase()
      const user = (m.username || '').toLowerCase()
      const idStr = String(m.id)
      return (
        fullName.includes(q) ||
        user.includes(q) ||
        idStr.includes(raw) ||
        `@${user}`.includes(q)
      )
    })
  }, [panelMembers, memberSearchQuery])

  useEffect(() => {
    setMemberSearchQuery('')
  }, [membersPanelGroup?.id])
  const panelErr =
    membersPanelGroup && membersError?.id === membersPanelGroup.id ? membersError.message : null

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => {
      const title = (g.title || '').toLowerCase()
      const un = (g.username || '').toLowerCase().replace(/^@/, '')
      const typeL = (g.typeLabel || '').toLowerCase()
      const idStr = String(g.id || '')
      return (
        title.includes(q) ||
        un.includes(q) ||
        typeL.includes(q) ||
        idStr.includes(q)
      )
    })
  }, [groups, searchQuery])

  useEffect(() => {
    if (expandedId && !filteredGroups.some((g) => g.id === expandedId)) {
      setExpandedId(null)
    }
  }, [filteredGroups, expandedId])

  const handleExportGroupsExcel = useCallback(() => {
    if (!filteredGroups.length) {
      pushToast('Dışa aktarılacak grup yok', 'info')
      return
    }
    const accLabel =
      selectedAccount?.phoneNumber || selectedAccount?.firstName || selectedAccountId || 'hesap'
    const rows = filteredGroups.map((g) => ({
      Başlık: g.title,
      'Kullanıcı adı': g.username ? `@${g.username.replace(/^@/, '')}` : '',
      Tür: g.typeLabel,
      'Üye sayısı': g.membersCount ?? '',
      'Herkese açık': g.isPublic ? 'Evet' : 'Hayır',
      'Peer anahtarı': g.peerKey ?? '',
      'Access hash': g.accessHash ?? '',
      'Son aktivite': g.lastActivityAt ? formatListActivity(g.lastActivityAt) : '',
      'Son mesaj özeti': g.lastMessagePreview ?? '',
    }))
    const name = `gruplar_${sanitizeExcelFilename(accLabel)}_${new Date().toISOString().slice(0, 10)}`
    if (exportRowsToExcel(rows, name, 'Gruplar')) {
      pushToast('Grup listesi Excel olarak indirildi', 'success')
    }
  }, [filteredGroups, pushToast, selectedAccount, selectedAccountId])

  const handleExportMembersExcel = useCallback(() => {
    if (!membersPanelGroup) return
    if (!panelMembers?.length) {
      pushToast('Önce üye listesinin yüklenmesini bekleyin', 'info')
      return
    }
    const list = memberSearchQuery.trim() ? filteredPanelMembers : panelMembers
    if (!list.length) {
      pushToast('Dışa aktarılacak üye yok', 'info')
      return
    }
    const rows = list.map((m) => ({
      Grup: membersPanelGroup.title,
      'Grup türü': membersPanelGroup.typeLabel,
      Ad: m.firstName ?? '',
      Soyad: m.lastName ?? '',
      'Kullanıcı adı': m.username ? `@${m.username}` : '',
      'Kullanıcı ID': m.id,
      'Access hash': m.accessHash ?? '',
      Bot: m.isBot ? 'Evet' : 'Hayır',
    }))
    const suffix = memberSearchQuery.trim() ? '_filtre' : ''
    const name = `uyeler_${sanitizeExcelFilename(membersPanelGroup.title)}${suffix}_${new Date().toISOString().slice(0, 10)}`
    if (exportRowsToExcel(rows, name, 'Üyeler')) {
      pushToast('Üye listesi Excel olarak indirildi', 'success')
    }
  }, [
    membersPanelGroup,
    panelMembers,
    memberSearchQuery,
    filteredPanelMembers,
    pushToast,
  ])

  return (
    <div className="fade-in relative z-10 min-h-full w-full max-w-[1600px]">
      {/* Mobil: panel açıkken arka plan */}
      {membersPanelGroup && (
        <button
          type="button"
          className="fixed inset-0 z-40 surface-modal-overlay backdrop-blur-[2px] xl:hidden"
          onClick={closeMembersPanel}
          aria-label="Paneli kapat"
        />
      )}

      <div
        className={`flex flex-col xl:flex-row xl:items-start gap-6 xl:gap-8 ${membersPanelGroup ? 'xl:gap-6' : ''}`}
      >
        <div className="flex-1 min-w-0 xl:min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6 mb-8">
            <div>
              <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Gruplar</h2>
              <p className="text-white/50 text-base font-medium max-w-2xl leading-relaxed">
                Seçili hesabın Telegram sohbet listesindeki grup, süper grup ve kanallar gösterilir (özel kişi
                sohbetleri dahil değildir). Veriler anlık olarak Telegram API ile çekilir.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 mb-8">
            <div className="flex items-center gap-2 min-w-0 flex-1 sm:max-w-md">
              <label htmlFor="group-account" className="text-sm text-white/50 font-medium shrink-0">
                Hesap
              </label>
              <select
                id="group-account"
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value)
                  setGroups([])
                  setSearchQuery('')
                  setError('')
                  setExpandedId(null)
                  setHasFetched(false)
                  setMembersByGroupId({})
                  setMembersError(null)
                  setMembersPanelGroup(null)
                }}
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
            <button
              type="button"
              onClick={loadGroups}
              disabled={loading || !selectedAccountId}
              className="btn-primary flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
              {loading ? 'Yükleniyor…' : 'Listeyi yenile'}
            </button>
            <button
              type="button"
              onClick={handleExportGroupsExcel}
              disabled={loading || filteredGroups.length === 0}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold border border-white/15 bg-white/[0.06] hover:bg-white/10 text-white/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 transition-colors"
              title="Görünen grup satırlarını Excel’e aktarır"
            >
              <FileSpreadsheet size={18} />
              Excel’e aktar
            </button>
          </div>

          {groups.length > 0 && (
            <div className="relative mb-6 max-w-xl">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                size={18}
                aria-hidden
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Grup adı, @kullanıcı, tür veya ID ile ara…"
                autoComplete="off"
                className="input-focus w-full pl-10 pr-10 py-2.5 rounded-xl text-white text-sm placeholder:text-white/35"
                aria-label="Gruplarda ara"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Aramayı temizle"
                >
                  <X size={16} />
                </button>
              ) : null}
            </div>
          )}

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {connectedAccounts.length === 0 && (
            <div className="p-6 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-200/90 text-sm">
              Kayıtlı hesap yok veya oturum bilgisi eksik. Önce{' '}
              <span className="text-white font-semibold">Hesaplar</span> sayfasından hesap ekleyip bağlayın.
            </div>
          )}

          {selectedAccountId && !loading && groups.length === 0 && !error && !hasFetched && (
            <div className="text-center py-16 surface-muted rounded-2xl">
              <Hash size={48} className="mx-auto text-white/25 mb-4" />
              <p className="text-white/45 text-sm">Listeyi yenile ile grupları yükleyin.</p>
            </div>
          )}

          {selectedAccountId && !loading && groups.length === 0 && !error && hasFetched && (
            <div className="text-center py-16 surface-muted rounded-2xl">
              <Users size={48} className="mx-auto text-white/25 mb-4" />
              <p className="text-white/55 text-sm max-w-md mx-auto">
                Bu hesabın sohbet listesinde grup, süper grup veya kanal bulunamadı (veya ilk 200 sohbet içinde
                yok).
              </p>
            </div>
          )}

          {groups.length > 0 && filteredGroups.length === 0 && (
            <div className="mb-6 p-4 rounded-xl surface-muted border border-white/10 text-white/55 text-sm text-center">
              Aramanızla eşleşen grup yok. Farklı bir metin deneyin veya aramayı temizleyin.
            </div>
          )}

          {groups.length > 0 && filteredGroups.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-white/40 font-medium mb-2">
                {searchQuery.trim() ? (
                  <>
                    {filteredGroups.length} / {groups.length} kayıt gösteriliyor
                  </>
                ) : (
                  <>Toplam {groups.length} kayıt (en fazla 200 sohbet)</>
                )}
              </p>
              {filteredGroups.map((g) => {
                const open = expandedId === g.id
                const panelActive = membersPanelGroup?.id === g.id
                return (
                  <div
                    key={g.id}
                    className={`surface-panel rounded-xl overflow-hidden shadow-lg transition-colors ${
                      panelActive ? 'border-white/20 ring-1 ring-white/10' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(open ? null : g.id)}
                      className="w-full flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-4 p-4 text-left hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center border border-white/10 shrink-0">
                          <Hash size={18} className="text-slate-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white truncate">{g.title}</span>
                            {g.pinned && (
                              <span title="Sabitlenmiş">
                                <Pin size={14} className="text-amber-400/90 shrink-0" />
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-white/45">
                            <span className="text-slate-400 font-semibold">{g.typeLabel}</span>
                            {g.username && (
                              <span className="font-mono text-white/55">@{g.username}</span>
                            )}
                            {g.membersCount != null && (
                              <span className="inline-flex items-center gap-1">
                                <Users size={12} />
                                {g.membersCount.toLocaleString('tr-TR')} üye
                              </span>
                            )}
                            {g.isPublic ? (
                              <span className="inline-flex items-center gap-1 text-green-400/80">
                                <Globe size={12} /> Herkese açık
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-white/35">
                                <Lock size={12} /> Özel bağlantı
                              </span>
                            )}
                            {g.unreadCount != null && g.unreadCount > 0 && (
                              <span className="sm:hidden inline-flex items-center gap-1 rounded-full bg-white/[0.08] text-slate-200 px-2 py-0.5 font-semibold border border-white/10">
                                {g.unreadCount} okunmamış
                              </span>
                            )}
                          </div>
                          <div className="sm:hidden mt-2 space-y-1">
                            {g.lastMessagePreview ? (
                              <p className="text-xs text-white/45 line-clamp-2 leading-relaxed">{g.lastMessagePreview}</p>
                            ) : (
                              <p className="text-xs text-white/25 italic">Son mesaj önizlemesi yok</p>
                            )}
                            {g.lastActivityAt && (
                              <p className="text-[11px] text-white/30 flex items-center gap-1">
                                <Clock size={10} />
                                {formatListActivity(g.lastActivityAt)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="hidden sm:flex flex-1 min-w-0 flex-col justify-center pl-0 sm:pl-6 sm:border-l border-white/10 py-0.5">
                        {g.lastMessagePreview ? (
                          <p className="text-xs text-white/55 line-clamp-2 leading-relaxed">
                            <MessageSquare
                              size={12}
                              className="inline shrink-0 mr-1.5 -mt-0.5 text-white/35 align-middle"
                            />
                            {g.lastMessagePreview}
                          </p>
                        ) : (
                          <p className="text-xs text-white/30 italic">Son mesaj önizlemesi yok</p>
                        )}
                        {g.lastActivityAt && (
                          <p className="text-[11px] text-white/35 mt-1.5 flex items-center gap-1">
                            <Clock size={11} className="shrink-0 opacity-70" />
                            Son aktivite: {formatListActivity(g.lastActivityAt)}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-center sm:justify-end gap-3 shrink-0 sm:flex-col sm:items-end sm:min-w-[5.5rem]">
                        {g.unreadCount != null && g.unreadCount > 0 && (
                          <span
                            className="hidden sm:inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-white/[0.08] text-slate-200 text-xs font-bold border border-white/12"
                            title="Okunmamış"
                          >
                            {g.unreadCount > 99 ? '99+' : g.unreadCount}
                          </span>
                        )}
                        {open ? (
                          <ChevronUp size={20} className="text-white/40 shrink-0" />
                        ) : (
                          <ChevronDown size={20} className="text-white/40 shrink-0" />
                        )}
                      </div>
                    </button>
                    {open && (
                      <div className="px-4 pb-4 pt-0 border-t border-white/10">
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm mt-3">
                          <div>
                            <dt className="text-white/40 text-xs font-medium mb-0.5">Dahili ID</dt>
                            <dd className="font-mono text-white/90 break-all">{g.id}</dd>
                          </div>
                          {g.peerKey && (
                            <div>
                              <dt className="text-white/40 text-xs font-medium mb-0.5">Peer / sohbet anahtarı</dt>
                              <dd className="font-mono text-white/90 break-all">{g.peerKey}</dd>
                            </div>
                          )}
                          <div>
                            <dt className="text-white/40 text-xs font-medium mb-0.5">Tür</dt>
                            <dd className="text-white/85">{g.typeLabel}</dd>
                          </div>
                          {g.username && (
                            <div>
                              <dt className="text-white/40 text-xs font-medium mb-0.5">Kullanıcı adı</dt>
                              <dd className="font-mono text-slate-300">@{g.username}</dd>
                            </div>
                          )}
                        </dl>

                        <div className="mt-5 pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              openMembersPanel(g)
                            }}
                            className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold"
                          >
                            <Users size={17} />
                            Kullanıcıları gör
                          </button>
                          <p className="text-[11px] text-white/35 sm:max-w-md">
                            Liste sağdaki panelde açılır (mobilde sağdan kayar).
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Sağ panel: üyeler */}
        {membersPanelGroup && (
          <aside
            className="fixed xl:static inset-y-0 right-0 z-50 xl:z-auto h-full max-h-screen xl:max-h-[calc(100vh-7rem)] w-full max-w-md xl:max-w-none xl:w-[min(420px,38%)] xl:min-w-[320px] xl:max-w-[440px] xl:h-fit shrink-0 flex flex-col rounded-none xl:rounded-2xl border-l border-white/[0.08] bg-zinc-950/96 xl:bg-zinc-950/88 backdrop-blur-xl shadow-2xl overflow-hidden xl:sticky xl:top-24"
            role="dialog"
            aria-labelledby="members-panel-title"
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-white/10 bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <h3 id="members-panel-title" className="font-bold text-white text-base leading-snug truncate">
                  {membersPanelGroup.title}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{membersPanelGroup.typeLabel}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleExportMembersExcel}
                  disabled={!!panelLoading || !panelMembers?.length}
                  className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors disabled:opacity-50"
                  title="Üyeleri Excel’e aktar (arama varsa yalnızca filtrelenenler)"
                >
                  <FileSpreadsheet size={18} />
                </button>
                <button
                  type="button"
                  onClick={refreshPanelMembers}
                  disabled={!!panelLoading}
                  className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors disabled:opacity-50"
                  title="Listeyi yenile"
                >
                  <RefreshCw size={18} className={panelLoading ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  onClick={closeMembersPanel}
                  className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                  title="Kapat"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="px-3 pt-0 pb-2 border-b border-white/10 bg-zinc-950/70">
              <label htmlFor="member-search" className="sr-only">
                Üye ara
              </label>
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 pointer-events-none"
                  aria-hidden
                />
                <input
                  id="member-search"
                  type="search"
                  value={memberSearchQuery}
                  onChange={(e) => setMemberSearchQuery(e.target.value)}
                  placeholder="İsim, @kullanıcı veya ID ile ara…"
                  disabled={!!panelLoading || !!panelErr}
                  autoComplete="off"
                  className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 focus:border-cyan-500/25 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 p-3">
              {panelLoading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/50">
                  <Loader2 size={28} className="animate-spin text-slate-400" />
                  <span className="text-sm">Üyeler yükleniyor…</span>
                </div>
              )}

              {!panelLoading && panelErr && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                  {panelErr}
                </div>
              )}

              {!panelLoading &&
                !panelErr &&
                panelMembers &&
                panelMembers.length > 0 &&
                filteredPanelMembers.length > 0 && (
                <div className="rounded-lg border border-white/10 overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[520px]">
                    <thead className="sticky top-0 bg-zinc-900/95 text-slate-500 font-semibold border-b border-white/10 backdrop-blur-sm">
                      <tr>
                        <th className="p-2.5 pl-3">Ad</th>
                        <th className="p-2.5">@kullanıcı</th>
                        <th className="p-2.5 font-mono whitespace-nowrap">Kullanıcı ID</th>
                        <th className="p-2.5 pr-3 font-mono">Access hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPanelMembers.map((m) => (
                        <tr key={m.id} className="border-b border-white/5 text-white/85 hover:bg-white/[0.04]">
                          <td className="p-2.5 pl-3">
                            {[m.firstName, m.lastName].filter(Boolean).join(' ') || '—'}
                            {m.isBot && (
                              <span className="ml-1 text-[10px] text-violet-400 font-medium">bot</span>
                            )}
                          </td>
                          <td className="p-2.5 font-mono text-slate-300">
                            {m.username ? `@${m.username}` : '—'}
                          </td>
                          <td className="p-2.5 font-mono text-white/55 whitespace-nowrap">{m.id}</td>
                          <td className="p-2.5 pr-3 font-mono text-slate-400/90 break-all max-w-[200px] xl:max-w-none">
                            {m.accessHash ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!panelLoading &&
                !panelErr &&
                panelMembers &&
                panelMembers.length > 0 &&
                filteredPanelMembers.length === 0 &&
                memberSearchQuery.trim() !== '' && (
                  <p className="text-sm text-amber-200/90 text-center py-10 px-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    Aramanızla eşleşen üye yok. Farklı bir kelime veya ID deneyin.
                  </p>
                )}

              {!panelLoading && !panelErr && panelMembers && panelMembers.length === 0 && (
                <p className="text-sm text-white/45 text-center py-12 px-2">
                  Bu sohbet için üye döndürülmedi (yetki veya kanal türü).
                </p>
              )}
            </div>

            <div className="p-3 border-t border-white/[0.06] text-[11px] text-white/40 bg-black/30 flex flex-wrap items-center justify-between gap-2">
              <span>
                {panelMembers && panelMembers.length > 0
                  ? memberSearchQuery.trim()
                    ? `${filteredPanelMembers.length} / ${panelMembers.length} üye`
                    : `${panelMembers.length} üye`
                  : 'En fazla 200 üye'}{' '}
                · Telegram API kuralları geçerlidir
              </span>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
