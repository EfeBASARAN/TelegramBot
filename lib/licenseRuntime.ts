/**
 * Telegram / zamanlayıcı gibi kritik işlemlerde tekrar kullanılır.
 * Sadece arayüzü kırarak (LicenseGate bypass) uygulama kullanılamasın diye.
 */
import { LICENSE_STORAGE_KEY } from './licenseConstants'
import { getMachineId } from './machineFingerprint'
import { verifyLicenseToken } from './licenseVerify'

export async function assertLicenseActive(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'Lisans bu ortamda doğrulanamıyor.' }
  }
  const raw = localStorage.getItem(LICENSE_STORAGE_KEY)
  if (!raw?.trim()) {
    return { ok: false, reason: 'Lisans gerekli veya süresi doldu.' }
  }
  const mid = await getMachineId()
  const result = await verifyLicenseToken(raw.trim(), mid)
  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true }
}
