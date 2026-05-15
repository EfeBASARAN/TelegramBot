/**
 * Telegram / zamanlayıcı gibi kritik işlemlerde tekrar kullanılır.
 * Sadece arayüzü kırarak (LicenseGate bypass) uygulama kullanılamasın diye.
 */
import { getLicenseToken } from '@/lib/licenseStorage'
import { getMachineId } from './machineFingerprint'
import { verifyLicenseToken } from './licenseVerify'

export async function assertLicenseActive(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'Lisans bu ortamda doğrulanamıyor.' }
  }
  const raw = await getLicenseToken()
  if (!raw) {
    return { ok: false, reason: 'Lisans gerekli veya süresi doldu.' }
  }
  const mid = await getMachineId()
  const result = await verifyLicenseToken(raw, mid)
  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true }
}
