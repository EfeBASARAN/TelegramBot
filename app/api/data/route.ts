import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import {
  DATA_FILE_NAMES,
  type DataFileKey,
  readJsonFile,
  writeJsonFile,
} from '@/lib/dataFiles'

const VALID_KEYS = new Set<string>(Object.keys(DATA_FILE_NAMES))

function isValidKey(key: string): key is DataFileKey {
  return VALID_KEYS.has(key)
}

const DEFAULTS: Record<DataFileKey, unknown> = {
  accounts: [],
  messageTemplates: [],
  scheduledMessages: [],
  apiConfig: null,
  errorLogs: [],
  license: { token: null },
}

export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key')
    if (key) {
      if (!isValidKey(key)) {
        return NextResponse.json({ error: 'Geçersiz anahtar' }, { status: 400 })
      }
      const data = await readJsonFile(key, DEFAULTS[key])
      return NextResponse.json({ key, data })
    }

    const entries = await Promise.all(
      (Object.keys(DATA_FILE_NAMES) as DataFileKey[]).map(async (k) => {
        const data = await readJsonFile(k, DEFAULTS[k])
        return [k, data] as const
      })
    )
    return NextResponse.json({ data: Object.fromEntries(entries) })
  } catch (error) {
    console.error('Veri okunamadı:', error)
    return NextResponse.json({ error: 'Veri okunamadı' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { key?: string; data?: unknown }
    const { key, data } = body
    if (!key || !isValidKey(key)) {
      return NextResponse.json({ error: 'Geçersiz anahtar' }, { status: 400 })
    }
    await writeJsonFile(key, data ?? DEFAULTS[key])
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Veri yazılamadı:', error)
    return NextResponse.json({ error: 'Veri yazılamadı' }, { status: 500 })
  }
}
