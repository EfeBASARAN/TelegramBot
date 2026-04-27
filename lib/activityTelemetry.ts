'use client'

import { LICENSE_STORAGE_KEY } from './licenseConstants'
import { getMachineId } from './machineFingerprint'
import { verifyLicenseToken } from './licenseVerify'

type ActivityLevel = 'info' | 'ok' | 'warn' | 'err' | 'step'

interface ActivityPayload {
  type: 'page_visit' | 'action_log'
  level: ActivityLevel
  message: string
  detail?: string
  happenedAtIso: string
}

interface ActivityPayloadFull extends ActivityPayload {
  type: 'page_visit' | 'action_log'
  level: ActivityLevel
  message: string
  detail?: string
  happenedAtIso: string
  ip: string
  machineId: string
  licenseTokenMasked: string
  license: {
    status: 'ok' | 'invalid' | 'missing'
    reason?: string
    expiresAt?: number
    issuedAt?: number
    remainingMs?: number
  }
  browser: {
    userAgent: string
    platform: string
    language: string
    cores: number
    screen: string
    timeZone: string
  }
}

const recentSent = new Map<string, number>()
let cachedIp = ''
let cachedMachineId = ''

function shouldSend(key: string, now: number): boolean {
  const last = recentSent.get(key) ?? 0
  if (now - last < 1200) return false
  recentSent.set(key, now)
  if (recentSent.size > 200) {
    const oldest = Array.from(recentSent.keys()).slice(0, 50)
    for (const k of oldest) recentSent.delete(k)
  }
  return true
}

function maskLicenseToken(token: string): string {
  if (!token) return '-'
  if (token.length <= 20) return token
  return `${token.slice(0, 10)}...${token.slice(-8)}`
}

async function getPublicIp(): Promise<string> {
  if (cachedIp) return cachedIp
  try {
    const res = await fetch('https://api.ipify.org?format=json', { method: 'GET' })
    if (!res.ok) return 'unknown'
    const json = (await res.json()) as { ip?: string }
    cachedIp = json.ip?.trim() || 'unknown'
    return cachedIp
  } catch {
    return 'unknown'
  }
}

async function getMachineIdCached(): Promise<string> {
  if (cachedMachineId) return cachedMachineId
  try {
    cachedMachineId = await getMachineId()
    return cachedMachineId || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function resolveLicense(machineId: string): Promise<ActivityPayloadFull['license']> {
  const raw = localStorage.getItem(LICENSE_STORAGE_KEY)?.trim() || ''
  if (!raw) return { status: 'missing' }
  const verified = await verifyLicenseToken(raw, machineId)
  if (!verified.ok) return { status: 'invalid', reason: verified.reason }
  return {
    status: 'ok',
    expiresAt: verified.payload.expiresAt,
    issuedAt: verified.payload.issuedAt,
    remainingMs: verified.payload.expiresAt - Date.now(),
  }
}

export async function reportActivityToTelegram(payload: ActivityPayload): Promise<void> {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const key = `${payload.type}|${payload.level}|${payload.message}|${payload.detail || ''}`
  if (!shouldSend(key, now)) return
  try {
    const machineId = await getMachineIdCached()
    const ip = await getPublicIp()
    const rawLicense = localStorage.getItem(LICENSE_STORAGE_KEY)?.trim() || ''
    const license = await resolveLicense(machineId)
    const fullPayload: ActivityPayloadFull = {
      ...payload,
      ip,
      machineId,
      licenseTokenMasked: maskLicenseToken(rawLicense),
      license,
      browser: {
        userAgent: navigator.userAgent || 'unknown',
        platform: navigator.platform || 'unknown',
        language: navigator.language || 'unknown',
        cores: navigator.hardwareConcurrency ?? 0,
        screen:
          typeof screen !== 'undefined'
            ? `${screen.width}x${screen.height} / ${screen.colorDepth}bit`
            : 'unknown',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
      },
    }
    await fetch('/api/activity-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullPayload),
    })
  } catch {
    // Sessiz gec: ana akis bozulmasin.
  }
}
