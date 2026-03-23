'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Terminal, Trash2, ScrollText, Pause, Play } from 'lucide-react'
import { useAppStore, type LiveBotLogEntry, type LiveBotLogLevel } from '@/store/appStore'

function levelStyle(level: LiveBotLogLevel): string {
  switch (level) {
    case 'ok':
      return 'text-emerald-400/95'
    case 'err':
      return 'text-red-400/95'
    case 'warn':
      return 'text-amber-300/95'
    case 'step':
      return 'text-cyan-300/95'
    default:
      return 'text-white/75'
  }
}

function levelLabel(level: LiveBotLogLevel): string {
  switch (level) {
    case 'ok':
      return 'OK'
    case 'err':
      return 'HATA'
    case 'warn':
      return 'UYARI'
    case 'step':
      return 'ADIM'
    default:
      return 'BİLGİ'
  }
}

export default function LiveWatchPage() {
  const liveBotLogs = useAppStore((s) => s.liveBotLogs)
  const clearLiveBotLogs = useAppStore((s) => s.clearLiveBotLogs)
  const [followTail, setFollowTail] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const lines = useMemo(() => liveBotLogs, [liveBotLogs])

  useEffect(() => {
    if (!followTail) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, followTail])

  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setFollowTail(nearBottom)
  }

  return (
    <div className="fade-in relative z-10 min-h-full w-full max-w-[1400px] pb-10">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-2 gradient-text tracking-tight flex items-center gap-3">
            <Terminal className="shrink-0 text-emerald-400/90" size={36} aria-hidden />
            Bot canlı izle
          </h2>
          <p className="text-white/50 text-base font-medium max-w-2xl leading-relaxed">
            Zamanlayıcı ve Telegram gönderim adımları anlık olarak burada akar. Sayfa yenilenince konsol sıfırlanır;
            gönderim günlüğü kalıcı kayıtlar için &quot;Gönderim günlüğü&quot; sayfasındadır.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setFollowTail((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-white/15 bg-white/[0.06] hover:bg-white/10 text-white/90 transition-colors"
            title={followTail ? 'Otomatik alta kaydı durdur' : 'Yeni satırda alta kaydır'}
          >
            {followTail ? <Pause size={17} /> : <Play size={17} />}
            {followTail ? 'Alta kaydır (açık)' : 'Alta kaydır (kapalı)'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Konsoldaki tüm satırları temizlemek istiyor musunuz?')) clearLiveBotLogs()
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border border-red-500/25 bg-red-500/[0.08] hover:bg-red-500/[0.12] text-red-200/95 transition-colors"
          >
            <Trash2 size={17} />
            Konsolu temizle
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.1] bg-[rgba(6,8,10,0.92)] backdrop-blur-md shadow-2xl overflow-hidden flex flex-col min-h-[min(70vh,720px)] max-h-[min(78vh,900px)]">
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/[0.08] bg-black/40">
          <ScrollText size={17} className="text-white/45" aria-hidden />
          <span className="text-xs font-bold text-white/55 uppercase tracking-wider">Konsol</span>
          <span className="text-[11px] text-white/35 ml-auto font-mono">
            {lines.length.toLocaleString('tr-TR')} satır
          </span>
        </div>
        <div
          ref={containerRef}
          onScroll={onScroll}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 font-mono text-[12px] sm:text-[13px] leading-relaxed"
        >
          {lines.length === 0 ? (
            <p className="text-white/40 text-sm py-16 text-center">
              Henüz canlı kayıt yok. Zamanlayıcıdan bir gönderim başlattığınızda veya plan tetiklendiğinde satırlar
              burada görünecek.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {lines.map((line: LiveBotLogEntry) => (
                <li key={line.id} className="break-words">
                  <span className="text-white/35 select-none">
                    {new Date(line.ts).toLocaleTimeString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                    .{String(line.ts % 1000).padStart(3, '0')}
                  </span>{' '}
                  <span className={`font-bold ${levelStyle(line.level)}`}>[{levelLabel(line.level)}]</span>{' '}
                  <span className="text-white/88">{line.message}</span>
                  {line.detail ? (
                    <span className="block pl-0 sm:pl-[11rem] text-white/50 mt-0.5 border-l-2 border-white/[0.06] pl-2 ml-0 sm:ml-0">
                      {line.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
