'use client'

import type { StoredLicenseFile } from '@/lib/dataFiles'

const EMPTY_LICENSE: StoredLicenseFile = { token: null }

let cached: StoredLicenseFile | null = null
let loadPromise: Promise<StoredLicenseFile> | null = null

async function fetchLicenseFromServer(): Promise<StoredLicenseFile> {
  const res = await fetch('/api/data?key=license')
  if (!res.ok) return { ...EMPTY_LICENSE }
  const json = (await res.json()) as { data?: unknown }
  const data = json.data
  if (typeof data === 'string') {
    return { token: data.trim() || null }
  }
  if (data && typeof data === 'object' && 'token' in data) {
    const token = (data as StoredLicenseFile).token
    return { token: typeof token === 'string' ? token.trim() || null : null }
  }
  return { ...EMPTY_LICENSE }
}

async function persistLicense(data: StoredLicenseFile): Promise<void> {
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'license', data }),
  })
  if (!res.ok) {
    throw new Error(`Lisans kaydedilemedi: ${res.status}`)
  }
}

export async function loadLicense(): Promise<StoredLicenseFile> {
  if (cached) return cached
  if (!loadPromise) {
    loadPromise = fetchLicenseFromServer().then((license) => {
      cached = license
      return license
    })
  }
  return loadPromise
}

export async function getLicenseToken(): Promise<string> {
  const license = await loadLicense()
  return license.token?.trim() || ''
}

export async function setLicenseToken(token: string): Promise<void> {
  const trimmed = token.trim()
  cached = { token: trimmed || null }
  await persistLicense(cached)
}

export async function clearLicenseToken(): Promise<void> {
  cached = { token: null }
  await persistLicense(cached)
}

export function invalidateLicenseCache(): void {
  cached = null
  loadPromise = null
}
