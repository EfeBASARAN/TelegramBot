/**
 * Aynı metnin tekrar tekrar gönderilmesini zorlaştırmak için görünümü koruyarak
 * boşluk / görünmez Unicode ile hafif varyasyon. Anlam ve okunurluk korunur.
 */

const URL_RE = /https?:\/\/[^\s]+/g

function splitPreservingUrls(text: string): { url: boolean; chunk: string }[] {
  const out: { url: boolean; chunk: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  const re = new RegExp(URL_RE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ url: false, chunk: text.slice(last, m.index) })
    }
    out.push({ url: true, chunk: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    out.push({ url: false, chunk: text.slice(last) })
  }
  if (out.length === 0) {
    out.push({ url: false, chunk: text })
  }
  return out
}

/** İlk kelimenin ortasına bir zero-width (görünmez) karakter — cümle başı imzası değişir. */
function fuzzFirstWord(chunk: string): string {
  const lead = chunk.match(/^\s*/)?.[0] ?? ''
  const body = chunk.slice(lead.length)
  if (body.length < 6) return chunk
  const wm = body.match(/^(\S+)/)
  if (!wm) return chunk
  const word = wm[1]
  if (word.length < 4) return chunk
  if (Math.random() > 0.5) return chunk
  const maxPos = Math.min(word.length - 1, 10)
  const pos = 2 + Math.floor(Math.random() * (maxPos - 2))
  const nw = word.slice(0, pos) + '\u200B' + word.slice(pos)
  return lead + body.replace(/^(\S+)/, nw)
}

/** Normal boşlukları bazen NBSP veya boşluk+ZWSP ile değiştirir (URL dışı). */
function fuzzSpacesAndNewlines(chunk: string): string {
  let s = chunk
  s = s.replace(/ /g, () => {
    if (Math.random() > 0.24) return ' '
    return Math.random() < 0.55 ? '\u00A0' : ' \u200B'
  })
  s = s.replace(/\n/g, () => (Math.random() < 0.12 ? '\n\u200C' : '\n'))
  return s
}

function fuzzPlainChunk(chunk: string): string {
  let t = fuzzFirstWord(chunk)
  t = fuzzSpacesAndNewlines(t)
  return t
}

function randomHead(s: string): string {
  const heads = ['\u200B', '\u200C', '\uFEFF']
  if (Math.random() < 0.62) {
    return heads[Math.floor(Math.random() * heads.length)] + s
  }
  return s
}

function randomTail(s: string): string {
  if (Math.random() > 0.58) return s
  const tails = ['\n', '\n\n', ' ', '  ', ' .', ' ..', ' ...']
  return s + tails[Math.floor(Math.random() * tails.length)]
}

function looksUrlOnly(s: string): boolean {
  const t = s.trim()
  return t.length > 8 && /^https?:\/\/\S+$/i.test(t)
}

/**
 * Her çağrıda farklı bir dize üretir; ekranda aynı metin gibi görünür.
 */
export function varyMessageAntiSpam(raw: string): string {
  if (!raw) return raw
  const text = raw.length > 60000 ? raw.slice(0, 60000) : raw

  if (looksUrlOnly(text)) {
    return text
  }

  const parts = splitPreservingUrls(text)
  let out = ''
  let firstPlain = true
  for (const p of parts) {
    if (p.url) {
      out += p.chunk
    } else {
      let chunk = fuzzPlainChunk(p.chunk)
      if (firstPlain) {
        chunk = randomHead(chunk)
        firstPlain = false
      }
      out += chunk
    }
  }

  if (!/https?:\/\/\S*$/i.test(out.trimEnd())) {
    out = randomTail(out)
  } else {
    if (Math.random() < 0.25) out += '\n'
  }
  return out
}
