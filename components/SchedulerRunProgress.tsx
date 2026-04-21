'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

type Props = {
  sentCount: number
  totalCount: number
  runStartedAt?: Date
  statusLine?: string
}

export default function SchedulerRunProgress({ sentCount, totalCount, runStartedAt, statusLine }: Props) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const pct =
    totalCount > 0 ? Math.min(100, Math.round((sentCount / totalCount) * 1000) / 10) : 0
  const indeterminate = totalCount <= 0

  const elapsedMs = useMemo(() => {
    if (!runStartedAt) return 0
    return Date.now() - new Date(runStartedAt).getTime()
  }, [runStartedAt, tick])

  return (
    <div className="mt-3 pt-3 border-t border-emerald-500/20 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs">
        <span className="font-bold text-emerald-400/95 flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin shrink-0 text-emerald-400/90" aria-hidden />
          Gönderim sürüyor
        </span>
        <span className="text-white/55 font-mono tabular-nums">
          Geçen süre:{' '}
          <span className="text-white/90 font-semibold">
            {runStartedAt ? formatElapsed(elapsedMs) : '—'}
          </span>
        </span>
      </div>

      <div className="rounded-lg bg-black/35 border border-white/[0.07] overflow-hidden h-2.5">
        {indeterminate ? (
          <div className="h-full w-full bg-emerald-500/30 animate-pulse" />
        ) : (
          <div
            className="h-full bg-gradient-to-r from-emerald-600/90 to-emerald-400/95 transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px]">
        <span
          className="text-white/70 font-medium"
          title="Başarıyla iletilen mesaj sayısı / bu turdaki toplam gönderim adımı. Canlı logda her hesap satırı görünür; boş alıcısı olan hesaplar veya hata alanlar başarı sayılmaz."
        >
          Başarılı:{' '}
          <span className="text-emerald-300/95 font-bold tabular-nums">
            {sentCount} / {totalCount}
          </span>
          {!indeterminate && (
            <span className="text-white/45 font-normal ml-1">({pct}%)</span>
          )}
        </span>
        {statusLine ? (
          <span className="text-sky-400/90 font-medium truncate max-w-[14rem] sm:max-w-[18rem]" title={statusLine}>
            {statusLine}
          </span>
        ) : null}
      </div>
    </div>
  )
}
