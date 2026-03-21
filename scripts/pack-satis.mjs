/**
 * `npm run satis` ile çağrılır — müşteri paketini `Satis/` klasörüne yazar.
 */
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const satis = join(root, 'Satis')
const standalone = join(root, '.next', 'standalone')
const staticSrc = join(root, '.next', 'static')
const publicSrc = join(root, 'public')

if (!existsSync(standalone)) {
  console.error('Önce: npm run build')
  process.exit(1)
}

if (existsSync(satis)) rmSync(satis, { recursive: true })
mkdirSync(satis, { recursive: true })

cpSync(standalone, satis, { recursive: true })

const staticDest = join(satis, '.next', 'static')
mkdirSync(join(satis, '.next'), { recursive: true })
cpSync(staticSrc, staticDest, { recursive: true })

if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(satis, 'public'), { recursive: true })
}

const oku = `================================================================================
EB TELEGRAM OTO MESAJ — ÇALIŞTIRMA
================================================================================

1) Bilgisayarınıza Node.js kurun (LTS sürümü önerilir): https://nodejs.org

2) Bu klasörü istediğiniz yere çıkarın (ZIP/RAR açılmış hali).

3) EN KOLAY:  CALISTIR.bat  dosyasına çift tıklayın.
   (Komut satırı açılır; "Ready" yazınca tarayıcıda http://localhost:3000 açın.
   Bu pencereyi kapatmayın.)

4) Tarayıcıda adres:  http://localhost:3000

5) İlk açılışta "Lisans gerekli" ekranı gelir. Satıcının verdiği TEK SATIR
   lisans anahtarını yapıştırıp "Etkinleştir" deyin. Makine kodunuzu satıcıya
   göndermeniz istenebilir.

6) İleri düzey: aynı klasörde "node server.js" yazarak da başlatabilirsiniz.

================================================================================
Sorun olursa satıcıyla iletişime geçin.
================================================================================
`
writeFileSync(join(satis, 'OKU.txt'), oku, 'utf8')

const bat = `@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title EB Telegram Oto Mesaj
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [HATA] Node.js bulunamadi.
  echo Once su adresten LTS surumunu kurun: https://nodejs.org
  echo.
  pause
  exit /b 1
)
echo.
echo  EB Telegram Oto Mesaj - sunucu basliyor...
echo  Adres: http://localhost:3000
echo  Bu pencereyi KAPATMAYIN; kapatirsaniz program durur.
echo  Asagida "Ready" gorunce tarayicida adresi acin (otomatik acilmaz).
echo.
node server.js
echo.
echo  Sunucu durdu.
pause
`
writeFileSync(join(satis, 'CALISTIR.bat'), bat, 'utf8')

console.log('Tamam: Satis/ hazır. Bu klasörü RAR/ZIP yapıp müşteriye gönderin.')
