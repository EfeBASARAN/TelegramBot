import { LICENSE_PUBLIC_KEY_SPKI_BASE64 } from './licensePublicKey'
import { LICENSE_PAYLOAD_VERSION } from './licenseConstants'

export interface LicensePayload {
  machineId: string
  expiresAt: number
  issuedAt: number
}

export function parsePayloadLine(line: string): LicensePayload | null {
  const parts = line.split('|')
  if (parts.length !== 4 || parts[0] !== LICENSE_PAYLOAD_VERSION) return null
  const [, machineId, expS, iatS] = parts
  const expiresAt = Number(expS)
  const issuedAt = Number(iatS)
  if (!machineId || !Number.isFinite(expiresAt) || !Number.isFinite(issuedAt)) return null
  return { machineId, expiresAt, issuedAt }
}

/** licenseToken: base64url(JSON.stringify({ p: payloadLine, s: signatureBase64 })) */
export async function verifyLicenseToken(
  licenseToken: string,
  currentMachineId: string
): Promise<{ ok: true; payload: LicensePayload } | { ok: false; reason: string }> {
  const spkiB64 = LICENSE_PUBLIC_KEY_SPKI_BASE64
  if (!spkiB64) {
    return { ok: false, reason: 'Lisans genel anahtarı eksik. Yazılım paketi eksik olabilir.' }
  }

  let json: { p: string; s: string }
  try {
    const raw = decodeBase64Url(licenseToken.trim())
    json = JSON.parse(raw) as { p: string; s: string }
  } catch {
    return { ok: false, reason: 'Lisans metni okunamadı. Kopyalayı yapıştırmayı kontrol edin.' }
  }

  if (!json.p || !json.s) {
    return { ok: false, reason: 'Lisans formatı geçersiz.' }
  }

  const payloadBytes = new TextEncoder().encode(json.p)
  let sigBytes: Uint8Array
  try {
    sigBytes = Uint8Array.from(atob(json.s), (c) => c.charCodeAt(0))
  } catch {
    return { ok: false, reason: 'İmza verisi bozuk.' }
  }

  const spki = Uint8Array.from(atob(spkiB64), (c) => c.charCodeAt(0))
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'spki',
      spki as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify']
    )
  } catch {
    return { ok: false, reason: 'Genel anahtar yüklenemedi.' }
  }

  const valid = await crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    sigBytes as BufferSource,
    payloadBytes as BufferSource
  )
  if (!valid) {
    return { ok: false, reason: 'İmza doğrulanamadı. Lisans sahte veya bozuk.' }
  }

  const payload = parsePayloadLine(json.p)
  if (!payload) {
    return { ok: false, reason: 'Lisans içeriği geçersiz.' }
  }

  const now = Date.now()
  if (now >= payload.expiresAt) {
    return { ok: false, reason: 'Lisans süresi dolmuş.' }
  }

  if (payload.machineId !== currentMachineId) {
    return { ok: false, reason: 'Bu lisans bu bilgisayar için değil (makine kodu uyuşmuyor).' }
  }

  return { ok: true, payload }
}

function decodeBase64Url(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad) b64 += '='.repeat(4 - pad)
  return atob(b64)
}

