'use client'

import { useMemo, useState } from 'react'
import { Link2, Loader2, LogIn } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { telegramManager } from '@/lib/telegram'

function parseTargets(raw: string): string[] {
  return raw
    .split(/\r?\n|,|;/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export default function JoinPage() {
  const accounts = useAppStore((state) => state.accounts)
  const apiConfig = useAppStore((state) => state.apiConfig)
  const pushToast = useAppStore((state) => state.pushToast)

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => a.isConnected && !!a.sessionString),
    [accounts]
  )

  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [targetsInput, setTargetsInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Array<{ target: string; ok: boolean; message: string }>>([])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId),
    [accounts, selectedAccountId]
  )

  const handleJoin = async () => {
    if (!selectedAccount) {
      pushToast('Önce bir hesap seçin', 'info')
      return
    }
    if (!selectedAccount.sessionString) {
      pushToast('Seçili hesapta oturum bilgisi yok', 'error')
      return
    }

    const targets = parseTargets(targetsInput)
    if (targets.length === 0) {
      pushToast('En az bir grup/kanal hedefi girin', 'info')
      return
    }

    setLoading(true)
    setResults([])
    try {
      const apiId = selectedAccount.apiId || apiConfig?.apiId
      const apiHash = selectedAccount.apiHash || apiConfig?.apiHash
      const res = await telegramManager.joinChatsByTargets(
        selectedAccount.id,
        selectedAccount.sessionString,
        selectedAccount.phoneNumber,
        apiId,
        apiHash,
        targets
      )

      if (!res.success) {
        pushToast(res.error || 'Katılım işlemi başarısız', 'error')
        return
      }

      const list = res.results || []
      setResults(list)
      const okCount = list.filter((x) => x.ok).length
      const failCount = list.length - okCount
      if (okCount > 0) {
        pushToast(`${okCount} hedefe katılım başarılı`, 'success')
      }
      if (failCount > 0) {
        pushToast(`${failCount} hedefte hata oluştu`, 'error')
      }
    } catch (e: unknown) {
      pushToast(e instanceof Error ? e.message : 'Beklenmeyen hata', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fade-in relative z-10 min-h-full w-full max-w-[1200px]">
      <div className="mb-8">
        <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Grup/Kanal Katılım</h2>
        <p className="text-white/50 text-base font-medium max-w-3xl leading-relaxed">
          Grup adı, kullanıcı adı veya davet linki girin; bir hesap seçip <span className="text-white">Katıl</span>{' '}
          deyin. Hedefleri satır satır, virgül veya noktalı virgül ile ayırabilirsiniz.
        </p>
      </div>

      <div className="surface-panel rounded-2xl p-6 md:p-7 shadow-2xl space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label htmlFor="join-account" className="text-sm text-white/60 font-semibold">
              Hesap
            </label>
            <select
              id="join-account"
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="input-focus w-full px-4 py-3 rounded-xl text-white text-sm"
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

        <div className="space-y-2">
          <label htmlFor="join-targets" className="text-sm text-white/60 font-semibold">
            Grup/Kanal hedefleri
          </label>
          <textarea
            id="join-targets"
            value={targetsInput}
            onChange={(e) => setTargetsInput(e.target.value)}
            rows={8}
            placeholder={`@kanaladi\nhttps://t.me/kanaladi\nhttps://t.me/+AbCdEfGhIjKlMnOp`}
            className="input-focus w-full px-4 py-3 rounded-xl text-white text-sm font-mono placeholder:text-white/30"
          />
          <p className="text-xs text-white/40">
            Desteklenen formatlar: <code>@kullaniciadi</code>, <code>t.me/kullaniciadi</code>,{' '}
            <code>t.me/+davetHash</code>, <code>t.me/joinchat/davetHash</code>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleJoin}
            disabled={loading}
            className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
            {loading ? 'Katılıyor…' : 'Katıl'}
          </button>
          <div className="text-xs text-white/45 inline-flex items-center gap-2">
            <Link2 size={14} />
            Hedef sayısı: {parseTargets(targetsInput).length}
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="mt-6 surface-panel rounded-2xl p-5 shadow-xl">
          <h3 className="text-white font-bold mb-3">Sonuçlar</h3>
          <div className="space-y-2 max-h-[380px] overflow-auto pr-1">
            {results.map((r, idx) => (
              <div
                key={`${r.target}-${idx}`}
                className={`rounded-lg px-3 py-2 text-sm border ${
                  r.ok
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                    : 'bg-red-500/10 border-red-500/25 text-red-200'
                }`}
              >
                <span className="font-mono">{r.target}</span> — {r.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

