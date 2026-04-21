/**
 * Lisans üretir (satıcının PC’de). Müşterinin verdiği makine kodu + süre (varsayılan 3 dk).
 * Kullanım:
 *   node scripts/issue-license.mjs --machine-id <64 hex> [--minutes 3]
 *   node scripts/issue-license.mjs <64 hex> [dakika]
 * (Windows’ta `npm run license:issue -- --machine-id ...` bazen bayrakları iletmez;
 *    o zaman ikinci satır veya: npm run license:issue -- KOD DAKIKA)
 */
import { createPrivateKey, sign } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs() {
  const a = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--machine-id' && a[i + 1]) {
      out.machineId = a[++i]
    } else if (a[i] === '--minutes' && a[i + 1]) {
      out.minutes = Number(a[++i])
    }
  }
  // Windows / npm: `--machine-id` ve `--minutes` bazen script'e hiç gelmez; sadece hex ve sayı kalır.
  if (!out.machineId) {
    const idx = a.findIndex((x) => /^[a-f0-9]{64}$/i.test(String(x).trim()))
    if (idx >= 0) {
      out.machineId = String(a[idx]).trim().toLowerCase()
      const next = a[idx + 1]
      if (next !== undefined && /^\d+$/.test(String(next).trim())) {
        out.minutes = Number(String(next).trim())
      }
    }
  }
  return out
}

const { machineId, minutes } = parseArgs()
const mins = Number.isFinite(minutes) && minutes > 0 ? minutes : 3

if (!machineId || !/^[a-f0-9]{64}$/i.test(machineId)) {
  const a = process.argv.slice(2)
  for (const x of a) {
    const raw = String(x).trim()
    if (!/^[a-f0-9]+$/i.test(raw) || raw.length <= 64) continue
    const mEnd = raw.match(/^([a-f0-9]{64})(\d+)$/i)
    if (mEnd) {
      console.error('Hata: Makine kodunun sonuna dakika yapışmış (tek parça yapıştırılmış).')
      console.error('  Doğru: iki ayrı argüman — önce 64 hex, sonra dakika (arada boşluk).')
      console.error('  Örnek: npm run license:issue -- ' + mEnd[1] + ' ' + mEnd[2])
      process.exit(1)
    }
  }
  const almost = a.find((x) => /^[a-f0-9]+$/i.test(String(x).trim()))
  if (almost && String(almost).trim().length !== 64) {
    console.error(
      'Hata: Makine kodu tam 64 hex karakter olmalı (şu an ' + String(almost).trim().length + ' karakter).'
    )
    console.error('  Uygulamadan makine kodunu tek başına kopyalayın; sonda ekstra rakam/harf olmasın.')
  }
  console.error('Kullanım:')
  console.error('  node scripts/issue-license.mjs --machine-id <64 hex> [--minutes 3]')
  console.error('  node scripts/issue-license.mjs <64 hex> [dakika]')
  console.error('  npm run license:issue -- <64 hex> [dakika]   (Windows’ta genelde bu en sorunsuz)')
  console.error('Makine kodu uygulama ekranından kopyalanır.')
  process.exit(1)
}

const privPath = join(__dirname, 'license-private.pem')
if (!existsSync(privPath)) {
  console.error('Önce: npm run license:keys')
  process.exit(1)
}

const privPem = readFileSync(privPath, 'utf8')
const privateKey = createPrivateKey(privPem)

const issuedAt = Date.now()
const expiresAt = issuedAt + mins * 60 * 1000
const mid = machineId.toLowerCase()
const payload = `v1|${mid}|${expiresAt}|${issuedAt}`

const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)
const obj = {
  p: payload,
  s: sig.toString('base64'),
}
const json = JSON.stringify(obj)
const token = toBase64Url(json)

function toBase64Url(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

console.log('')
console.log('--- LİSANS ANAHTARI (tek satır, müşteriye gönder) ---')
console.log(token)
console.log('')
console.log('Bitiş (UTC):', new Date(expiresAt).toISOString())
console.log('Süre (dk):', mins)
