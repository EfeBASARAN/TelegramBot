/**
 * Makine kodu sunucuda fiziksel bilgisayardan üretilir (data/machine-id.json).
 * Oturum boyunca bir kez okunur; periyodik lisans kontrollerinde tekrar istek atılmaz.
 */
let cachedMachineId: string | null = null
let loadPromise: Promise<string> | null = null

async function fetchMachineIdFromApi(): Promise<string> {
  const res = await fetch('/api/machine-id', { cache: 'no-store' })
  if (!res.ok) return ''
  const json = (await res.json()) as { machineId?: string }
  const id = json.machineId?.trim().toLowerCase() || ''
  return /^[a-f0-9]{64}$/.test(id) ? id : ''
}

export async function getMachineId(): Promise<string> {
  if (typeof window === 'undefined') return ''
  if (cachedMachineId) return cachedMachineId
  if (!loadPromise) {
    loadPromise = fetchMachineIdFromApi().then((id) => {
      if (id) cachedMachineId = id
      return id
    })
  }
  return loadPromise
}
