/**
 * Ham Telegram / GramJS hata metinlerini arayüzde gösterilecek Türkçe metne çevirir.
 */

export type TelegramErrorContext = 'participants' | 'general'

export function formatUserFacingTelegramError(
  raw: string,
  context: TelegramErrorContext = 'general'
): string {
  const s = raw.toLowerCase()

  if (s.includes('chat_admin_required')) {
    if (context === 'participants') {
      return (
        'Üye listesini görmek için bu grupta veya kanalda yönetici olmanız gerekir. ' +
        'Telegram (channels.getParticipants) bu listeyi yalnızca yetkili hesaplara verir; ' +
        'yayın kanallarında üye listesi genelde kapalıdır.'
      )
    }
    return 'Bu işlem için sohbette yönetici veya yeterli yetki gerekir.'
  }

  if (s.includes('channel_private') || s.includes('channel private')) {
    return 'Bu kanal veya grup özel; erişim yok veya üye değilsiniz.'
  }

  return raw.trim() || 'Bilinmeyen hata'
}
