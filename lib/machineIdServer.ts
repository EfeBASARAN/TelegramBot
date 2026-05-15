import { execSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import fsPromises from 'fs/promises'
import os from 'os'
import path from 'path'
import { DATA_DIR } from '@/lib/dataFiles'

const MACHINE_ID_FILE = path.join(DATA_DIR, 'machine-id.json')

/** Sanal ağ kartı MAC önekleri (VPN/VM/Hyper-V) — fiziksel kartlara öncelik verilir. */
const VIRTUAL_MAC_PREFIXES = [
  '00:05:69',
  '00:0c:29',
  '00:1c:14',
  '00:50:56',
  '00:15:5d',
  '08:00:27',
  '52:54:00',
]

const MACHINE_ID_VERSION = 2

interface MachineIdFile {
  id: string
  version?: number
}

function isValidMachineId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{64}$/i.test(id)
}

function isVirtualMac(mac: string): boolean {
  const norm = mac.toLowerCase()
  return VIRTUAL_MAC_PREFIXES.some((p) => norm.startsWith(p))
}

/** Fiziksel ağ arayüzlerinin MAC adresleri (sıralı, tekrarsız). */
function collectPhysicalMacAddresses(): string[] {
  const macs = new Set<string>()
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue
    for (const cfg of iface) {
      const mac = cfg.mac?.toLowerCase()
      if (!mac || mac === '00:00:00:00:00:00' || isVirtualMac(mac)) continue
      macs.add(mac)
    }
  }
  return [...macs].sort()
}

function readTextFileSync(filePath: string): string | null {
  try {
    const text = fs.readFileSync(filePath, 'utf8').trim()
    return text || null
  } catch {
    return null
  }
}

function getWindowsMachineGuid(): string | null {
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8000,
    })
    const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)
    return match?.[1]?.trim().toLowerCase() || null
  } catch {
    return null
  }
}

function getLinuxMachineId(): string | null {
  return (
    readTextFileSync('/etc/machine-id') ||
    readTextFileSync('/var/lib/dbus/machine-id')
  )
}

function getMacPlatformUuid(): string | null {
  try {
    const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
      encoding: 'utf8',
      timeout: 8000,
    })
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
    return match?.[1]?.trim().toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * İşletim sisteminin donanıma bağlı sabit kimliği (tarayıcı / kullanıcı profili yok).
 */
function getPlatformHardwareId(): string | null {
  const platform = os.platform()
  if (platform === 'win32') return getWindowsMachineGuid()
  if (platform === 'linux') return getLinuxMachineId()
  if (platform === 'darwin') return getMacPlatformUuid()
  return null
}

/**
 * Fiziksel bilgisayardan toplanan sinyallerin hash'i.
 * Chrome / Edge / Firefox aynı kodu görür.
 */
export function computePhysicalMachineId(): string {
  const parts: string[] = []

  const hwId = getPlatformHardwareId()
  if (hwId) parts.push(`platform:${hwId}`)

  const macs = collectPhysicalMacAddresses()
  if (macs.length > 0) parts.push(`mac:${macs.join(',')}`)

  const cpuModel = os.cpus()[0]?.model?.trim()
  if (cpuModel) parts.push(`cpu:${cpuModel}`)

  parts.push(`arch:${os.arch()}`)

  if (parts.length === 1 && parts[0] === `arch:${os.arch()}`) {
    throw new Error('Fiziksel makine kimliği okunamadı')
  }

  return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex').toLowerCase()
}

async function readStoredMachineId(): Promise<string | null> {
  try {
    const raw = await fsPromises.readFile(MACHINE_ID_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as MachineIdFile
    if (isValidMachineId(parsed.id) && parsed.version === MACHINE_ID_VERSION) {
      return parsed.id.toLowerCase()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  return null
}

async function writeMachineId(id: string): Promise<void> {
  await fsPromises.mkdir(DATA_DIR, { recursive: true })
  const payload: MachineIdFile = { id, version: MACHINE_ID_VERSION }
  const content = JSON.stringify(payload, null, 2)
  // Windows: tmp+rename eşzamanlı isteklerde ENOENT verebiliyor; doğrudan yaz.
  await fsPromises.writeFile(MACHINE_ID_FILE, content, 'utf-8')
}

let createChain: Promise<string> = Promise.resolve('')

export async function getOrCreateMachineId(): Promise<string> {
  const existing = await readStoredMachineId()
  if (existing) return existing

  createChain = createChain.then(async () => {
    const again = await readStoredMachineId()
    if (again) return again
    const id = computePhysicalMachineId()
    await writeMachineId(id)
    return id
  })

  return createChain
}
