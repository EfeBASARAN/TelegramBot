import { NextResponse } from 'next/server'
import { getOrCreateMachineId } from '@/lib/machineIdServer'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const machineId = await getOrCreateMachineId()
    return NextResponse.json({ machineId })
  } catch (error) {
    console.error('Makine kodu üretilemedi:', error)
    return NextResponse.json({ error: 'Makine kodu alınamadı' }, { status: 500 })
  }
}
