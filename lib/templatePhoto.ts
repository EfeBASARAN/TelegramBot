import { imageSize } from 'image-size'
import { CustomFile } from 'telegram/client/uploads'

/** Şablonda saklanan tek görsel (base64, tarayıcıda dosya seçimiyle doldurulur) */
export interface TemplatePhotoPayload {
  fileName: string
  mimeType: string
  base64: string
}

export const TEMPLATE_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

const MAX_TELEGRAM_PHOTO_BYTES = 10 * 1024 * 1024
const MAX_TELEGRAM_PHOTO_RATIO = 20
const MAX_TELEGRAM_PHOTO_EDGE_SUM = 10000

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}

/** Telegram fotoğraf limitleri (yükleme öncesi) */
export function validateTemplatePhotoBytes(
  mimeType: string,
  bytes: Uint8Array
): { ok: true } | { ok: false; error: string } {
  if (!TEMPLATE_PHOTO_MIMES.includes(mimeType as (typeof TEMPLATE_PHOTO_MIMES)[number])) {
    return {
      ok: false,
      error: 'Sadece JPG, PNG veya WEBP yükleyin.',
    }
  }
  if (bytes.byteLength > MAX_TELEGRAM_PHOTO_BYTES) {
    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(2)
    return { ok: false, error: `Fotoğraf ${mb}MB. Telegram en fazla 10MB kabul eder.` }
  }

  const dim = imageSize(bytes)
  const width = dim.width || 0
  const height = dim.height || 0
  if (!width || !height) {
    return { ok: false, error: 'Görsel boyutları okunamadı. Başka bir dosya deneyin.' }
  }
  const bigger = Math.max(width, height)
  const smaller = Math.max(1, Math.min(width, height))
  const ratio = bigger / smaller
  if (ratio > MAX_TELEGRAM_PHOTO_RATIO) {
    return {
      ok: false,
      error: `Fotoğraf en-boy oranı çok uç (${ratio.toFixed(2)}). En fazla 20:1 olmalı.`,
    }
  }
  if (width + height > MAX_TELEGRAM_PHOTO_EDGE_SUM) {
    return {
      ok: false,
      error: `Fotoğraf çok büyük (${width}×${height}). Genişlik+yükseklik en fazla 10000 olmalı.`,
    }
  }
  return { ok: true }
}

export function validateTemplatePhotoPayload(
  photo: TemplatePhotoPayload
): { ok: true } | { ok: false; error: string } {
  if (!photo.base64?.trim() || !photo.mimeType) {
    return { ok: false, error: 'Görsel verisi eksik.' }
  }
  return validateTemplatePhotoBytes(photo.mimeType, base64ToUint8Array(photo.base64))
}

/** Görüntüleme / gönderim için veri URL */
export function templatePhotoDataUrl(photo: TemplatePhotoPayload): string {
  return `data:${photo.mimeType};base64,${photo.base64}`
}

/**
 * GramJS yüklemesi: tarayıcı `File` objesi kütüphanede hata verir (getInputMedia dalı);
 * resmi belleğe alıp `CustomFile` + Buffer kullanmak gerekir.
 */
export function templatePhotoToCustomFile(photo: TemplatePhotoPayload): CustomFile {
  const buf = Buffer.from(photo.base64, 'base64')
  const name = photo.fileName?.trim() || 'gorsel.jpg'
  return new CustomFile(name, buf.length, '', buf)
}
