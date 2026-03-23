'use client'

import { useAppStore, type LiveBotLogLevel } from '@/store/appStore'

/** Uzun metinleri konsolda kısalt */
export function trunc(s: string, max = 100): string {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Zamanlayıcı / Telegram anlık konsol (Canlı izle sayfası) */
export function liveLog(level: LiveBotLogLevel, message: string, detail?: string): void {
  if (typeof window === 'undefined') return
  try {
    useAppStore.getState().pushLiveBotLog({ level, message, detail })
  } catch {
    /* ignore */
  }
}
