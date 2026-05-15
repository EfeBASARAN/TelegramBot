import fs from 'fs/promises'
import path from 'path'

export const DATA_DIR = path.join(process.cwd(), 'data')

export const DATA_FILE_NAMES = {
  accounts: 'accounts.json',
  messageTemplates: 'message-templates.json',
  scheduledMessages: 'scheduled-messages.json',
  apiConfig: 'api-config.json',
  errorLogs: 'error-logs.json',
  license: 'license.json',
} as const

export interface StoredLicenseFile {
  token: string | null
}

export type DataFileKey = keyof typeof DATA_FILE_NAMES

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function readJsonFile<T>(key: DataFileKey, defaultValue: T): Promise<T> {
  await ensureDataDir()
  const filePath = path.join(DATA_DIR, DATA_FILE_NAMES[key])
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return defaultValue
    throw error
  }
}

export async function writeJsonFile<T>(key: DataFileKey, data: T): Promise<void> {
  await ensureDataDir()
  const filePath = path.join(DATA_DIR, DATA_FILE_NAMES[key])
  const content = JSON.stringify(data, null, 2)
  if (process.platform === 'win32') {
    await fs.writeFile(filePath, content, 'utf-8')
    return
  }
  const tmpPath = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, content, 'utf-8')
  await fs.rename(tmpPath, filePath)
}
