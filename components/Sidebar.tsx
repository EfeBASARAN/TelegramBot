'use client'

import { useEffect, useState } from 'react'
import { Users, MessageSquare, Clock, Settings, AlertCircle, Hash, Terminal } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import BrandLogo from '@/components/BrandLogo'
import { BRAND_NAME, BRAND_TAGLINE, BRAND_VERSION } from '@/lib/brand'
import { LICENSE_STORAGE_KEY } from '@/lib/licenseConstants'
import { getMachineId } from '@/lib/machineFingerprint'
import { verifyLicenseToken } from '@/lib/licenseVerify'

function formatLicenseRemaining(ms: number): string {
  if (ms <= 0) return '0 sn'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (days > 0) return `${days} gün ${h} sa ${m} dk ${s} sn`
  if (h > 0) return `${h} sa ${m} dk ${s} sn`
  if (m > 0) return `${m} dk ${s} sn`
  return `${s} sn`
}

export default function Sidebar() {
  const currentPage = useAppStore((state) => state.currentPage)
  const scheduledMessages = useAppStore((state) => state.scheduledMessages)
  const messageTemplates = useAppStore((state) => state.messageTemplates)
  const setCurrentPage = useAppStore((state) => state.setCurrentPage)
  const [upcomingMessage, setUpcomingMessage] = useState<string | null>(null)
  const [licenseRemaining, setLicenseRemaining] = useState<string | null>(null)

  // Yaklaşan mesajları bul ve kayan yazı oluştur
  useEffect(() => {
    const findUpcomingMessages = () => {
      const now = new Date().getTime()
      const upcoming = scheduledMessages
        .filter((msg) => {
          const scheduledTime = new Date(msg.scheduledTime).getTime()
          const diff = scheduledTime - now
          return diff > 0 // Gelecekte olan tüm mesajlar
        })
        .sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime())

      if (upcoming.length > 0) {
        const msg = upcoming[0]
        const template = messageTemplates.find((t) => t.id === msg.messageTemplateId)
        const scheduledTime = new Date(msg.scheduledTime)
        const hours = scheduledTime.getHours().toString().padStart(2, '0')
        const minutes = scheduledTime.getMinutes().toString().padStart(2, '0')
        
        const newMessage = `${template?.name || 'Mesaj'} - ${hours}:${minutes}`
        
        // Sadece değiştiyse güncelle
        if (upcomingMessage !== newMessage) {
          setUpcomingMessage(newMessage)
        }
      } else {
        if (upcomingMessage !== null) {
          setUpcomingMessage(null)
        }
      }
    }

    findUpcomingMessages()
    const interval = setInterval(findUpcomingMessages, 1000) // Her saniye kontrol et

    return () => clearInterval(interval)
  }, [scheduledMessages, messageTemplates])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (typeof window === 'undefined') return
      const raw = localStorage.getItem(LICENSE_STORAGE_KEY)
      if (!raw?.trim()) {
        if (!cancelled) setLicenseRemaining(null)
        return
      }
      const mid = await getMachineId()
      const result = await verifyLicenseToken(raw.trim(), mid)
      if (cancelled) return
      if (!result.ok) {
        setLicenseRemaining(null)
        return
      }
      setLicenseRemaining(formatLicenseRemaining(result.payload.expiresAt - Date.now()))
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const menuItems = [
    { id: 'settings', label: 'API rehberi', icon: Settings },
    { id: 'accounts', label: 'Hesaplar', icon: Users },
    { id: 'groups', label: 'Gruplar', icon: Hash },
    { id: 'messages', label: 'Mesaj şablonları', icon: MessageSquare },
    { id: 'scheduler', label: 'Zamanlayıcı', icon: Clock },
    { id: 'live', label: 'Bot canlı izle', icon: Terminal },
    { id: 'logs', label: 'Gönderim günlüğü', icon: AlertCircle },
  ]

  return (
    <aside className="w-72 bg-zinc-950/94 backdrop-blur-xl border-r border-white/[0.08] flex flex-col shadow-[0_0_0_1px_rgba(14,90,102,0.1),0_25px_50px_-12px_rgba(0,0,0,0.75)] relative z-20">
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] via-transparent to-transparent pointer-events-none" />
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/12 to-transparent shrink-0" />

      <div className="p-8 border-b border-white/[0.06] relative z-10">
        <div className="flex items-center gap-4">
          <BrandLogo size="lg" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white tracking-tight leading-snug truncate">
              {BRAND_NAME}
            </h1>
            <p className="text-xs text-white/45 mt-0.5 font-medium leading-relaxed">
              {BRAND_TAGLINE}
            </p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4 overflow-y-auto relative z-10">
        <ul className="space-y-2">
          {menuItems.map((item, index) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            return (
              <li key={item.id} className="slide-in" style={{ animationDelay: `${index * 0.05}s` }}>
                <button
                  onClick={() => setCurrentPage(item.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-300 relative group overflow-hidden ${
                    isActive
                      ? 'bg-white/[0.08] text-white shadow-lg border-2 border-white/15'
                      : 'text-white/55 hover:bg-white/[0.05] hover:text-white border-2 border-white/[0.08] hover:border-white/12'
                  }`}
                >
                  {isActive && (
                    <>
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-white/35 rounded-r-full shadow-lg" />
                      <div className="absolute inset-0 bg-gradient-to-r from-white/[0.06] to-transparent" />
                    </>
                  )}
                  <Icon size={20} className={`relative z-10 ${isActive ? 'text-white' : 'text-white/50 group-hover:text-white transition-colors'}`} />
                  <span className="font-semibold text-sm relative z-10">{item.label}</span>
                  
                  {!isActive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      
      <div className="p-4 border-t border-white/[0.06] relative z-10">
        {/* Yaklaşan Mesaj Kayan Yazı */}
        {upcomingMessage && (
          <div className="mb-3 px-3 py-2 bg-white/[0.06] border border-white/10 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={12} className="text-slate-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-300">Sıradaki</span>
            </div>
            <div className="overflow-hidden">
              <div className="scrolling-text text-xs font-medium text-slate-200/90 whitespace-nowrap">
                {upcomingMessage}
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center justify-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10">
              Pro
            </span>
            <span className="text-xs text-white/35 font-medium tabular-nums">v{BRAND_VERSION}</span>
          </div>
          {licenseRemaining !== null && (
            <p className="text-center text-[10px] leading-snug text-emerald-200/85 font-medium tabular-nums px-1">
              <span className="block text-white/40 font-normal normal-case tracking-normal mb-0.5">
                Lisansınızın bitmesine kalan süre
              </span>
              {licenseRemaining}
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}

