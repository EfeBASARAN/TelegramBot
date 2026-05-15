'use client'

import { Info, ExternalLink, Users, ArrowRight, Shield } from 'lucide-react'
import { useAppStore } from '@/store/appStore'

export default function SettingsPage() {
  const setCurrentPage = useAppStore((state) => state.setCurrentPage)

  return (
    <div className="fade-in relative z-10 min-h-full max-w-3xl">
      <div className="mb-10">
        <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">API rehberi</h2>
        <p className="text-white/50 text-base font-medium leading-relaxed">
          Telegram API kimlik bilgileri (API ID ve API Hash), hesap doğrulaması ve mesaj gönderimi için gereklidir.
          Bu bilgileri bu sayfada tutmuyoruz; aşağıdaki adımları okuyup{' '}
          <span className="text-white/70">Hesaplar</span> sayfasında hesap eklerken girersiniz.
        </p>
      </div>

      <div className="space-y-6">
        <div className="surface-panel rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full blur-3xl -mr-24 -mt-24" />
          <div className="flex items-start gap-4 mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl backdrop-blur-sm relative z-10">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30 flex-shrink-0 shadow-lg">
              <Info size={20} className="text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-blue-400 mb-3 text-base tracking-tight">
                API ID ve API Hash nasıl alınır?
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-white/60 leading-relaxed">
                <li>
                  <a
                    href="https://my.telegram.org/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    my.telegram.org/apps
                    <ExternalLink size={12} />
                  </a>{' '}
                  adresine gidin
                </li>
                <li>Telegram hesabınızla giriş yapın</li>
                <li>API development tools bölümüne gidin</li>
                <li>Yeni uygulama oluşturun veya mevcut uygulamayı seçin</li>
                <li>Ekranda gösterilen API ID ve API Hash değerlerini kopyalayın</li>
              </ol>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 bg-white/[0.04] border border-white/10 rounded-xl relative z-10">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/10 flex-shrink-0">
              <Shield size={20} className="text-white/70" />
            </div>
            <div className="flex-1 text-sm text-white/55 leading-relaxed">
              <p className="font-semibold text-white/80 mb-1">Nereye yazılır?</p>
              <p>
                <span className="text-white/70">Hesaplar</span> sayfasında <span className="text-white/70">Hesap Ekle</span>{' '}
                ile açılan sihirbazın ilk adımında API ID ve API Hash alanları bulunur. Telefon doğrulamasından önce bu
                değerleri girin; kayıtlı hesap bilgileri data/ klasöründeki JSON dosyalarında saklanır.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCurrentPage('accounts')}
          className="btn-primary w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 rounded-xl font-semibold text-base"
        >
          <Users size={22} />
          Hesaplar sayfasına git
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  )
}
