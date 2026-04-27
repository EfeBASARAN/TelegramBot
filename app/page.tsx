'use client'

import { useEffect, useRef } from 'react'
import Sidebar from '@/components/Sidebar'
import Navbar from '@/components/Navbar'
import AccountsPage from '@/components/AccountsPage'
import MessagesPage from '@/components/MessagesPage'
import SchedulerPage from '@/components/SchedulerPage'
import SettingsPage from '@/components/SettingsPage'
import LogsPage from '@/components/LogsPage'
import LiveWatchPage from '@/components/LiveWatchPage'
import GroupsPage from '@/components/GroupsPage'
import GroupFinderPage from '@/components/GroupFinderPage'
import JoinPage from '@/components/JoinPage'
import ToastStack from '@/components/ToastStack'
import { useAppStore } from '@/store/appStore'
import { telegramManager } from '@/lib/telegram'
import { resumeActiveScheduledMessagesAfterLoad } from '@/lib/schedulerClient'
import { reportStartupToTelegram } from '@/lib/startupTelemetry'

export default function Home() {
  const currentPage = useAppStore((state) => state.currentPage)
  const loadFromStorage = useAppStore((state) => state.loadFromStorage)
  const isLoaded = useAppStore((state) => state.isLoaded)
  const mouseGlowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Sayfa yüklendiğinde localStorage'dan verileri yükle
    if (!isLoaded) {
      loadFromStorage()
    }
  }, [isLoaded, loadFromStorage])

  useEffect(() => {
    if (!isLoaded) return
    const { apiConfig, accounts } = useAppStore.getState()
    if (apiConfig?.apiId && apiConfig?.apiHash) {
      telegramManager.setApiConfig(apiConfig.apiId, apiConfig.apiHash)
    } else {
      const acc = accounts.find((a) => a.apiId && a.apiHash)
      if (acc?.apiId && acc?.apiHash) {
        telegramManager.setApiConfig(acc.apiId, acc.apiHash)
      }
    }
    void resumeActiveScheduledMessagesAfterLoad()
    void reportStartupToTelegram()
  }, [isLoaded])

  useEffect(() => {
    // Canvas ile direkt çizgi çizme - Optimize edilmiş versiyon
    if (!mouseGlowRef.current) return

    const canvas = document.createElement('canvas')
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    canvas.style.position = 'fixed'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '5'
    
    const container = mouseGlowRef.current.querySelector('.cursor-trail-container')
    if (container) {
      container.appendChild(canvas)
    }

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    // GPU acceleration için optimize et
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    let lastX = 0
    let lastY = 0
    let isFirstMove = true
    let animationFrameId: number | null = null
    let isAnimating = false
    const MAX_POINTS = 50 // Maksimum nokta sayısı
    const trailPoints: Array<{ x: number; y: number; time: number; thickness: number }> = []

    // Canvas boyutunu güncelle (throttle ile)
    let resizeTimeout: NodeJS.Timeout
    const resizeCanvas = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
      }, 100)
    }
    window.addEventListener('resize', resizeCanvas, { passive: true })

    // Optimize edilmiş animasyon - sadece gerektiğinde çalışır
    const animate = () => {
      const now = Date.now()
      
      // Eski noktaları temizle
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // TrailPoints yoksa veya çok azsa animasyonu durdur
      if (trailPoints.length < 2) {
        isAnimating = false
        animationFrameId = null
        return
      }
      
      // Eski noktaları kaldır (önce temizle, sonra çiz)
      while (trailPoints.length > 0 && now - trailPoints[0].time > 1500) {
        trailPoints.shift()
      }
      
      // Maksimum nokta sayısını sınırla
      if (trailPoints.length > MAX_POINTS) {
        trailPoints.shift()
      }
      
      if (trailPoints.length < 2) {
        isAnimating = false
        animationFrameId = null
        return
      }
      
      // Tek katmanlı optimize çizim
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.shadowBlur = 6 // Daha düşük shadow blur
      ctx.shadowColor = 'rgba(255, 255, 255, 0.15)'
      
      // Tüm çizgiyi tek seferde çiz
      let hasVisiblePoints = false
      for (let i = 1; i < trailPoints.length; i++) {
        const point = trailPoints[i]
        const prevPoint = trailPoints[i - 1]
        const age = now - point.time
        const opacity = Math.max(0, 1 - age / 1500)
        
        if (opacity > 0.01) {
          hasVisiblePoints = true
          // Kuyruklu yıldız efekti: baştan kalın, sona doğru ince
          const totalPoints = trailPoints.length
          const position = i / totalPoints
          const taperFactor = 1 - position * 0.6
          
          const finalOpacity = opacity * taperFactor
          const finalThickness = point.thickness * finalOpacity * 0.9
          
          ctx.beginPath()
          ctx.moveTo(prevPoint.x, prevPoint.y)
          ctx.lineTo(point.x, point.y)
          ctx.strokeStyle = `rgba(220, 225, 230, ${finalOpacity * 0.65})`
          ctx.lineWidth = finalThickness
          ctx.stroke()
        }
      }
      
      // Görünür nokta varsa animasyonu devam ettir
      if (hasVisiblePoints && trailPoints.length >= 2) {
        animationFrameId = requestAnimationFrame(animate)
      } else {
        isAnimating = false
        animationFrameId = null
      }
    }

    // Throttle ile mouse move event'i
    let lastMouseMoveTime = 0
    const MOUSE_MOVE_THROTTLE = 16 // ~60fps

    const handleMouseMove = (e: MouseEvent) => {
      const now = performance.now()
      if (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE) return
      lastMouseMoveTime = now

      const x = e.clientX
      const y = e.clientY
      
      if (!isFirstMove && lastX !== 0 && lastY !== 0) {
        const dx = x - lastX
        const dy = y - lastY
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        // Minimum mesafe kontrolü
        if (distance > 0.5) {
          // Hıza göre kalınlık
          const thickness = Math.min(Math.max(1.5 + distance / 10, 1), 3.5)
          
          trailPoints.push({
            x,
            y,
            time: Date.now(),
            thickness
          })
          
          // Maksimum nokta sayısını kontrol et
          if (trailPoints.length > MAX_POINTS) {
            trailPoints.shift()
          }
          
          // Animasyonu başlat (eğer çalışmıyorsa)
          if (!isAnimating && trailPoints.length >= 2) {
            isAnimating = true
            animationFrameId = requestAnimationFrame(animate)
          }
        }
      }
      
      isFirstMove = false
      lastX = x
      lastY = y
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('resize', resizeCanvas)
      clearTimeout(resizeTimeout)
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas)
      }
    }
  }, [])

  const renderPage = () => {
    switch (currentPage) {
      case 'settings':
        return <SettingsPage />
      case 'accounts':
        return <AccountsPage />
      case 'groups':
        return <GroupsPage />
      case 'group_finder':
        return <GroupFinderPage />
      case 'join':
        return <JoinPage />
      case 'messages':
        return <MessagesPage />
      case 'scheduler':
        return <SchedulerPage />
      case 'logs':
        return <LogsPage />
      case 'live':
        return <LiveWatchPage />
      default:
        return <SettingsPage />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden relative">
      {/* Mekatronik Background - SABIT */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Circuit Grid Pattern */}
        <div className="circuit-grid" />
        
        {/* Technical Lines */}
        <div className="tech-lines">
          <div className="tech-line tech-line-1" />
          <div className="tech-line tech-line-2" />
          <div className="tech-line tech-line-3" />
          <div className="tech-line tech-line-4" />
        </div>

        {/* Geometric Shapes */}
        <div className="geometric-shapes">
          <div className="geo-shape geo-shape-1" />
          <div className="geo-shape geo-shape-2" />
          <div className="geo-shape geo-shape-3" />
        </div>

        {/* Circuit Nodes */}
        <div className="circuit-nodes">
          <div className="circuit-node node-1" />
          <div className="circuit-node node-2" />
          <div className="circuit-node node-3" />
          <div className="circuit-node node-4" />
          <div className="circuit-node node-5" />
          <div className="circuit-node node-6" />
        </div>
      </div>

      {/* Interactive Cursor Trails - Canvas */}
      <div ref={mouseGlowRef} className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
        <div className="cursor-trail-container">
          {/* Canvas will be added dynamically */}
        </div>
      </div>
      
      <Sidebar />
      <div className="flex-1 flex flex-col relative z-[10]">
        <Navbar />
        <main className="flex-1 overflow-y-auto py-8 pl-6 pr-5 sm:pl-10 sm:pr-8 lg:pl-14 lg:pr-12 xl:pl-16 xl:pr-14">
          {renderPage()}
        </main>
      </div>
      <ToastStack />
    </div>
  )
}

