'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Power, PowerOff, Phone, Eye, EyeOff, FileSpreadsheet, UserMinus } from 'lucide-react'
import { useAppStore, TelegramAccount } from '@/store/appStore'
import { exportRowsToExcel, sanitizeExcelFilename } from '@/lib/excelExport'
import { telegramManager } from '@/lib/telegram'
import { reportActivityToTelegram } from '@/lib/activityTelemetry'

export default function AccountsPage() {
  const accounts = useAppStore((state) => state.accounts)
  const apiConfig = useAppStore((state) => state.apiConfig)
  const addAccount = useAppStore((state) => state.addAccount)
  const removeAccount = useAppStore((state) => state.removeAccount)
  const updateAccount = useAppStore((state) => state.updateAccount)
  const setCurrentPage = useAppStore((state) => state.setCurrentPage)
  const isLoaded = useAppStore((state) => state.isLoaded)
  const pushToast = useAppStore((state) => state.pushToast)

  // Sayfa yüklendiğinde, session string'i olan hesapları otomatik bağla
  useEffect(() => {
    if (isLoaded) {
      const autoConnectAccounts = async () => {
        for (const account of accounts) {
          // Session string varsa ve bağlı değilse otomatik bağlan
          if (account.sessionString && !account.isConnected) {
            try {
              // Hesap için API bilgilerini ayarla
              if (account.apiId && account.apiHash) {
                telegramManager.setApiConfig(account.apiId, account.apiHash)
              } else if (apiConfig) {
                // Fallback: global API config kullan
                telegramManager.setApiConfig(apiConfig.apiId, apiConfig.apiHash)
              } else {
                // API bilgisi yoksa atla
                continue
              }

              const result = await telegramManager.connectAccount(
                account.id,
                account.phoneNumber,
                account.sessionString
              )

              if (result.success && result.sessionString) {
                updateAccount(account.id, {
                  isConnected: true,
                  sessionString: result.sessionString,
                })

                const accountInfo = await telegramManager.getAccountInfo(account.id)
                if (accountInfo) {
                  updateAccount(account.id, {
                    firstName: accountInfo.firstName,
                    lastName: accountInfo.lastName,
                    username: accountInfo.username,
                  })
                }
              }
            } catch (error) {
              // Sessizce hata yok say - kullanıcı manuel bağlanabilir
              console.error('Otomatik bağlantı hatası:', error)
            }
          }
        }
      }
      
      autoConnectAccounts()
    }
  }, [isLoaded, accounts.length])

  const [showAddModal, setShowAddModal] = useState(false)
  const [apiId, setApiId] = useState('')
  const [apiHash, setApiHash] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectingAccountId, setConnectingAccountId] = useState<string | null>(null)
  const [connectionStep, setConnectionStep] = useState<'api' | 'phone' | 'code' | 'password'>('api')
  const [tempAccountId, setTempAccountId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [visiblePhones, setVisiblePhones] = useState<Set<string>>(new Set())
  const [showInputApiId, setShowInputApiId] = useState(false)
  const [showInputApiHash, setShowInputApiHash] = useState(false)
  const [leavingAllGroupsId, setLeavingAllGroupsId] = useState<string | null>(null)

  const logActivity = (message: string, detail?: string, level: 'info' | 'ok' | 'warn' | 'err' | 'step' = 'info') => {
    void reportActivityToTelegram({
      type: 'action_log',
      level,
      message,
      detail,
      happenedAtIso: new Date().toISOString(),
    })
  }

  const resetModal = () => {
    setApiId('')
    setApiHash('')
    setPhoneNumber('')
    setCode('')
    setPassword('')
    setConnectionStep('api')
    setTempAccountId(null)
    setErrorMessage('')
    setShowAddModal(false)
  }

  const handleSendCode = async () => {
    logActivity('Hesap ekleme: kod gonder adimi', `Telefon: ${phoneNumber.trim() || '-'}`, 'step')
    if (!phoneNumber.trim()) {
      setErrorMessage('Lütfen telefon numaranızı girin')
      return
    }

    if (!apiId.trim() || !apiHash.trim()) {
      setErrorMessage('Lütfen API ID ve API Hash girin')
      return
    }

    setIsConnecting(true)
    setErrorMessage('')
    setCode('') // Eski kodu temizle

    try {
      // Eğer tempAccountId yoksa yeni oluştur
      if (!tempAccountId) {
        const tempId = Date.now().toString()
        setTempAccountId(tempId)
      }

      // Hesap için API bilgilerini ayarla
      telegramManager.setApiConfig(apiId.trim(), apiHash.trim())

      // Yeni kod iste - bu yeni phoneCodeHash oluşturacak
      const result = await telegramManager.requestCode(
        tempAccountId || Date.now().toString(),
        phoneNumber.trim()
      )

      if (result.success) {
        logActivity('Kod gonderildi', `Telefon: ${phoneNumber.trim()}`, 'ok')
        setConnectionStep('code')
      } else if (result.error) {
        logActivity('Kod gonderme hatasi', result.error, 'warn')
        setErrorMessage(result.error)
        if (result.error.includes('FLOOD') || result.error.includes('flood')) {
          setErrorMessage('Çok fazla kod isteği. Lütfen birkaç dakika bekleyin.')
        }
      }
    } catch (error: any) {
      logActivity('Kod gonderme exception', error.message || 'Bilinmeyen hata', 'err')
      setErrorMessage('Hata: ' + error.message)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleVerifyCode = async () => {
    logActivity('Hesap ekleme: kod dogrulama denemesi', `Telefon: ${phoneNumber.trim() || '-'}`, 'step')
    // Kodu temizle - sadece rakamları al
    const cleanCode = code.replace(/\D/g, '')
    
    if (!cleanCode) {
      setErrorMessage('Lütfen kodu girin')
      return
    }

    if (cleanCode.length < 5) {
      setErrorMessage('Kod 5 haneli olmalıdır')
      return
    }

    if (!tempAccountId) {
      setErrorMessage('Bir hata oluştu. Lütfen tekrar deneyin.')
      return
    }

    setIsConnecting(true)
    setErrorMessage('')

    try {
      // Hesap için API bilgilerini ayarla
      if (apiId.trim() && apiHash.trim()) {
        telegramManager.setApiConfig(apiId.trim(), apiHash.trim())
      }

      const result = await telegramManager.connectAccount(
        tempAccountId,
        phoneNumber.trim(),
        undefined,
        cleanCode
      )

      if (result.error?.includes('EXPIRED') || result.error?.includes('expired')) {
        logActivity('Kod suresi doldu', phoneNumber.trim(), 'warn')
        setErrorMessage('Kod süresi dolmuş. Lütfen yeni kod isteyin.')
        setConnectionStep('phone')
        setCode('')
        return
      }

      // PHONE_CODE_INVALID hatası - kullanıcıyı kod adımına geri döndür
      if (result.error?.includes('PHONE_CODE_INVALID') || result.error?.includes('INVALID')) {
        logActivity('Kod gecersiz', phoneNumber.trim(), 'warn')
        setErrorMessage('Geçersiz kod. Lütfen doğru kodu girin veya yeni kod isteyin.')
        setConnectionStep('code')
        setCode('')
        setIsConnecting(false)
        return
      }
      
      if (result.requiresPassword) {
        logActivity('2FA sifresi gerekli', phoneNumber.trim(), 'info')
        setConnectionStep('password')
        setCode('') // Kod adımından çıkarken kodu temizle
      } else if (result.success && result.sessionString) {
        // Başarılı - hesabı kaydet veya güncelle
        const existingAccount = accounts.find((acc) => acc.id === tempAccountId)
        
        if (existingAccount) {
          // Mevcut hesabı güncelle
          updateAccount(tempAccountId, {
            isConnected: true,
            sessionString: result.sessionString,
            apiId: apiId.trim(),
            apiHash: apiHash.trim(),
          })
        } else {
          // Yeni hesap ekle
          const newAccount: TelegramAccount = {
            id: tempAccountId,
            phoneNumber: phoneNumber.trim(),
            apiId: apiId.trim(),
            apiHash: apiHash.trim(),
            isConnected: true,
            sessionString: result.sessionString,
          }
          addAccount(newAccount)
          logActivity('Yeni hesap eklendi', `Telefon: ${phoneNumber.trim()}`, 'ok')
        }

        // Hesap bilgilerini al
        const accountInfo = await telegramManager.getAccountInfo(tempAccountId)
        if (accountInfo) {
          updateAccount(tempAccountId, {
            firstName: accountInfo.firstName,
            lastName: accountInfo.lastName,
            username: accountInfo.username,
          })
        }

        resetModal()
      } else {
        logActivity('Kod dogrulama basarisiz', result.error || '-', 'warn')
        setErrorMessage(result.error || 'Kod doğrulama başarısız')
      }
    } catch (error: any) {
      logActivity('Kod dogrulama exception', error.message || 'Bilinmeyen hata', 'err')
      setErrorMessage('Hata: ' + error.message)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleVerifyPassword = async () => {
    logActivity('Hesap ekleme: 2FA dogrulama denemesi', `Telefon: ${phoneNumber.trim() || '-'}`, 'step')
    if (!password.trim()) {
      setErrorMessage('Lütfen şifrenizi girin')
      return
    }

    if (!tempAccountId) {
      setErrorMessage('Bir hata oluştu. Lütfen tekrar deneyin.')
      return
    }

    setIsConnecting(true)
    setErrorMessage('')

    try {
      // Hesap için API bilgilerini ayarla
      if (apiId.trim() && apiHash.trim()) {
        telegramManager.setApiConfig(apiId.trim(), apiHash.trim())
      }

      const result = await telegramManager.connectAccount(
        tempAccountId,
        phoneNumber.trim(),
        undefined,
        code.trim(),
        password.trim()
      )

      // PHONE_CODE_INVALID hatası - kullanıcıyı kod adımına geri döndür
      if (result.error?.includes('PHONE_CODE_INVALID') || result.error?.includes('INVALID')) {
        logActivity('2FA adiminda kod gecersiz', phoneNumber.trim(), 'warn')
        setErrorMessage('Geçersiz kod. Lütfen doğru kodu girin veya yeni kod isteyin.')
        setConnectionStep('code')
        setCode('')
        setPassword('')
        setIsConnecting(false)
        return
      }

      if (result.success && result.sessionString) {
        // Başarılı - hesabı kaydet veya güncelle
        const existingAccount = accounts.find((acc) => acc.id === tempAccountId)
        
        if (existingAccount) {
          // Mevcut hesabı güncelle
          updateAccount(tempAccountId, {
            isConnected: true,
            sessionString: result.sessionString,
            apiId: apiId.trim(),
            apiHash: apiHash.trim(),
          })
        } else {
          // Yeni hesap ekle
          const newAccount: TelegramAccount = {
            id: tempAccountId,
            phoneNumber: phoneNumber.trim(),
            apiId: apiId.trim(),
            apiHash: apiHash.trim(),
            isConnected: true,
            sessionString: result.sessionString,
          }
          addAccount(newAccount)
          logActivity('Yeni hesap eklendi (2FA)', `Telefon: ${phoneNumber.trim()}`, 'ok')
        }

        // Hesap bilgilerini al
        const accountInfo = await telegramManager.getAccountInfo(tempAccountId)
        if (accountInfo) {
          updateAccount(tempAccountId, {
            firstName: accountInfo.firstName,
            lastName: accountInfo.lastName,
            username: accountInfo.username,
          })
        }

        resetModal()
      } else {
        logActivity('2FA dogrulama basarisiz', result.error || '-', 'warn')
        setErrorMessage(result.error || 'Şifre doğrulama başarısız')
      }
    } catch (error: any) {
      logActivity('2FA dogrulama exception', error.message || 'Bilinmeyen hata', 'err')
      setErrorMessage('Hata: ' + error.message)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleConnect = async (account: TelegramAccount) => {
    // Eğer session string varsa direkt bağlan, yoksa yeni hesap ekleme akışını kullan
    if (account.sessionString) {
      setConnectingAccountId(account.id)
      setIsConnecting(true)

      try {
        // Hesap için API bilgilerini ayarla
        if (account.apiId && account.apiHash) {
          telegramManager.setApiConfig(account.apiId, account.apiHash)
        } else if (apiConfig) {
          // Fallback: global API config kullan
          telegramManager.setApiConfig(apiConfig.apiId, apiConfig.apiHash)
        }

        const result = await telegramManager.connectAccount(
          account.id,
          account.phoneNumber,
          account.sessionString
        )

        if (result.success && result.sessionString) {
          updateAccount(account.id, {
            isConnected: true,
            sessionString: result.sessionString,
          })

          const accountInfo = await telegramManager.getAccountInfo(account.id)
          if (accountInfo) {
            updateAccount(account.id, {
              firstName: accountInfo.firstName,
              lastName: accountInfo.lastName,
              username: accountInfo.username,
            })
          }
        } else {
          alert(result.error || 'Bağlantı başarısız')
        }
      } catch (error: any) {
        alert('Hata: ' + error.message)
      } finally {
        setIsConnecting(false)
        setConnectingAccountId(null)
      }
    } else {
      // Session yoksa, hesap ekleme akışını başlat
      setApiId(account.apiId || '')
      setApiHash(account.apiHash || '')
      setPhoneNumber(account.phoneNumber)
      setTempAccountId(account.id)
      setConnectionStep(account.apiId && account.apiHash ? 'code' : 'api')
      setShowAddModal(true)
    }
  }

  const handleDisconnect = async (accountId: string) => {
    await telegramManager.disconnectAccount(accountId)
    updateAccount(accountId, { isConnected: false })
    logActivity('Hesap baglantisi kesildi', `Hesap ID: ${accountId}`, 'info')
  }

  const handleLeaveAllGroups = async (account: TelegramAccount) => {
    if (
      !confirm(
        'Bu hesabın katıldığı tüm gruplar, süper gruplar ve abone olunan kanallardan çıkılacak (sohbet listesinde görünen son ~500 diyalog). Yönetici olduğunuz veya Telegram’ın izin vermediği yerlerde çıkış başarısız olabilir. Devam edilsin mi?'
      )
    ) {
      return
    }
    setLeavingAllGroupsId(account.id)
    try {
      const aid = account.apiId || apiConfig?.apiId
      const ahash = account.apiHash || apiConfig?.apiHash
      const res = await telegramManager.leaveAllJoinedGroups(
        account.id,
        account.sessionString,
        account.phoneNumber,
        aid,
        ahash
      )
      if (!res.success) {
        pushToast(res.error || 'İşlem başarısız', 'error')
        return
      }
      const left = res.leftCount ?? 0
      const failed = res.failedCount ?? 0
      if (failed > 0) {
        pushToast(`${left} yerden çıkıldı, ${failed} yerde başarısız (sahiplik / kısıt).`, 'info')
      } else {
        pushToast(`${left} gruptan/kanaldan çıkıldı.`, 'success')
      }
    } finally {
      setLeavingAllGroupsId(null)
    }
  }

  const handleDelete = async (accountId: string) => {
    if (confirm('Bu hesabı silmek istediğinize emin misiniz?')) {
      const account = accounts.find((a) => a.id === accountId)
      if (account?.isConnected) {
        await telegramManager.disconnectAccount(accountId)
      }
      removeAccount(accountId)
      logActivity('Hesap silindi', `Hesap ID: ${accountId}`, 'warn')
    }
  }

  const handleExportAccountsExcel = () => {
    if (accounts.length === 0) {
      pushToast('Dışa aktarılacak hesap yok', 'info')
      return
    }
    const rows = accounts.map((a) => ({
      Telefon: a.phoneNumber,
      Ad: a.firstName ?? '',
      Soyad: a.lastName ?? '',
      'Kullanıcı adı': a.username ? `@${a.username}` : '',
      Bağlı: a.isConnected ? 'Evet' : 'Hayır',
      'Oturum kayıtlı': a.sessionString ? 'Evet' : 'Hayır',
      'API ID': a.apiId ?? '',
    }))
    const name = `hesaplar_${sanitizeExcelFilename('ozet')}_${new Date().toISOString().slice(0, 10)}`
    if (exportRowsToExcel(rows, name, 'Hesaplar')) {
      pushToast('Hesap özeti Excel olarak indirildi (oturum ve API hash yok)', 'success')
    }
  }

  return (
    <div className="fade-in relative z-10 min-h-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Hesaplar</h2>
          <p className="text-white/50 text-base font-medium max-w-2xl">
            Telefon doğrulaması ile hesap ekleyin; oturum bilgisi bu tarayıcıda saklanır. Zamanlayıcı yalnızca
            bağlı hesaplarla gönderim yapar.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 shrink-0 w-full sm:w-auto">
          {accounts.length > 0 && (
            <button
              type="button"
              onClick={handleExportAccountsExcel}
              className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold border border-white/15 bg-white/[0.06] hover:bg-white/10 text-white/90 transition-colors"
              title="Telefon, ad ve bağlantı özeti — oturum ve API hash dahil değildir"
            >
              <FileSpreadsheet size={20} />
              Excel&apos;e aktar
            </button>
          )}
          <button
            onClick={() => {
              logActivity('Hesap Ekle butonuna basildi', 'Modal acildi', 'info')
              resetModal()
              setShowAddModal(true)
            }}
            className="btn-primary flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold"
          >
            <Plus size={20} />
            Hesap Ekle
          </button>
        </div>
      </div>


      {accounts.length === 0 ? (
        <div className="text-center py-24 surface-muted rounded-2xl shadow-2xl fade-in">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
            <Phone size={48} className="text-white/40" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">
            Kayıtlı hesap yok
          </h3>
          <p className="text-white/50 text-sm mb-8 font-medium max-w-md mx-auto">
            Hesap Ekle ile açılan sihirbazda önce API ID ve API Hash girin, ardından telefon doğrulamasını tamamlayın.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account, index) => (
            <div
              key={account.id}
              className="surface-panel rounded-2xl p-6 card-hover shadow-2xl fade-in electric-border relative overflow-hidden"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16" />
              
              <div className="flex justify-between items-start mb-5 relative z-10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/15 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
                      <Phone size={24} className="text-white/80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg truncate mb-1">
                        {account.firstName || account.phoneNumber}
                      </h3>
                      {account.username && (
                        <p className="text-sm text-white/40 truncate font-mono">
                          @{account.username}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-17">
                    <p className="text-sm text-white/30 font-mono">
                      {visiblePhones.has(account.id) 
                        ? account.phoneNumber 
                        : '•'.repeat(account.phoneNumber.length)}
                    </p>
                    <button
                      onClick={() => {
                        const newVisible = new Set(visiblePhones)
                        if (newVisible.has(account.id)) {
                          newVisible.delete(account.id)
                        } else {
                          newVisible.add(account.id)
                        }
                        setVisiblePhones(newVisible)
                      }}
                      className="p-1 hover:bg-white/10 rounded transition-colors"
                      title={visiblePhones.has(account.id) ? 'Gizle' : 'Göster'}
                    >
                      {visiblePhones.has(account.id) ? (
                        <EyeOff size={14} className="text-white/40 hover:text-white" />
                      ) : (
                        <Eye size={14} className="text-white/40 hover:text-white" />
                      )}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-white/40 hover:text-red-400 transition-colors p-2 hover:bg-red-500/10 rounded-lg border border-transparent hover:border-red-500/20"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div className="space-y-3 relative z-10">
                <div
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-bold ${
                    account.isConnected
                      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                      : 'bg-white/5 text-white/40 border border-white/10'
                  }`}
                >
                  {account.isConnected ? (
                    <>
                      <Power size={16} className="text-green-400" />
                      <span>Bağlı</span>
                    </>
                  ) : (
                    <>
                      <PowerOff size={16} className="text-white/40" />
                      <span>Bağlı Değil</span>
                    </>
                  )}
                </div>

                {!account.isConnected ? (
                  <button
                    onClick={() => handleConnect(account)}
                    disabled={isConnecting && connectingAccountId === account.id}
                    className="btn-primary w-full px-4 py-3 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none"
                  >
                    {isConnecting && connectingAccountId === account.id
                      ? 'Bağlanıyor...'
                      : 'Bağlan'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => handleDisconnect(account.id)}
                      className="w-full px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl text-sm font-bold border border-white/10 hover:border-white/20 transition-all shadow-lg"
                    >
                      Bağlantıyı Kes
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLeaveAllGroups(account)}
                      disabled={leavingAllGroupsId === account.id}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500/10 hover:bg-amber-500/15 text-amber-100 rounded-xl text-sm font-bold border border-amber-500/25 hover:border-amber-400/35 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Diyalog listesindeki gruplar, süper gruplar ve kanallar"
                    >
                      <UserMinus size={18} className="shrink-0" />
                      {leavingAllGroupsId === account.id ? 'Gruplardan çıkılıyor...' : 'Tüm gruplardan çık'}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 surface-modal-overlay backdrop-blur-md flex items-center justify-center z-50 p-4 fade-in">
          <div className="surface-modal rounded-2xl p-8 w-full max-w-md shadow-2xl fade-in relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -ml-32 -mb-32" />
            
            <div className="flex items-center gap-4 mb-8 relative z-10">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-white/20 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
                <Plus size={28} className="text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white tracking-tight">Yeni Hesap Ekle</h3>
            </div>
            
            {/* Adım Göstergesi */}
            <div className="flex items-center gap-2 mb-8">
              <div className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                connectionStep === 'api' 
                  ? 'bg-gradient-to-r from-white to-gray-300' 
                  : 'bg-dark-border'
              }`} />
              <div className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                connectionStep === 'phone' 
                  ? 'bg-gradient-to-r from-white to-gray-300' 
                  : 'bg-dark-border'
              }`} />
              <div className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                connectionStep === 'code' || connectionStep === 'password'
                  ? 'bg-gradient-to-r from-white to-gray-300' 
                  : 'bg-dark-border'
              }`} />
              <div className={`flex-1 h-2 rounded-full transition-all duration-300 ${
                connectionStep === 'password'
                  ? 'bg-gradient-to-r from-white to-gray-300' 
                  : 'bg-dark-border'
              }`} />
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm fade-in backdrop-blur-sm relative z-10">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-red-400 text-xs font-bold">!</span>
                  </div>
                  <span className="flex-1">{errorMessage}</span>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {/* API Bilgileri Adımı */}
              {connectionStep === 'api' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      API ID
                    </label>
                    <div className="relative">
                      <input
                        type={showInputApiId ? "text" : "password"}
                        value={apiId}
                        onChange={(e) => setApiId(e.target.value)}
                        placeholder="12345678"
                        className="input-focus w-full px-4 py-3.5 pr-12 rounded-xl text-white placeholder-white/30 focus:outline-none font-mono text-sm relative z-10"
                        disabled={isConnecting}
                      />
                      <button
                        onClick={() => setShowInputApiId(!showInputApiId)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        title={showInputApiId ? 'Gizle' : 'Göster'}
                      >
                        {showInputApiId ? (
                          <EyeOff size={16} className="text-white/60 hover:text-white" />
                        ) : (
                          <Eye size={16} className="text-white/60 hover:text-white" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      API Hash
                    </label>
                    <div className="relative">
                      <input
                        type={showInputApiHash ? "text" : "password"}
                        value={apiHash}
                        onChange={(e) => setApiHash(e.target.value)}
                        placeholder="abcdef1234567890abcdef1234567890"
                        className="input-focus w-full px-4 py-3.5 pr-12 rounded-xl text-white placeholder-white/30 focus:outline-none font-mono text-sm relative z-10"
                        disabled={isConnecting}
                      />
                      <button
                        onClick={() => setShowInputApiHash(!showInputApiHash)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        title={showInputApiHash ? 'Gizle' : 'Göster'}
                      >
                        {showInputApiHash ? (
                          <EyeOff size={16} className="text-white/60 hover:text-white" />
                        ) : (
                          <Eye size={16} className="text-white/60 hover:text-white" />
                        )}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-white/40 mt-3 font-medium">
                    Telegram API bilgilerinizi my.telegram.org/apps adresinden alabilirsiniz
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={resetModal}
                      className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all relative z-10"
                    >
                      İptal
                    </button>
                    <button
                      onClick={() => {
                        if (!apiId.trim() || !apiHash.trim()) {
                          setErrorMessage('Lütfen API ID ve API Hash girin')
                          return
                        }
                        setConnectionStep('phone')
                        setErrorMessage('')
                      }}
                      disabled={isConnecting}
                      className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none relative z-10"
                    >
                      Devam Et
                    </button>
                  </div>
                </>
              )}

              {/* Telefon Numarası Adımı */}
              {connectionStep === 'phone' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Telefon Numarası
                    </label>
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+90 555 123 4567"
                      className="input-focus w-full px-4 py-3.5 rounded-xl text-white placeholder-white/30 focus:outline-none relative z-10"
                      onKeyPress={(e) => e.key === 'Enter' && handleSendCode()}
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-white/40 mt-3 font-medium">
                      Telegram hesabınıza kod gönderilecektir
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setConnectionStep('api')
                        setErrorMessage('')
                      }}
                      className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all relative z-10"
                    >
                      Geri
                    </button>
                    <button
                      onClick={handleSendCode}
                      disabled={isConnecting}
                      className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none relative z-10"
                    >
                      {isConnecting ? 'Gönderiliyor...' : 'Kod Gönder'}
                    </button>
                  </div>
                </>
              )}

              {/* Kod Doğrulama Adımı */}
              {connectionStep === 'code' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Doğrulama Kodu
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => {
                        // Sadece rakamları kabul et
                        const value = e.target.value.replace(/\D/g, '').slice(0, 5)
                        setCode(value)
                      }}
                      placeholder="84431"
                      className="input-focus w-full px-4 py-3.5 rounded-xl text-white placeholder-white/30 focus:outline-none text-center text-2xl font-bold tracking-widest relative z-10"
                      onKeyPress={(e) => e.key === 'Enter' && handleVerifyCode()}
                      disabled={isConnecting}
                      maxLength={5}
                      inputMode="numeric"
                    />
                    <p className="text-xs text-white/40 mt-3 font-medium">
                      {phoneNumber} numaralı telefona gönderilen kodu girin
                    </p>
                    <p className="text-xs text-white/30 mt-2 font-medium">
                      Kod 2-3 dakika içinde geçerliliğini yitirir
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setConnectionStep('phone')
                          setCode('')
                          setErrorMessage('')
                        }}
                        className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all relative z-10"
                      >
                        Geri
                      </button>
                      <button
                        onClick={handleVerifyCode}
                        disabled={isConnecting}
                        className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none relative z-10"
                      >
                        {isConnecting ? 'Doğrulanıyor...' : 'Doğrula'}
                      </button>
                    </div>
                    <button
                      onClick={async () => {
                        setCode('')
                        setErrorMessage('')
                        // API bilgilerini tekrar ayarla
                        if (apiId.trim() && apiHash.trim()) {
                          telegramManager.setApiConfig(apiId.trim(), apiHash.trim())
                        }
                        await handleSendCode()
                      }}
                      disabled={isConnecting}
                      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 text-white/60 rounded-xl font-semibold hover:bg-white/10 hover:text-white hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Yeni Kod İste
                    </button>
                  </div>
                </>
              )}

              {/* Şifre Adımı (2FA) */}
              {connectionStep === 'password' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      2FA Şifresi
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Şifrenizi girin"
                      className="input-focus w-full px-4 py-3.5 rounded-xl text-white placeholder-white/30 focus:outline-none relative z-10"
                      onKeyPress={(e) => e.key === 'Enter' && handleVerifyPassword()}
                      disabled={isConnecting}
                    />
                    <p className="text-xs text-white/40 mt-3 font-medium">
                      İki faktörlü doğrulama şifrenizi girin
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setConnectionStep('code')
                        setPassword('')
                        setErrorMessage('')
                      }}
                      className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all relative z-10"
                    >
                      Geri
                    </button>
                    <button
                      onClick={handleVerifyPassword}
                      disabled={isConnecting}
                      className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none relative z-10"
                    >
                      {isConnecting ? 'Bağlanıyor...' : 'Bağlan'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

