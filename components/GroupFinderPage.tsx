'use client'

import { useMemo, useState, useCallback } from 'react'
import { Search, Loader2, Globe, Users, Copy, ExternalLink, Info } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { telegramManager, type PublicGroupSearchItem } from '@/lib/telegram'

function buildSearchVariants(rawQuery: string): string[] {
  const q = rawQuery.trim().toLocaleLowerCase('tr-TR')
  if (q.length < 2) return []

  const variants = new Set<string>()
  variants.add(q)

  const normalized = q
    .replace(/\s+/g, ' ')
    .replace(/\bikinci\s*el\b/g, '2 el')
    .replace(/\b2\.?\s*el\b/g, 'ikinci el')
    .trim()
  if (normalized.length >= 2) variants.add(normalized)

  if (q.includes('ikinci el') || q.includes('2 el') || q.includes('2.el')) {
    variants.add(q.replace(/ikinci el|2\.?\s*el/g, 'satılık').trim())
    variants.add(q.replace(/ikinci el|2\.?\s*el/g, 'alım satım').trim())
    variants.add(q.replace(/ikinci el|2\.?\s*el/g, 'spot').trim())
  } else {
    variants.add(`${q} ikinci el`)
    variants.add(`${q} satılık`)
    variants.add(`${q} alım satım`)
  }

  const shortTokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
  for (const t of shortTokens) {
    variants.add(t)
  }

  return Array.from(variants)
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length >= 2)
    .slice(0, 8)
}

export default function GroupFinderPage() {
  const accounts = useAppStore((state) => state.accounts)
  const apiConfig = useAppStore((state) => state.apiConfig)
  const pushToast = useAppStore((state) => state.pushToast)

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => Boolean(a.sessionString)),
    [accounts]
  )

  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [query, setQuery] = useState('')
  const [groupsOnly, setGroupsOnly] = useState(true)
  const [wideSearch, setWideSearch] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<PublicGroupSearchItem[]>([])
  const [searchDone, setSearchDone] = useState(false)

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  )

  const runSearch = useCallback(async () => {
    if (!selectedAccount?.sessionString) {
      setError('Önce oturumu açılmış bir hesap seçin')
      return
    }
    const q = query.trim()
    if (q.length < 2) {
      setError('En az 2 karakter yazın')
      return
    }

    setLoading(true)
    setError('')
    setSearchDone(false)
    try {
      const apiId = selectedAccount.apiId || apiConfig?.apiId
      const apiHash = selectedAccount.apiHash || apiConfig?.apiHash
      const queries = wideSearch ? buildSearchVariants(q) : [q]
      const unique = new Map<string, PublicGroupSearchItem>()

      for (const queryText of queries) {
        const res = await telegramManager.searchPublicGroups(
          selectedAccount.id,
          selectedAccount.sessionString,
          selectedAccount.phoneNumber,
          apiId,
          apiHash,
          queryText,
          { limit: 50, groupsOnly }
        )

        if (!res.success) {
          continue
        }

        for (const item of res.results || []) {
          unique.set(item.id, item)
        }

        // Hız limitine daha az takılmak için kısa bekleme.
        await new Promise((r) => setTimeout(r, 250))
      }

      const merged = Array.from(unique.values()).sort((a, b) =>
        a.title.localeCompare(b.title, 'tr', { sensitivity: 'base' })
      )
      setResults(merged)
      if (merged.length === 0) {
          pushToast('Bu kelimeyle eşleşen herkese açık sohbat bulunamadı.', 'info')
      }
    } catch (e: unknown) {
      setResults([])
      setError(e instanceof Error ? e.message : 'Beklenmeyen hata')
    } finally {
      setSearchDone(true)
      setLoading(false)
    }
  }, [selectedAccount, apiConfig, query, groupsOnly, pushToast])

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    pushToast('Panoya kopyalandı', 'success')
  }

  return (
    <div className="fade-in relative z-10 min-h-full">
      <div className="mb-8">
        <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">
          Grup bul
        </h2>
        <p className="text-white/50 text-base font-medium max-w-3xl leading-relaxed">
          Bağlı hesabınız üzerinden Telegram’ın{' '}
          <span className="text-white/70">herkese açık sohbatlerdeki</span> kelime aramasını çalıştırır.
          Sonuçlar, aradığınız ifadeyi içeren <span className="text-white/70">mesajların</span> bulunduğu
          gruplar/kanallardan oluşur; ayrı bir tam “grup listesi” API’si yoktur.
        </p>
      </div>

      <div className="surface-panel rounded-2xl p-6 mb-8 border border-white/10 shadow-xl">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[200px] flex-1">
            <label className="block text-xs font-bold text-white/70 mb-2 tracking-tight">
              Hesap
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="input-focus w-full px-4 py-3 rounded-xl text-white bg-white/[0.06] border border-white/10"
            >
              <option value="">Seçin…</option>
              {connectedAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.phoneNumber}
                  {a.username ? ` · @${a.username}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label className="block text-xs font-bold text-white/70 mb-2 tracking-tight">
              Arama
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !loading && void runSearch()}
              placeholder="Örn: kripto, ankara, satış"
              className="input-focus w-full px-4 py-3 rounded-xl text-white placeholder-white/30"
            />
          </div>
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="btn-primary flex items-center gap-2 px-6 py-3 rounded-xl font-bold disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
            Ara
          </button>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <span className="text-xs font-bold text-white/45 uppercase tracking-wide">Kapsam</span>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/85">
            <input
              type="radio"
              className="accent-cyan-500"
              checked={groupsOnly}
              onChange={() => setGroupsOnly(true)}
            />
            Yalnızca süper gruplar (önerilen)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/85">
            <input
              type="radio"
              className="accent-cyan-500"
              checked={!groupsOnly}
              onChange={() => setGroupsOnly(false)}
            />
            Süper gruplar + yayın kanalları
          </label>
        </div>
        <div className="mt-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white/85">
            <input
              type="checkbox"
              className="accent-cyan-500"
              checked={wideSearch}
              onChange={(e) => setWideSearch(e.target.checked)}
            />
            Geniş arama (otomatik varyasyonlar ile daha fazla sonuç)
          </label>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-amber-100/90 text-sm">
          <Info size={18} className="shrink-0 mt-0.5 opacity-80" />
          <p>
            Eşzamanlı çok kısa ardışık aramaları sınırlamak, hesabın geçici hız sınırına takılmasını
            yardımcı olur. Sonuç sayısı ve sırası her zaman aynı olmayabilir.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
          {error}
        </div>
      )}

      {results.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {results.map((r) => (
            <div
              key={r.id}
              className="surface-panel rounded-2xl p-5 border border-white/10 card-hover relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-2xl -mr-8 -mt-8" />
              <div className="relative z-10">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h3 className="font-bold text-white text-lg leading-tight pr-2">{r.title}</h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-200/90 border border-cyan-500/20 shrink-0">
                    {r.typeLabel}
                  </span>
                </div>
                {r.username && (
                  <p className="text-cyan-300/90 text-sm font-medium mb-1">@{r.username.replace(/^@/, '')}</p>
                )}
                {r.membersCount != null && (
                  <p className="text-white/45 text-xs flex items-center gap-1.5 mb-3">
                    <Users size={14} />
                    ~{r.membersCount.toLocaleString('tr-TR')} üye
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {r.tmeUrl && (
                    <a
                      href={r.tmeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white border border-white/10"
                    >
                      <ExternalLink size={14} />
                      t.me
                    </a>
                  )}
                  {r.tmeUrl && (
                    <button
                      type="button"
                      onClick={() => copy(r.tmeUrl!)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                    >
                      <Copy size={14} />
                      Linki kopyala
                    </button>
                  )}
                </div>
                {!r.isPublic && r.typeLabel !== 'Süper grup' && r.typeLabel !== 'Yayın kanalı' && (
                  <p className="text-white/40 text-xs mt-3 flex items-center gap-1">
                    <Globe size={12} />
                    Kullanıcı adı yok — davet / içeriden ekle gerekir
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : searchDone && !loading && !error ? (
        <p className="text-white/45 text-center py-12">
          Bu kelimelerle eşleşen herkese açık sohbat bulunamadı. Farklı terimler veya &quot;Süper gruplar +
          yayın kanalları&quot; kapsamını deneyin.
        </p>
      ) : null}
    </div>
  )
}
