'use client'

import { X } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export default function ToastStack() {
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-[200] flex max-w-md flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md ${
            t.variant === 'error'
              ? 'border-red-500/40 bg-red-950/90 text-red-50'
              : t.variant === 'success'
                ? 'border-emerald-500/35 bg-emerald-950/90 text-emerald-50'
                : 'border-white/15 bg-zinc-900/95 text-white'
          }`}
        >
          <p className="flex-1 text-sm font-medium leading-snug whitespace-pre-wrap break-words">
            {t.message}
          </p>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="shrink-0 rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Kapat"
          >
            <X size={18} />
          </button>
        </div>
      ))}
    </div>
  )
}
