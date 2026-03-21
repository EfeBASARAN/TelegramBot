import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import { Api } from 'telegram'
import { returnBigInt } from 'telegram/Helpers'
import { formatUserFacingTelegramError } from './telegramErrorMessages'
import { assertLicenseActive } from './licenseRuntime'

/** Gruplar / süper gruplar / kanallar listesi için özet bilgi */
export interface JoinedGroupInfo {
  id: string
  title: string
  username?: string
  typeLabel: string
  membersCount?: number
  isPublic: boolean
  /** Telegram masaüstü / API ile uyumlu sohbet kimliği (örn. -100… ) */
  peerKey?: string
  /** Kanal/süper grup için getParticipants (kullanıcı adı yoksa gerekli) */
  accessHash?: string
  /** Sohbet diyalogundan (getDialogs) */
  unreadCount?: number
  pinned?: boolean
  /** Son mesajın tarihi (ISO) */
  lastActivityAt?: string
  /** Son mesaj metni özeti */
  lastMessagePreview?: string
}

function messagePreviewFromDialogMessage(msg: unknown): string | undefined {
  if (!msg || typeof msg !== 'object') return undefined
  const m = msg as { text?: string | (() => string); message?: string }
  let raw = ''
  if (typeof m.text === 'string') raw = m.text
  else if (typeof m.text === 'function') {
    try {
      raw = m.text()
    } catch {
      raw = ''
    }
  } else {
    raw = (m.message as string) || ''
  }
  raw = raw.trim()
  if (!raw) return undefined
  const oneLine = raw.replace(/\s+/g, ' ')
  return oneLine.length > 100 ? `${oneLine.slice(0, 97)}…` : oneLine
}

export interface GroupMemberInfo {
  id: string
  firstName?: string
  lastName?: string
  username?: string
  isBot?: boolean
  /** DM için gerekli (kullanıcı adı yoksa) */
  accessHash?: string
}

/** Zamanlayıcı / toplu gönderim: üyeyi sendMessage hedef dizesine çevirir */
export function memberToSendTarget(m: GroupMemberInfo): string | null {
  if (m.isBot) return null
  if (m.username) {
    return m.username.replace(/^@/, '')
  }
  if (m.accessHash) {
    return `__peer_user__:${m.id}:${m.accessHash}`
  }
  return null
}

/**
 * Zamanlayıcı özel liste, satır başına:
 * - `kullanıcıId | accessHash` (iki sütun, ikisi de tam sayı)
 * - `kullanıcıAdı | kullanıcıId | accessHash` (üç sütun; baştaki @ opsiyonel, geçerli kullanıcı adıysa gönderimde önce getEntity denenir)
 */
export function parseCustomPeerList(text: string): { targets: string[]; errors: string[] } {
  const targets: string[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split('|').map((p) => p.trim())

    if (parts.length === 2) {
      const idStr = parts[0]
      const hashStr = parts[1]
      if (!/^-?\d+$/.test(idStr)) {
        errors.push(`Satır ${i + 1} (2 sütun): kullanıcı ID tam sayı olmalı`)
        continue
      }
      if (!/^-?\d+$/.test(hashStr)) {
        errors.push(`Satır ${i + 1} (2 sütun): access hash tam sayı olmalı`)
        continue
      }
      targets.push(`__peer_user__:${idStr}:${hashStr}`)
      continue
    }

    if (parts.length !== 3) {
      errors.push(
        `Satır ${i + 1}: 2 sütun (kullanıcı ID | access hash) veya 3 sütun (kullanıcı adı | kullanıcı ID | access hash) kullanın`
      )
      continue
    }
    const idStr = parts[1]
    const hashStr = parts[2]
    if (!/^-?\d+$/.test(idStr)) {
      errors.push(`Satır ${i + 1}: kullanıcı ID geçerli bir tam sayı olmalı`)
      continue
    }
    if (!/^-?\d+$/.test(hashStr)) {
      errors.push(`Satır ${i + 1}: access hash geçerli bir tam sayı olmalı`)
      continue
    }
    const firstCol = parts[0].trim().replace(/^@/, '')
    /** Telegram kullanıcı adı (5–32); varsa hedefe eklenir — gönderimde önce getEntity ile çözülür (hash oturuma özel olduğu için PEER_ID_INVALID riskini azaltır). */
    const looksLikeUsername = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(firstCol)
    targets.push(
      looksLikeUsername
        ? `__peer_user__:${idStr}:${hashStr}:${firstCol}`
        : `__peer_user__:${idStr}:${hashStr}`
    )
  }
  return { targets, errors }
}

/** Özel liste metin kutusu için anlık doğrulama (UI geri bildirimi) */
export function validateCustomPeerListInput(text: string): {
  isValid: boolean
  recipientCount: number
  nonEmptyLineCount: number
  issues: string[]
} {
  const raw = text.trim()
  if (!raw) {
    return { isValid: false, recipientCount: 0, nonEmptyLineCount: 0, issues: [] }
  }

  const lines = text.split(/\r?\n/)
  const issues: string[] = []
  let nonEmptyLineCount = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    nonEmptyLineCount++

    if (!line.includes('|')) {
      const compact = line.replace(/\s+/g, ' ').trim()
      if (/^-?\d+\s+-?\d+$/.test(compact)) {
        issues.push(
          `Satır ${i + 1}: Sütunları | (pipe) ile ayırın; boşluk yetmez. Örnek: 8360514410 | -3569048566089361204`
        )
      }
    }
  }

  const { targets, errors } = parseCustomPeerList(text)
  const merged = [...issues, ...errors]
  const unique = Array.from(new Set(merged))

  const isValid =
    nonEmptyLineCount > 0 && errors.length === 0 && targets.length === nonEmptyLineCount

  return {
    isValid,
    recipientCount: targets.length,
    nonEmptyLineCount,
    issues: unique,
  }
}

/** Düzenleme için: saklı peer hedeflerini metin kutusunda göstermeye çevir (ham metin yoksa) */
export function peerTargetsToCustomListLines(targets: string[]): string {
  return targets
    .map((t) => {
      if (t.startsWith('__peer_user__:')) {
        const p = t.split(':')
        const uid = p[1]
        const ah = p[2]
        const un = p[3]
        if (un && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(un)) {
          return `@${un} | ${uid} | ${ah}`
        }
        return `${uid} | ${ah}`
      }
      return t
    })
    .join('\n')
}

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

  /** Arayüz patch’lenmiş olsa bile Telegram API yolunu kilitlemek için */
  private async requireLicenseOrError(): Promise<string | null> {
    const r = await assertLicenseActive()
    return r.ok ? null : r.reason
  }

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
      const licErr = await this.requireLicenseOrError()
      if (licErr) {
        return { success: false, error: licErr }
      }
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
      const licErr = await this.requireLicenseOrError()
      if (licErr) {
        return { success: false, error: licErr }
      }
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
    const licErr = await this.requireLicenseOrError()
    if (licErr) {
      return { success: false, error: licErr }
    }
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

      let entity
      try {
        if (cleanUsername.startsWith('__peer_user__:')) {
          const parts = cleanUsername.split(':')
          if (parts.length < 3 || parts[0] !== '__peer_user__') {
            return {
              success: false,
              error: 'Geçersiz iç hedef (üye kimliği)',
            }
          }
          const userIdStr = parts[1]
          const accessHashStr = parts[2]
          const optionalUsername =
            parts.length >= 4 && parts[3] && /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(parts[3])
              ? parts[3]
              : undefined

          /** Access hash gönderen oturuma özeldir; başka oturumdan kopyalanmış hash PEER_ID_INVALID verir. Kullanıcı adı varsa önce çözümleme dene. */
          if (optionalUsername) {
            try {
              entity = await client.getEntity(optionalUsername)
            } catch {
              entity = new Api.InputPeerUser({
                userId: returnBigInt(userIdStr),
                accessHash: returnBigInt(accessHashStr),
              })
            }
          } else {
            entity = new Api.InputPeerUser({
              userId: returnBigInt(userIdStr),
              accessHash: returnBigInt(accessHashStr),
            })
          }
        } else {
          // Username'den entity'yi al (hem kullanıcılar hem de gruplar için çalışır)
          entity = await client.getEntity(cleanUsername)
        }
        const ent = entity as { id?: unknown; userId?: unknown; className?: string }
        console.log('✅ Entity bulundu:', {
          username,
          entityId: ent.id ?? ent.userId,
          entityType: ent.className ?? 'InputPeerUser',
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
      
      const entForLog = entity as { id?: unknown; userId?: unknown; className?: string }
      console.log('📤 Mesaj gönderiliyor:', {
        accountId,
        username,
        entityId: entForLog.id ?? entForLog.userId,
        entityType: entForLog.className ?? 'InputPeerUser',
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
      } else if (
        errorMsg.includes('PEER_ID_INVALID') ||
        lowerErrorMsg.includes('peer_id_invalid')
      ) {
        errorMessage =
          'PEER_ID_INVALID: Kullanıcı ID + access hash çifti bu oturum için geçerli değil (hash genelde listeyi çıkaran hesaba özeldir). Kullanıcı adı satırda varsa uygulama önce onunla çözmeyi dener; yine de hata alırsanız özel listeyi bu gönderen hesaptan üretin veya manuel listede yalnızca @kullanıcı kullanın.'
      } else if (errorCode === 400) {
        errorMessage = `Telegram API hatası (400): ${errorMsg || 'Bilinmeyen hata'}`
      }
      
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  private async ensureClientForAccount(
    accountId: string,
    sessionString?: string,
    phoneNumber?: string,
    apiId?: string,
    apiHash?: string
  ): Promise<{ ok: true; client: TelegramClient } | { ok: false; error: string }> {
    const licErr = await this.requireLicenseOrError()
    if (licErr) {
      return { ok: false, error: licErr }
    }
    if (apiId && apiHash) {
      this.setApiConfig(apiId, apiHash)
    }
    let wrapper = this.clients.get(accountId)
    if (!wrapper || !wrapper.isConnected) {
      if (!sessionString || !phoneNumber) {
        return {
          ok: false,
          error:
            'Hesap bağlı değil veya oturum bilgisi yok. Hesaplar sayfasından hesabı bağlayın.',
        }
      }
      const reconnectResult = await this.connectAccount(accountId, phoneNumber, sessionString)
      if (!reconnectResult.success) {
        return { ok: false, error: reconnectResult.error || 'Yeniden bağlanılamadı' }
      }
      wrapper = this.clients.get(accountId)
    }
    if (!wrapper || !wrapper.isConnected || !wrapper.client) {
      return { ok: false, error: 'Telegram istemcisi hazır değil' }
    }
    return { ok: true, client: wrapper.client }
  }

  /**
   * Hesabın sohbet listesinden grup, süper grup ve kanalları döndürür (özel sohbetler hariç).
   */
  async getJoinedGroups(
    accountId: string,
    sessionString?: string,
    phoneNumber?: string,
    apiId?: string,
    apiHash?: string
  ): Promise<{ success: boolean; error?: string; groups?: JoinedGroupInfo[] }> {
    try {
      const ready = await this.ensureClientForAccount(
        accountId,
        sessionString,
        phoneNumber,
        apiId,
        apiHash
      )
      if (!ready.ok) {
        return { success: false, error: ready.error }
      }
      const client = ready.client
      const dialogs = await client.getDialogs({ limit: 200 })
      const groups: JoinedGroupInfo[] = []

      for (const d of dialogs) {
        const entity = d.entity
        if (!entity) continue

        if (entity instanceof Api.User) continue
        if (entity instanceof Api.ChatForbidden || entity instanceof Api.ChannelForbidden) continue

        const customDialog = d as {
          unreadCount?: number
          pinned?: boolean
          message?: { date?: number }
        }
        const unreadCount = customDialog.unreadCount ?? 0
        const pinned = customDialog.pinned ?? false
        let lastActivityAt: string | undefined
        let lastMessagePreview: string | undefined
        const msg = customDialog.message as { date?: number } | undefined
        if (msg?.date != null) {
          lastActivityAt = new Date(msg.date * 1000).toISOString()
        }
        lastMessagePreview = messagePreviewFromDialogMessage(customDialog.message)

        const extras = {
          unreadCount,
          pinned,
          lastActivityAt,
          lastMessagePreview,
        }

        if (entity instanceof Api.Channel) {
          if (entity.left) continue
          let typeLabel = 'Kanal'
          if (entity.megagroup) typeLabel = 'Süper grup'
          else if (entity.broadcast) typeLabel = 'Yayın kanalı'
          groups.push({
            id: entity.id.toString(),
            title: entity.title || 'İsimsiz',
            username: entity.username || undefined,
            typeLabel,
            membersCount: entity.participantsCount ?? undefined,
            isPublic: !!entity.username,
            peerKey: `-100${entity.id}`,
            accessHash: entity.accessHash?.toString(),
            ...extras,
          })
        } else if (entity instanceof Api.Chat) {
          groups.push({
            id: entity.id.toString(),
            title: entity.title || 'İsimsiz',
            typeLabel: 'Grup',
            membersCount: entity.participantsCount ?? undefined,
            isPublic: false,
            peerKey: `-${entity.id}`,
            ...extras,
          })
        }
      }

      groups.sort((a, b) => a.title.localeCompare(b.title, 'tr', { sensitivity: 'base' }))
      return { success: true, groups }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || error.errorMessage || 'Grup listesi alınamadı',
      }
    }
  }

  /**
   * Diyalog listesindeki tüm temel gruplar, süper gruplar ve abone olunan kanallardan çıkar.
   * (Liste sınırı: son ~500 diyalog; çok fazla sohbet varsa tamamı görünmeyebilir.)
   * Kanal/grup sahibi olduğunuz yerlerde Telegram reddedebilir — failedCount artar.
   */
  async leaveAllJoinedGroups(
    accountId: string,
    sessionString?: string,
    phoneNumber?: string,
    apiId?: string,
    apiHash?: string
  ): Promise<{
    success: boolean
    error?: string
    leftCount?: number
    failedCount?: number
  }> {
    try {
      const ready = await this.ensureClientForAccount(
        accountId,
        sessionString,
        phoneNumber,
        apiId,
        apiHash
      )
      if (!ready.ok) {
        return { success: false, error: ready.error }
      }
      const client = ready.client
      const dialogs = await client.getDialogs({ limit: 500 })

      let leftCount = 0
      let failedCount = 0

      for (const d of dialogs) {
        const entity = d.entity
        if (!entity) continue
        if (entity instanceof Api.User) continue
        if (entity instanceof Api.ChatForbidden || entity instanceof Api.ChannelForbidden) continue

        try {
          if (entity instanceof Api.Channel) {
            if (entity.left) continue
            if (entity.accessHash == null) {
              failedCount++
              continue
            }
            await client.invoke(
              new Api.channels.LeaveChannel({
                channel: new Api.InputChannel({
                  channelId: returnBigInt(entity.id),
                  accessHash: returnBigInt(entity.accessHash),
                }),
              })
            )
            leftCount++
          } else if (entity instanceof Api.Chat) {
            await client.invoke(
              new Api.messages.DeleteChatUser({
                chatId: returnBigInt(entity.id),
                userId: new Api.InputUserSelf(),
              })
            )
            leftCount++
          }
        } catch {
          failedCount++
        }
        await new Promise((r) => setTimeout(r, 120))
      }

      return { success: true, leftCount, failedCount }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || error.errorMessage || 'Gruplardan çıkılamadı',
      }
    }
  }

  /**
   * Grup / süper grup / kanal üyelerini listeler (Telegram izin ve gizlilik kurallarına tabidir).
   */
  async getGroupParticipants(
    accountId: string,
    sessionString: string | undefined,
    phoneNumber: string | undefined,
    apiId: string | undefined,
    apiHash: string | undefined,
    group: JoinedGroupInfo
  ): Promise<{ success: boolean; error?: string; members?: GroupMemberInfo[] }> {
    try {
      const ready = await this.ensureClientForAccount(
        accountId,
        sessionString,
        phoneNumber,
        apiId,
        apiHash
      )
      if (!ready.ok) {
        return { success: false, error: ready.error }
      }
      const client = ready.client

      let entity: Api.TypeInputPeer | string | Api.InputChannel | Api.InputPeerChat

      if (group.username) {
        const u = group.username.startsWith('@') ? group.username : `@${group.username}`
        entity = u
      } else if (group.accessHash != null && group.accessHash !== '') {
        entity = new Api.InputChannel({
          channelId: returnBigInt(group.id),
          accessHash: returnBigInt(group.accessHash),
        })
      } else if (group.typeLabel === 'Grup') {
        entity = new Api.InputPeerChat({
          chatId: returnBigInt(group.id),
        })
      } else {
        return {
          success: false,
          error:
            'Bu sohbet için üye listesi alınamıyor (kullanıcı adı veya kanal tanımı eksik). Gruplar listesini yenileyin.',
        }
      }

      const participantOpts =
        group.typeLabel === 'Grup'
          ? { limit: 200 }
          : { limit: 200, filter: new Api.ChannelParticipantsRecent() }

      const participants = await client.getParticipants(entity, participantOpts)

      const members: GroupMemberInfo[] = []
      for (const p of participants) {
        if (p instanceof Api.User) {
          members.push({
            id: p.id.toString(),
            firstName: p.firstName,
            lastName: p.lastName,
            username: p.username,
            isBot: !!p.bot,
            accessHash: p.accessHash != null ? p.accessHash.toString() : undefined,
          })
        }
      }

      members.sort((a, b) => {
        const na = [a.firstName, a.lastName].filter(Boolean).join(' ') || a.username || a.id
        const nb = [b.firstName, b.lastName].filter(Boolean).join(' ') || b.username || b.id
        return na.localeCompare(nb, 'tr', { sensitivity: 'base' })
      })

      return { success: true, members }
    } catch (error: any) {
      const raw = String(
        error?.message ?? error?.errorMessage ?? error ?? 'Üye listesi alınamadı'
      )
      return {
        success: false,
        error: formatUserFacingTelegramError(raw, 'participants'),
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
    const licErr = await this.requireLicenseOrError()
    if (licErr) {
      return null
    }
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

