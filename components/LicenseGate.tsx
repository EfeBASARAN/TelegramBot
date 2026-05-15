'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { getMachineId } from '@/lib/machineFingerprint'
import {
  clearLicenseToken,
  getLicenseToken,
  setLicenseToken,
} from '@/lib/licenseStorage'
import { verifyLicenseToken } from '@/lib/licenseVerify'

type GateState =
  | { status: 'loading' }
  | { status: 'blocked'; message: string }
  | { status: 'activate'; machineId: string }
  | { status: 'ok' }

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: 'loading' })
  const [paste, setPaste] = useState('')
  const [err, setErr] = useState('')

  const checkStored = useCallback(async () => {
    setErr('')
    const mid = await getMachineId()
    if (!mid) {
      setState({ status: 'blocked', message: 'Bu ortamda lisans doğrulanamıyor.' })
      return
    }

    const raw = await getLicenseToken()
    if (!raw) {
      setState({ status: 'activate', machineId: mid })
      return
    }

    const result = await verifyLicenseToken(raw, mid)
    if (result.ok) {
      setState({ status: 'ok' })
      return
    }

    await clearLicenseToken()
    if (result.reason.includes('süresi dolmuş')) {
      setState({
        status: 'blocked',
        message:
          'Lisans süresi doldu. Program kullanılamaz. Yeni lisans için satıcıyla iletişime geçin.',
      })
      return
    }
    setState({ status: 'activate', machineId: mid })
    setErr(result.reason)
  }, [])

  useEffect(() => {
    void checkStored()
  }, [checkStored])

  useEffect(() => {
    if (state.status !== 'ok') return
    const id = window.setInterval(() => {
      void (async () => {
        const mid = await getMachineId()
        const raw = await getLicenseToken()
        if (!raw) {
          setState({ status: 'activate', machineId: mid })
          return
        }
        const result = await verifyLicenseToken(raw, mid)
        if (!result.ok) {
          await clearLicenseToken()
          setState({
            status: 'blocked',
            message:
              result.reason.includes('süresi') || result.reason.includes('dolmuş')
                ? 'Lisans süresi doldu. Program kullanılamaz.'
                : result.reason,
          })
        }
      })()
    }, 2000)
    return () => window.clearInterval(id)
  }, [state.status])

  const applyLicense = async () => {
    setErr('')
    const mid = await getMachineId()
    const token = paste.trim()
    if (!token) {
      setErr('Lisans anahtarını yapıştırın.')
      return
    }
    const result = await verifyLicenseToken(token, mid)
    if (!result.ok) {
      setErr(result.reason)
      return
    }
    await setLicenseToken(token)
    setState({ status: 'ok' })
  }

  const copyMachine = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      setErr('Panoya kopyalanamadı; kodu elle seçip kopyalayın.')
    }
  }

  const shellStyle: CSSProperties = {
    position: 'relative',
    zIndex: 10,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#09090b',
    color: '#e8eaed',
    padding: '1.5rem',
  }

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white" style={shellStyle}>
        <p className="text-white/60 text-sm" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14 }}>
          Lisans kontrol ediliyor…
        </p>
      </div>
    )
  }

  if (state.status === 'blocked') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-white px-6" style={shellStyle}>
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-950/40 p-8 text-center">
          <h1 className="text-xl font-bold text-red-200 mb-3">Erişim kapalı</h1>
          <p className="text-red-100/90 text-sm leading-relaxed">{state.message}</p>
        </div>
      </div>
    )
  }

  if (state.status === 'activate') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-white px-4 py-12" style={shellStyle}>
        <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-zinc-900/90 p-8 shadow-2xl">
          <h1 className="text-2xl font-bold mb-2">Lisans gerekli</h1>
          <p className="text-white/55 text-sm mb-6 leading-relaxed">
            Makine kodu bu bilgisayarın donanımına göredir; tarayıcı değiştirseniz de aynı kalır. Aşağıdaki{' '}
            <strong>makine kodunu</strong> kopyalayıp satıcıya gönderin (ör. WhatsApp). Size gönderilen lisans
            anahtarını yapıştırıp &quot;Etkinleştir&quot; deyin.
          </p>

          <div className="mb-4">
            <p className="text-xs text-white/40 mb-1 font-medium uppercase tracking-wide">Makine kodu</p>
            <div className="flex gap-2 flex-wrap sm:flex-nowrap">
              <code className="flex-1 min-w-0 break-all rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs font-mono text-emerald-300/95">
                {state.machineId}
              </code>
              <button
                type="button"
                onClick={() => void copyMachine(state.machineId)}
                className="shrink-0 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-semibold border border-white/10"
              >
                Kopyala
              </button>
            </div>
          </div>

          <label className="block text-xs text-white/40 mb-1 font-medium">Lisans anahtarı</label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            placeholder="Satıcının gönderdiği tek satırlık anahtar"
            className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 mb-3"
          />

          {err && (
            <p className="text-amber-300/95 text-sm mb-3 rounded-lg border border-amber-500/25 bg-amber-950/30 px-3 py-2">
              {err}
            </p>
          )}

          <button
            type="button"
            onClick={() => void applyLicense()}
            className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-teal-700 hover:from-cyan-500 hover:to-teal-600 text-white shadow-lg"
          >
            Etkinleştir
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
