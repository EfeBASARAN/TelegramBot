/**
 * Gönderim günlüğü / UI için okunabilir alıcı etiketleri.
 * telegram.ts’e bağlanmaz (istemci paketinde ağır modül yüklenmesin diye).
 */

export function memberDisplayLabel(m: {
  id: string
  firstName?: string
  lastName?: string
  username?: string
  isBot?: boolean
}): string {
  if (m.isBot) return 'Bot'
  if (m.username) return `@${m.username.replace(/^@/, '')}`
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ').trim()
  if (name) return name
  return 'İsimsiz kullanıcı'
}

/**
 * Gönderim hedefi (kullanıcı adı, @kanal veya __peer_user__:…) için kısa okunabilir etiket.
 * Ham iç hedef dizesini başlıkta göstermez.
 */
export function formatRecipientDisplayLabel(target: string): string {
  if (!target.startsWith('__peer_user__:')) {
    const u = target.replace(/^@/, '').trim()
    return u ? `@${u}` : target
  }
  const parts = target.split(':')
  const optionalUn = parts[3]
  if (optionalUn && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(optionalUn)) {
    return `@${optionalUn}`
  }
  return 'İsimsiz kullanıcı'
}
