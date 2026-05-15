/**
 * Zamanlayıcı gönderim günlüğü için Türkçe özet / neden / öneri üretir.
 */

export type SchedulerErrorKind = 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other'

export function classifySchedulerError(raw: string): SchedulerErrorKind {
  const m = raw.toLowerCase()
  if (
    m.includes('rate limit') ||
    m.includes('wait of') ||
    m.includes('beklenmesi gerekiyor') ||
    m.includes('flood_wait') ||
    m.includes('too many')
  ) {
    return 'rate_limit'
  }
  if (
    m.includes('user_banned') ||
    m.includes('yasaklanmış') ||
    m.includes('chat_write_forbidden') ||
    m.includes('user_is_blocked')
  ) {
    return 'banned'
  }
  if (
    m.includes('bağlı değil') ||
    m.includes('session bilgisi bulunamadı') ||
    m.includes('yeniden bağlanılamadı') ||
    m.includes('client bulunamadı') ||
    m.includes('connection')
  ) {
    return 'connection'
  }
  if (
    m.includes('peer_id_invalid') ||
    m.includes('user_id_invalid') ||
    m.includes('kullanıcı veya grup bulunamadı') ||
    m.includes('geçersiz iç hedef')
  ) {
    return 'peer'
  }
  return 'other'
}

export function buildSchedulerErrorLogParts(
  raw: string,
  recipientLabel: string,
  technicalTarget?: string
) {
  const kind = classifySchedulerError(raw)
  const errorType: 'rate_limit' | 'banned' | 'connection' | 'peer' | 'other' = kind

  let summary = 'Gönderim başarısız'
  let hint =
    'Alıcı adını, özel liste formatını veya hesap oturumunu kontrol edin. Kayıtlar data/error-logs.json dosyasında tutulur.'

  if (kind === 'rate_limit') {
    summary = 'Çok hızlı istek (Telegram sınırı)'
    hint =
      'Telegram kısa sürede çok mesaj isteğini kabul etmedi. Mesajlar arası süreyi artırın veya bir süre bekleyip tekrar deneyin.'
  } else if (kind === 'banned') {
    summary = 'Bu sohbete yazma izni yok veya engellendiniz'
    hint =
      'Grup/kanal kuralları veya alıcı ayarları mesajı engelliyor olabilir. Farklı hesap veya alıcı ile deneyin.'
  } else if (kind === 'connection') {
    summary = 'Oturum veya bağlantı sorunu'
    hint =
      'Hesaplar sayfasından ilgili hesabın bağlı olduğundan emin olun; gerekirse yeniden giriş yapın.'
  } else if (kind === 'peer') {
    summary = 'Alıcı bulunamadı veya kimlik geçersiz'
    hint =
      'Özel listede access hash bu Telegram oturumuna ait olmalı. Mümkünse @kullanıcı ile deneyin veya ID+hash’i bu hesaptan üretin (ör. Gruplar → üyeler).'
  }

  const detailLines = [`Alıcı: ${recipientLabel}`]
  if (technicalTarget && technicalTarget !== recipientLabel) {
    detailLines.push(`Teknik hedef (aynı alıcı): ${technicalTarget}`)
  }
  detailLines.push('', 'Telegram yanıtı:', raw)
  const detail = detailLines.join('\n')

  return {
    errorType,
    summary,
    detail,
    hint,
    /** Kısa tek satır (liste / arama için) */
    message: raw.length > 220 ? `${raw.slice(0, 217)}…` : raw,
  }
}

export function buildSchedulerSuccessLogParts(
  recipientLabel: string,
  sent: number,
  total: number,
  templateName?: string,
  technicalTarget?: string
) {
  const summary = 'Mesaj alıcıya iletildi'
  const detail = [
    `Alıcı: ${recipientLabel}`,
    technicalTarget && technicalTarget !== recipientLabel
      ? `Teknik hedef: ${technicalTarget}`
      : null,
    templateName ? `Şablon: ${templateName}` : null,
    `İlerleme: ${sent} / ${total} (bu plandaki hedef gönderim sayısı)`,
  ]
    .filter(Boolean)
    .join('\n')
  const hint =
    sent >= total && total > 0
      ? 'Bu adım için plan tamamlandı; zamanlayıcı kartında durum güncellenir.'
      : 'Zamanlayıcı diğer alıcılar için devam ediyor olabilir.'

  return {
    message: `Gönderildi (${sent}/${total})`,
    summary,
    detail,
    hint,
  }
}
