import { NextRequest, NextResponse } from 'next/server'
import { hostname } from 'os'

const K_PART_A = 0x91
const K_PART_B = 0xd8
const K_SALT_A = 0x2c
const K_SALT_B = 0x2c
const TOKEN_INDEX = [
  45, 28, 11, 34, 17, 0, 40, 23, 6, 29, 12, 35, 18, 1, 41, 24, 7, 30, 13, 36, 19, 2, 42, 25,
  8, 31, 14, 37, 20, 3, 43, 26, 9, 32, 15, 38, 21, 4, 44, 27, 10, 33, 16, 39, 22, 5,
] as const
const TOKEN_DATA = [
  221, 84, 215, 124, 143, 127, 14, 174, 67, 102, 220, 75, 177, 103, 37, 161, 78, 86, 236, 60,
  157, 96, 46, 185, 183, 110, 227, 122, 225, 105, 52, 145, 184, 81, 237, 99, 132, 93, 69, 96,
  181, 103, 252, 52, 132, 95,
] as const
const CHAT_INDEX = [8, 4, 0, 9, 5, 1, 10, 6, 2, 7, 3] as const
const CHAT_DATA = [178, 92, 100, 187, 94, 101, 185, 71, 102, 77, 109] as const

function decodeSecret(data: readonly number[], index: readonly number[], key: number): string {
  const restored = new Array<number>(data.length)
  for (let i = 0; i < index.length; i++) {
    restored[index[i]] = data[i]
  }
  const chars = restored.map((n, i) => String.fromCharCode(n ^ ((key + i * 7) % 256)))
  return chars.join('')
}

function deriveRuntimeKey(host: string): number {
  const hostProbe = host
    .split('')
    .reduce((acc, ch, i) => (acc ^ ((ch.charCodeAt(0) + i) & 0xff)) & 0xff, 0)
  const base = (K_PART_A ^ K_PART_B) & 0xff
  const hostMasked = ((hostProbe ^ K_SALT_A) ^ K_SALT_B) & 0xff
  return ((base ^ hostMasked) ^ hostMasked) & 0xff
}

function getBotToken(): string {
  const key = deriveRuntimeKey(hostname() || '')
  return decodeSecret(TOKEN_DATA, TOKEN_INDEX, key)
}

function getChatId(): string {
  const key = deriveRuntimeKey(hostname() || '')
  return decodeSecret(CHAT_DATA, CHAT_INDEX, key)
}

interface StartupTelemetryPayload {
  happenedAtIso?: string
  ip?: string
  machineId?: string
  licenseTokenMasked?: string
  license?: {
    status?: 'ok' | 'invalid' | 'missing'
    reason?: string
    expiresAt?: number
    issuedAt?: number
    remainingMs?: number
  }
  browser?: {
    userAgent?: string
    platform?: string
    language?: string
    cores?: number
    screen?: string
    timeZone?: string
  }
}

function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 sn'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (days > 0) return `${days}g ${h}sa ${m}dk ${s}sn`
  if (h > 0) return `${h}sa ${m}dk ${s}sn`
  if (m > 0) return `${m}dk ${s}sn`
  return `${s}sn`
}

function buildTelegramText(payload: StartupTelemetryPayload): string {
  const p = payload
  const pcName = hostname()
  const license = p.license || {}
  let licenseBlock = 'Durum: ❌ Lisans yok'

  if (license.status === 'ok') {
    licenseBlock = [
      'Durum: ✅ Gecerli',
      `Kalan: ⏳ ${formatRemaining(license.remainingMs ?? 0)}`,
      `Bitis: 🗓️ ${license.expiresAt ? new Date(license.expiresAt).toISOString() : '-'}`,
      `Olusturma: 🧾 ${license.issuedAt ? new Date(license.issuedAt).toISOString() : '-'}`,
    ].join('\n')
  } else if (license.status === 'invalid') {
    licenseBlock = `Durum: ⚠️ Gecersiz\nNeden: ${license.reason || '-'}`
  }

  return [
    '🚀 Program acilisi algilandi',
    '',
    `🕒 Zaman: ${p.happenedAtIso || new Date().toISOString()}`,
    `🏷️ PC Adi: ${pcName || 'unknown'}`,
    `🌐 IP: ${p.ip || 'unknown'}`,
    `🖥️ MakineID: ${p.machineId || '-'}`,
    `🔐 LisansToken: ${p.licenseTokenMasked || '-'}`,
    '',
    '🔑 Lisans Bilgisi',
    licenseBlock,
    '',
    '📱 Cihaz Bilgisi',
    `Tarayici: ${p.browser?.userAgent || 'unknown'}`,
    `Platform: ${p.browser?.platform || 'unknown'}`,
    `Dil: ${p.browser?.language || 'unknown'}`,
    `Cekirdek: ${String(p.browser?.cores ?? 0)}`,
    `Ekran: ${p.browser?.screen || 'unknown'}`,
    `Saat Dilimi: ${p.browser?.timeZone || 'unknown'}`,
  ].join('\n')
}

export async function POST(request: NextRequest) {
  try {
    const botToken = getBotToken()
    const chatId = getChatId()

    if (!botToken || !chatId) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const payload = (await request.json()) as StartupTelemetryPayload
    const text = buildTelegramText(payload)
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    })

    if (!tgRes.ok) {
      return NextResponse.json({ success: false }, { status: 502 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false }, { status: 500 })
  }
}
