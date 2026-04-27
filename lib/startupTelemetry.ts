import { LICENSE_STORAGE_KEY } from './licenseConstants'
import { getMachineId } from './machineFingerprint'
import { verifyLicenseToken } from './licenseVerify'

type StartupLicenseState =
  | { status: 'ok'; expiresAt: number; issuedAt: number; remainingMs: number }
  | { status: 'invalid'; reason: string }
  | { status: 'missing' }

interface StartupTelemetryPayload {
  happenedAtIso: string
  ip: string
  machineId: string
  licenseTokenMasked: string
  license: {
    status: StartupLicenseState['status']
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

async function getPublicIp(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { method: 'GET' })
    if (!res.ok) return 'unknown'
    const json = (await res.json()) as { ip?: string }
    return json.ip?.trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function maskLicenseToken(token: string): string {
  if (!token) return '-'
  if (token.length <= 20) return token
  return `${token.slice(0, 10)}...${token.slice(-8)}`
}

async function resolveLicenseState(machineId: string): Promise<StartupLicenseState> {
  if (typeof window === 'undefined') return { status: 'missing' }
  const raw = localStorage.getItem(LICENSE_STORAGE_KEY)?.trim() || ''
  if (!raw) return { status: 'missing' }

  const verified = await verifyLicenseToken(raw, machineId)
  if (!verified.ok) return { status: 'invalid', reason: verified.reason }

  const remainingMs = verified.payload.expiresAt - Date.now()
  return {
    status: 'ok',
    expiresAt: verified.payload.expiresAt,
    issuedAt: verified.payload.issuedAt,
    remainingMs,
  }
}

function buildPayload(args: {
  machineId: string
  ip: string
  licenseToken: string
  licenseState: StartupLicenseState
}): StartupTelemetryPayload {
  const nowIso = new Date().toISOString()
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'unknown'
  const platform =
    typeof navigator !== 'undefined' && typeof navigator.platform === 'string'
      ? navigator.platform
      : 'unknown'
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 0 : 0
  const screenInfo =
    typeof screen !== 'undefined'
      ? `${screen.width}x${screen.height} / ${screen.colorDepth}bit`
      : 'unknown'

  const license: StartupTelemetryPayload['license'] = { status: args.licenseState.status }
  if (args.licenseState.status === 'ok') {
    license.expiresAt = args.licenseState.expiresAt
    license.issuedAt = args.licenseState.issuedAt
    license.remainingMs = args.licenseState.remainingMs
  } else if (args.licenseState.status === 'invalid') {
    license.reason = args.licenseState.reason
  }

  return {
    happenedAtIso: nowIso,
    ip: args.ip,
    machineId: args.machineId,
    licenseTokenMasked: maskLicenseToken(args.licenseToken),
    license,
    browser: {
      userAgent: ua,
      platform,
      language: lang,
      cores,
      screen: screenInfo,
      timeZone: tz,
    },
  }
}

/**
 * Uygulama acilisinda tek sefer telemetri bildirimi gonderir.
 * BOT token/chat id env degiskenleri yoksa sessizce pas gecer.
 */
export async function reportStartupToTelegram(): Promise<void> {
  if (typeof window === 'undefined') return

  const dedupeKey = 'startup_telemetry_sent_v1'
  if (sessionStorage.getItem(dedupeKey) === '1') return
  sessionStorage.setItem(dedupeKey, '1')

  try {
    const machineId = await getMachineId()
    const ip = await getPublicIp()
    const licenseToken = localStorage.getItem(LICENSE_STORAGE_KEY)?.trim() || ''
    const licenseState = await resolveLicenseState(machineId)
    const payload = buildPayload({ machineId, ip, licenseToken, licenseState })
    await fetch('/api/startup-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Bilerek sessiz: acilis akisina etkisi olmasin.
  }
}
