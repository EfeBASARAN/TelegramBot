# EB Telegram Oto Mesaj

Telegram hesaplarınızı yönetin ve zamanlanmış mesajlar gönderin.

## Özellikler

- ✅ Çoklu hesap yönetimi
- ✅ Mesaj şablonları oluşturma
- ✅ Zamanlanmış mesaj gönderme
- ✅ Telegram ban önleme ayarları
- ✅ Modern, koyu tema arayüz

## Kurulum

1. Bağımlılıkları yükleyin:
```bash
npm install
```

2. Telegram API bilgilerinizi alın:
   - https://my.telegram.org/apps adresinden API ID ve API Hash alın
   - `.env.local` dosyası oluşturun:

```env
NEXT_PUBLIC_TELEGRAM_API_ID=your_api_id
NEXT_PUBLIC_TELEGRAM_API_HASH=your_api_hash
```

3. Geliştirme sunucusunu başlatın:
```bash
npm run dev
```

4. Tarayıcınızda [http://localhost:3000](http://localhost:3000) adresini açın

## Kullanım

1. **Hesaplar**: Telegram hesaplarınızı ekleyin ve bağlayın
2. **Mesaj Şablonları**: Gönderilecek mesaj şablonlarını oluşturun
3. **Zamanlayıcı**: Mesajları zamanlayın ve otomatik gönderin

## Telegram Ban Önleme

Program, Telegram ban riskini azaltmak için şu ayarları kullanır:
- Mesajlar arası minimum 3 saniye gecikme
- Hesaplar arası minimum 5 saniye gecikme
- Her mesajdan sonra ek güvenlik gecikmesi

## Notlar

- Bu proje production için hazırlanmıştır
- Veriler sadece tarayıcı belleğinde saklanır (database yok)
- Program kapandığında veriler kaybolur
- Telegram API kullanım şartlarına uygun kullanın

