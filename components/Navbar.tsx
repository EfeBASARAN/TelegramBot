'use client'

import { useEffect, useState } from 'react'
import { Settings, Users, Clock } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import BrandLogo from '@/components/BrandLogo'
import { BRAND_NAME } from '@/lib/brand'

export default function Navbar() {
  const accounts = useAppStore((state) => state.accounts)
  const scheduledMessages = useAppStore((state) => state.scheduledMessages)
  const messageTemplates = useAppStore((state) => state.messageTemplates)
  const setCurrentPage = useAppStore((state) => state.setCurrentPage)
  const connectedAccounts = accounts.filter((acc) => acc.isConnected).length
  const totalAccounts = accounts.length
  const [upcomingMessage, setUpcomingMessage] = useState<string | null>(null)

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

  return (
    <nav className="h-[4.25rem] bg-black/65 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-6 relative z-20 shadow-[0_1px_0_0_rgba(34,211,238,0.06)]">
      <div className="flex items-center gap-3 flex-1 overflow-hidden min-w-0">
        <BrandLogo size="sm" />
        <div className="hidden md:flex flex-col min-w-0">
          <span className="text-sm font-bold text-white tracking-tight truncate">{BRAND_NAME}</span>
          <span className="text-[11px] text-white/40 font-medium truncate">Ana panel</span>
        </div>
        
        {/* Yaklaşan Mesaj Kayan Yazı */}
        {upcomingMessage && (
          <div className="hidden lg:flex items-center gap-2 ml-4 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg overflow-hidden flex-1 min-w-0">
            <Clock size={14} className="text-blue-400 flex-shrink-0" />
            <div className="overflow-hidden flex-1">
              <div className="scrolling-text text-xs font-semibold text-blue-400 whitespace-nowrap">
                Sıradaki gönderim: {upcomingMessage}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Accounts Stats */}
        {totalAccounts > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-semibold text-white">
              {connectedAccounts}/{totalAccounts} oturum açık
            </span>
          </div>
        )}

        {/* Accounts */}
        <button 
          onClick={() => setCurrentPage('accounts')}
          className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group"
          title="Hesapları aç"
        >
          <Users size={20} className="text-white/60 group-hover:text-white transition-colors" />
        </button>

        {/* Settings */}
        <button 
          onClick={() => setCurrentPage('settings')}
          className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all group"
          title="API rehberi"
        >
          <Settings size={20} className="text-white/60 group-hover:text-white transition-colors" />
        </button>
      </div>
    </nav>
  )
}

