import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram'

export interface TelegramClientWrapper {
  client: TelegramClient
  accountId: string
  isConnected: boolean
  phoneCodeHash?: string
}

class TelegramManager {
  private clients: Map<string, TelegramClientWrapper> = new Map()
  private apiId: number = 0
  private apiHash: string = ''

  setApiConfig(apiId: string, apiHash: string) {
    this.apiId = parseInt(apiId) || 0
    this.apiHash = apiHash || ''
  }

  getApiConfig() {
    return {
      apiId: this.apiId,
      apiHash: this.apiHash,
    }
  }

  async requestCode(
    accountId: string,
    phoneNumber: string
  ): Promise<{ 
    success: boolean
    error?: string
  }> {
    try {
      if (!this.apiId || !this.apiHash) {
        return {
          success: false,
          error: 'API bilgileri ayarlanmamış. Lütfen ayarlardan API ID ve API Hash girin.',
        }
      }

      const session = new StringSession('')
      const client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
      })

      await client.connect()

      // Eski client varsa disconnect et
      const oldWrapper = this.clients.get(accountId)
      if (oldWrapper && oldWrapper.client) {
        try {
          await oldWrapper.client.disconnect()
        } catch (e) {
          // Ignore disconnect errors
        }
      }

      const result = await client.sendCode(
        { apiId: this.apiId, apiHash: this.apiHash },
        phoneNumber
      )
      
      // Yeni phoneCodeHash'i sakla
      const phoneCodeHash = result.phoneCodeHash
      
      // Yeni client'ı sakla
      const wrapper = {
        client,
        accountId,
        isConnected: false,
        phoneCodeHash,
      }
      this.clients.set(accountId, wrapper)
      
      return {
        success: true,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.errorMessage || error.message || 'Kod gönderme hatası',
      }
    }
  }

  async connectAccount(
    accountId: string,
    phoneNumber: string,
    sessionString?: string,
    code?: string,
    password?: string
  ): Promise<{ 
    success: boolean
    sessionString?: string
    error?: string
    requiresCode?: boolean
    requiresPassword?: boolean
  }> {
    try {
      if (!this.apiId || !this.apiHash) {
        return {
          success: false,
          error: 'API bilgileri ayarlanmamış. Lütfen ayarlardan API ID ve API Hash girin.',
        }
      }

      const session = new StringSession(sessionString || '')
      let client = new TelegramClient(session, this.apiId, this.apiHash, {
        connectionRetries: 5,
      })

      await client.connect()

      let wrapper = this.clients.get(accountId)
      
      if (!(await client.checkAuthorization())) {
        // Kod ile giriş yapılacak
        if (!code) {
          return {
            success: false,
            error: 'Kod gerekli',
          }
        }

        // Mevcut wrapper'ı al - mutlaka olmalı (requestCode ile oluşturulmuş olmalı)
        if (!wrapper || !wrapper.phoneCodeHash) {
          return {
            success: false,
            error: 'Kod hash bulunamadı. Lütfen önce "Kod Gönder" butonuna tıklayın.',
            requiresCode: true,
          }
        }

        // Aynı client'ı kullan
        if (wrapper.client !== client) {
          // Eski client'ı disconnect et
          try {
            await client.disconnect()
          } catch (e) {
            // Ignore
          }
          client = wrapper.client
        }

        try {
          // Kodu temizle ve string'e çevir
          const cleanCode = String(code!).replace(/\D/g, '')
          
          if (!cleanCode || cleanCode.length < 5) {
            return {
              success: false,
              error: 'Geçersiz kod formatı',
            }
          }

          const result = await client.invoke(
            new Api.auth.SignIn({
              phoneNumber,
              phoneCodeHash: wrapper.phoneCodeHash,
              phoneCode: cleanCode,
            })
          )

          // Başarılı giriş
          const sessionStringNew = client.session.save() as unknown as string
          
          this.clients.set(accountId, {
            client,
            accountId,
            isConnected: true,
          })

          return {
            success: true,
            sessionString: sessionStringNew,
          }
        } catch (err: any) {
          // 2FA şifresi gerekebilir
          if (err.errorMessage === 'SESSION_PASSWORD_NEEDED' || err.message?.includes('PASSWORD') || err.code === 401) {
            if (!password) {
              return {
                success: false,
                requiresPassword: true,
                error: '2FA şifresini girin',
              }
            }
            
            // 2FA şifresi ile giriş
            try {
              // Önce password'ü kontrol et
              const passwordInfo = await client.invoke(
                new Api.account.GetPassword()
              )
              
              // SRP hash hesaplama için password'ü kullan
              // Telegram client'ın kendi SRP hesaplamasını kullanmak için
              // signInUser metodunu password callback ile kullanıyoruz
              await client.signInUser({
                apiId: this.apiId,
                apiHash: this.apiHash,
              }, {
                phoneNumber,
                phoneCode: () => Promise.resolve(code!),
                password: () => Promise.resolve(password!),
                onError: (err: any) => {
                  throw err
                },
              })

              // Başarılı giriş
              const sessionStringNew = client.session.save() as unknown as string
              
              this.clients.set(accountId, {
                client,
                accountId,
                isConnected: true,
              })

              return {
                success: true,
                sessionString: sessionStringNew,
              }
            } catch (passwordErr: any) {
              return {
                success: false,
                error: passwordErr.errorMessage || passwordErr.message || 'Şifre doğrulama hatası',
              }
            }
          } else {
            // Kod hatası kontrolü
            const errorMsg = err.errorMessage || err.message || 'Kod doğrulama hatası'
            if (errorMsg.includes('EXPIRED') || errorMsg.includes('expired')) {
              return {
                success: false,
                error: 'Kod süresi dolmuş. Lütfen yeni kod isteyin.',
                requiresCode: true,
              }
            }
            if (errorMsg.includes('PHONE_CODE_INVALID') || errorMsg.includes('INVALID')) {
              return {
                success: false,
                error: 'PHONE_CODE_INVALID',
                requiresCode: true,
              }
            }
            return {
              success: false,
              error: errorMsg,
            }
          }
        }
      } else {
        // Zaten authorize olmuş - session'ı kaydet
        const sessionStringNew = client.session.save() as unknown as string

        this.clients.set(accountId, {
          client,
          accountId,
          isConnected: true,
        })

        return {
          success: true,
          sessionString: sessionStringNew,
        }
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Bağlantı hatası',
      }
    }
  }

  async sendMessage(
    accountId: string,
    username: string,
    message: string,
    sessionString?: string,
    phoneNumber?: string,
    apiId?: string,
    apiHash?: string
  ): Promise<{ success: boolean; error?: string }> {
    console.log('📨 ========== sendMessage BAŞLADI ==========')
    console.log('📨 Parametreler:', { 
      accountId, 
      username, 
      messageLength: message.length,
      hasSessionString: !!sessionString,
      sessionStringLength: sessionString?.length || 0,
      phoneNumber: phoneNumber || 'YOK',
      hasApiId: !!apiId,
      hasApiHash: !!apiHash,
      apiId: apiId || 'YOK',
      apiHash: apiHash ? `${apiHash.substring(0, 10)}...` : 'YOK'
    })
    
    try {
      // Hesap için API bilgilerini ayarla (varsa)
      if (apiId && apiHash) {
        console.log('🔑 Hesap API bilgileri ayarlanıyor:', { accountId, apiId, apiHashLength: apiHash.length })
        this.setApiConfig(apiId, apiHash)
        const currentConfig = this.getApiConfig()
        console.log('🔑 API config ayarlandı:', { 
          apiId: currentConfig.apiId, 
          apiHashLength: currentConfig.apiHash.length 
        })
      } else {
        console.warn('⚠️ API bilgileri yok!', { accountId, hasApiId: !!apiId, hasApiHash: !!apiHash })
        const currentConfig = this.getApiConfig()
        console.log('🔑 Mevcut global API config:', { 
          apiId: currentConfig.apiId, 
          apiHashLength: currentConfig.apiHash.length 
        })
      }
      
      let wrapper = this.clients.get(accountId)
      console.log('🔍 Client wrapper kontrolü:', {
        accountId,
        wrapperExists: !!wrapper,
        isConnected: wrapper?.isConnected,
        clientExists: !!wrapper?.client
      })
      
      // Client yoksa veya bağlı değilse, session string ile yeniden bağlanmayı dene
      if (!wrapper || !wrapper.isConnected) {
        console.log('⚠️ Client bulunamadı veya bağlı değil, yeniden bağlanma deneniyor...', accountId)
        console.log('⚠️ Wrapper durumu:', {
          wrapperExists: !!wrapper,
          isConnected: wrapper?.isConnected,
          hasClient: !!wrapper?.client
        })
        
        if (sessionString && phoneNumber) {
          console.log('🔄 Session string ile yeniden bağlanılıyor...')
          console.log('🔄 Bağlanma bilgileri:', {
            accountId,
            phoneNumber,
            sessionStringLength: sessionString.length,
            sessionStringPreview: sessionString.substring(0, 50) + '...'
          })
          // API bilgileri zaten yukarıda ayarlandı
          const reconnectResult = await this.connectAccount(
            accountId,
            phoneNumber,
            sessionString
          )
          
          console.log('🔄 Bağlanma sonucu:', {
            success: reconnectResult.success,
            error: reconnectResult.error,
            hasSessionString: !!reconnectResult.sessionString
          })
          
          if (!reconnectResult.success) {
            console.error('❌ Yeniden bağlanma başarısız:', reconnectResult.error)
            console.error('❌ Detaylar:', {
              accountId,
              phoneNumber,
              hasSessionString: !!sessionString,
              sessionStringLength: sessionString?.length || 0
            })
            return {
              success: false,
              error: `Hesap bağlı değil ve yeniden bağlanılamadı: ${reconnectResult.error}`,
            }
          }
          
          wrapper = this.clients.get(accountId)
          console.log('🔄 Yeniden bağlanma sonrası wrapper:', {
            wrapperExists: !!wrapper,
            isConnected: wrapper?.isConnected,
            hasClient: !!wrapper?.client
          })
          
          if (!wrapper || !wrapper.isConnected) {
            console.error('❌ Yeniden bağlanma sonrası client hala bulunamadı')
            console.error('❌ Tüm clientlar:', Array.from(this.clients.keys()))
            return {
              success: false,
              error: 'Yeniden bağlanma sonrası client bulunamadı',
            }
          }
          console.log('✅ Yeniden bağlanma başarılı')
        } else {
          console.error('❌ Hesap bağlı değil ve session string yok:', {
            accountId,
            hasSessionString: !!sessionString,
            hasPhoneNumber: !!phoneNumber,
            sessionString: sessionString || 'YOK',
            phoneNumber: phoneNumber || 'YOK'
          })
          return {
            success: false,
            error: 'Hesap bağlı değil ve session bilgisi bulunamadı',
          }
        }
      } else {
        console.log('✅ Client mevcut ve bağlı:', {
          accountId,
          isConnected: wrapper.isConnected
        })
      }

      const client = wrapper.client
      console.log('🔍 Entity alınıyor:', username)
      
      // Username'i temizle (başında ve sonunda boşlukları kaldır)
      // Telegram'ın getEntity metodu hem @ ile hem de @ olmadan çalışır
      // Gruplar için @ işareti gerekli olabilir, bu yüzden koruyoruz
      const cleanUsername = username.trim()
      
      // Username'den entity'yi al (hem kullanıcılar hem de gruplar için çalışır)
      let entity
      try {
        entity = await client.getEntity(cleanUsername)
        console.log('✅ Entity bulundu:', {
          username,
          entityId: entity.id,
          entityType: entity.className
        })
      } catch (entityError: any) {
        console.error('❌ Entity bulunamadı:', {
          username: cleanUsername,
          error: entityError.message || entityError.errorMessage,
          errorCode: entityError.code,
          fullError: entityError
        })
        
        // Rate limit hatası kontrolü
        const errorMsg = entityError.message || entityError.errorMessage || ''
        const errorString = String(entityError) || ''
        
        if (errorMsg.includes('wait of') && errorMsg.includes('seconds is required') ||
            errorString.includes('wait of') && errorString.includes('seconds is required')) {
          // Bekleme süresini çıkar (örn: "A wait of 68602 seconds is required")
          const waitMatch = errorMsg.match(/(\d+)\s*seconds/i) || errorString.match(/(\d+)\s*seconds/i)
          const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 0
          const waitMinutes = Math.round(waitSeconds / 60)
          const waitHours = Math.round(waitMinutes / 60)
          
          let waitTime = ''
          if (waitHours > 0) {
            waitTime = `${waitHours} saat ${waitMinutes % 60} dakika`
          } else if (waitMinutes > 0) {
            waitTime = `${waitMinutes} dakika`
          } else {
            waitTime = `${waitSeconds} saniye`
          }
          
          const errorMessage = `Telegram API rate limit: Bu hesap çok fazla istek yaptı. ${waitTime} beklenmesi gerekiyor. (${waitSeconds} saniye)`
          console.error('⏰ Rate limit hatası:', {
            accountId,
            username: cleanUsername,
            waitSeconds,
            waitTime
          })
          
          return {
            success: false,
            error: errorMessage,
          }
        }
        
        return {
          success: false,
          error: `Kullanıcı veya grup bulunamadı: ${cleanUsername}. Hata: ${errorMsg || 'Bilinmeyen hata'}`,
        }
      }
      
      console.log('📤 Mesaj gönderiliyor:', {
        accountId,
        username,
        entityId: entity.id,
        entityType: entity.className,
        messagePreview: message.substring(0, 50) + '...'
      })
      
      console.log('📤 sendMessage API çağrısı yapılıyor...')
      const sendResult = await client.sendMessage(entity, { message })
      console.log('📤 sendMessage API sonucu:', {
        accountId,
        username,
        resultType: typeof sendResult,
        result: sendResult
      })
      
      console.log('✅ Mesaj başarıyla gönderildi:', accountId, '->', username)
      console.log('📨 ========== sendMessage BAŞARILI ==========')

      return { success: true }
    } catch (error: any) {
      console.error('❌ ========== sendMessage HATASI ==========')
      console.error('❌ Hata detayları:', {
        accountId,
        username,
        error: error.message,
        errorMessage: error.errorMessage,
        errorType: error.constructor.name,
        errorCode: error.code,
        errorName: error.name,
        errorString: String(error),
        errorToString: error.toString(),
        fullError: error
      })
      console.error('❌ Stack trace:', error.stack)
      
      // Error object'i stringify etmeye çalış
      try {
        console.error('❌ Error object (JSON):', JSON.stringify(error, Object.getOwnPropertyNames(error)))
      } catch (e) {
        console.error('❌ Error object (string):', String(error))
      }
      
      // Error'un tüm property'lerini logla
      console.error('❌ Error properties:', {
        keys: Object.keys(error),
        values: Object.keys(error).reduce((acc, key) => {
          try {
            acc[key] = String(error[key])
          } catch (e) {
            acc[key] = '[Cannot stringify]'
          }
          return acc
        }, {} as Record<string, string>)
      })
      
      // Daha açıklayıcı hata mesajları
      let errorMessage = error.message || error.errorMessage || 'Mesaj gönderme hatası'
      
      // Hata kodunu kontrol et (400: USER_BANNED_IN_CHANNEL gibi)
      const errorCode = error.code || error.errorCode
      const errorMsg = error.errorMessage || error.message || ''
      
      console.log('🔍 Hata analizi:', {
        errorCode,
        errorMessage: errorMsg,
        errorName: error.name,
        errorString: String(error),
        fullError: error
      })
      
      // Hata mesajını string olarak kontrol et (400: USER_BANNED_IN_CHANNEL formatı için)
      const errorString = String(error) || ''
      const lowerErrorMsg = errorMsg.toLowerCase()
      const lowerErrorString = errorString.toLowerCase()
      
      if (lowerErrorMsg.includes('user_banned_in_channel') || 
          lowerErrorString.includes('user_banned_in_channel') ||
          lowerErrorMsg.includes('banned_in_channel') ||
          lowerErrorString.includes('banned_in_channel')) {
        errorMessage = `Bu hesap "${username}" grubundan/kanalından yasaklanmış. Mesaj gönderilemiyor.`
        console.error('🚫 Hesap yasaklanmış:', { accountId, username })
      } else if (lowerErrorMsg.includes('chat_write_forbidden') || errorMsg === 'CHAT_WRITE_FORBIDDEN') {
        errorMessage = 'Bu gruba mesaj gönderme yetkiniz yok'
      } else if (errorMsg.includes('wait of') && errorMsg.includes('seconds is required') ||
                 lowerErrorString.includes('wait of') && lowerErrorString.includes('seconds is required')) {
        // Rate limit hatası - bekleme süresini çıkar
        const waitMatch = errorMsg.match(/(\d+)\s*seconds/i) || lowerErrorString.match(/(\d+)\s*seconds/i)
        const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 0
        const waitMinutes = Math.round(waitSeconds / 60)
        const waitHours = Math.round(waitMinutes / 60)
        
        let waitTime = ''
        if (waitHours > 0) {
          waitTime = `${waitHours} saat ${waitMinutes % 60} dakika`
        } else if (waitMinutes > 0) {
          waitTime = `${waitMinutes} dakika`
        } else {
          waitTime = `${waitSeconds} saniye`
        }
        
        errorMessage = `Telegram API rate limit: Bu hesap çok fazla istek yaptı. ${waitTime} beklenmesi gerekiyor. (${waitSeconds} saniye ≈ ${Math.round(waitHours * 10) / 10} saat)`
        console.error('⏰ Rate limit hatası (sendMessage catch):', {
          accountId,
          username,
          waitSeconds,
          waitTime,
          waitHours
        })
      } else if (errorMsg.includes('FLOOD_WAIT')) {
        // FLOOD_WAIT hatası - bekleme süresini çıkar
        const waitMatch = errorMsg.match(/(\d+)/) || errorString.match(/(\d+)/)
        const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 0
        const waitMinutes = Math.round(waitSeconds / 60)
        const waitHours = Math.round(waitMinutes / 60)
        
        let waitTime = ''
        if (waitHours > 0) {
          waitTime = `${waitHours} saat ${waitMinutes % 60} dakika`
        } else if (waitMinutes > 0) {
          waitTime = `${waitMinutes} dakika`
        } else {
          waitTime = `${waitSeconds} saniye`
        }
        
        errorMessage = `Telegram API flood wait: ${waitTime} beklenmesi gerekiyor. (${waitSeconds} saniye)`
        console.error('⏰ Flood wait hatası:', {
          accountId,
          username,
          waitSeconds,
          waitTime
        })
      } else if (errorMsg.includes('USER_DEACTIVATED') || errorMsg === 'USER_DEACTIVATED') {
        errorMessage = 'Kullanıcı hesabı devre dışı'
      } else if (errorMsg.includes('PEER_FLOOD') || errorMsg === 'PEER_FLOOD') {
        errorMessage = 'Çok fazla mesaj gönderildi, lütfen bekleyin'
      } else if (errorMsg.includes('CHANNEL_PRIVATE') || errorMsg === 'CHANNEL_PRIVATE') {
        errorMessage = 'Bu kanal/grup özel veya erişilemez'
      } else if (errorMsg.includes('INPUT_USER_DEACTIVATED')) {
        errorMessage = 'Hedef kullanıcı hesabı devre dışı'
      } else if (errorMsg.includes('USER_IS_BLOCKED')) {
        errorMessage = 'Bu kullanıcı sizi engellemiş'
      } else if (errorMsg.includes('CHAT_ADMIN_REQUIRED')) {
        errorMessage = 'Bu işlem için grup yöneticisi olmanız gerekiyor'
      } else if (errorCode === 400) {
        errorMessage = `Telegram API hatası (400): ${errorMsg || 'Bilinmeyen hata'}`
      }
      
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  async disconnectAccount(accountId: string): Promise<void> {
    const wrapper = this.clients.get(accountId)
    if (wrapper) {
      try {
        await wrapper.client.disconnect()
      } catch (error) {
        console.error('Disconnect error:', error)
      }
      this.clients.delete(accountId)
    }
  }

  isAccountConnected(accountId: string): boolean {
    const wrapper = this.clients.get(accountId)
    return wrapper?.isConnected || false
  }

  async getAccountInfo(accountId: string): Promise<any> {
    const wrapper = this.clients.get(accountId)
    if (!wrapper || !wrapper.isConnected) {
      return null
    }

    try {
      const me = await wrapper.client.getMe()
      return me
    } catch (error) {
      return null
    }
  }
}

export const telegramManager = new TelegramManager()

