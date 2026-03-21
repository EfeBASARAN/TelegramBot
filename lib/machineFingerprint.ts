/**
 * Tarayıcıda sabit kabul edilen sinyallerin hash'i — aynı makinede genelde aynı kalır.
 * (Tarayıcı güncellemesi / ekran çözünürlüğü değişince kod değişebilir; müşteriye not düşün.)
 */
export async function getMachineId(): Promise<string> {
  if (typeof window === 'undefined') return ''
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? 0),
    typeof navigator.platform === 'string' ? navigator.platform : '',
    typeof (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ===
    'string'
      ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData!.platform!
      : '',
  ]
  const s = parts.join('|')
  const buf = new TextEncoder().encode(s)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
