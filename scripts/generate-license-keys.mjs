/**
 * Bir kez çalıştır: özel anahtar (scripts/license-private.pem, gitignore) +
 * uygulamaya gömülecek genel anahtar (lib/licensePublicKey.ts).
 */
import { generateKeyPairSync } from 'crypto'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const pubSpkiDer = publicKey.export({ type: 'spki', format: 'der' })
const pubB64 = Buffer.from(pubSpkiDer).toString('base64')

const privPath = join(__dirname, 'license-private.pem')
const pubTsPath = join(root, 'lib', 'licensePublicKey.ts')

writeFileSync(privPath, privPem, 'utf8')
writeFileSync(
  pubTsPath,
  `/** OTOMATIK — scripts/generate-license-keys.mjs (yeniden üretme: tüm eski lisanslar geçersiz olur) */
export const LICENSE_PUBLIC_KEY_SPKI_BASE64 = '${pubB64}'
`,
  'utf8'
)

console.log('Tamam.')
console.log('  Özel anahtar:', privPath, '(ASLA paylaşma / repoya ekleme)')
console.log('  Genel anahtar:', pubTsPath)
console.log('Sonraki: npm run build — müşteriye sadece build çıktısı + senin ürettiğin lisans')
