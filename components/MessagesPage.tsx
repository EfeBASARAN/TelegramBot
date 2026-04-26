'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { Plus, Trash2, Edit2, MessageSquare, Image as ImageIcon, X } from 'lucide-react'
import { useAppStore, MessageTemplate } from '@/store/appStore'
import {
  TEMPLATE_PHOTO_MIMES,
  type TemplatePhotoPayload,
  templatePhotoDataUrl,
  validateTemplatePhotoBytes,
} from '@/lib/templatePhoto'

const ACCEPT_IMAGES = TEMPLATE_PHOTO_MIMES.join(',')

function fileToTemplatePhoto(
  file: File,
  onError: (msg: string) => void
): Promise<TemplatePhotoPayload | null> {
  return new Promise((resolve) => {
    if (
      !TEMPLATE_PHOTO_MIMES.includes(
        file.type as (typeof TEMPLATE_PHOTO_MIMES)[number]
      )
    ) {
      onError('Sadece JPG, PNG veya WEBP seçin.')
      resolve(null)
      return
    }
    const reader = new FileReader()
    reader.onerror = () => {
      onError('Dosya okunamadı.')
      resolve(null)
    }
    reader.onload = () => {
      const r = String(reader.result)
      const comma = r.indexOf(',')
      if (comma < 0) {
        onError('Dosya okunamadı.')
        resolve(null)
        return
      }
      const dataHead = r.slice(0, comma)
      const base64 = r.slice(comma + 1)
      const m = dataHead.match(/^data:([^;]+)/i)
      const mimeType = m?.[1] || file.type
      if (
        !TEMPLATE_PHOTO_MIMES.includes(
          mimeType as (typeof TEMPLATE_PHOTO_MIMES)[number]
        )
      ) {
        onError('Sadece JPG, PNG veya WEBP seçin.')
        resolve(null)
        return
      }
      try {
        const bin = atob(base64)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
        const v = validateTemplatePhotoBytes(mimeType, u8)
        if (!v.ok) {
          onError(v.error)
          resolve(null)
          return
        }
        resolve({
          fileName: file.name,
          mimeType,
          base64,
        })
      } catch {
        onError('Görsel işlenemedi (çok büyük olabilir).')
        resolve(null)
      }
    }
    reader.readAsDataURL(file)
  })
}

export default function MessagesPage() {
  const messageTemplates = useAppStore((state) => state.messageTemplates)
  const addMessageTemplate = useAppStore((state) => state.addMessageTemplate)
  const removeMessageTemplate = useAppStore((state) => state.removeMessageTemplate)
  const updateMessageTemplate = useAppStore((state) => state.updateMessageTemplate)
  const pushToast = useAppStore((state) => state.pushToast)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [mediaPhoto, setMediaPhoto] = useState<TemplatePhotoPayload | null>(null)
  const [antiSpamDelay, setAntiSpamDelay] = useState(false)

  const hasMedia = Boolean(mediaPhoto)
  const canSave = Boolean(name.trim() && (content.trim() || hasMedia))

  const handleAdd = () => {
    if (!canSave) return

    const newTemplate: MessageTemplate = {
      id: Date.now().toString(),
      name: name.trim(),
      content: content.trim(),
      mediaPhoto: mediaPhoto ?? undefined,
      antiSpamDelay: antiSpamDelay || undefined,
    }

    addMessageTemplate(newTemplate)
    resetForm()
    setShowAddModal(false)
  }

  const handleEdit = (template: MessageTemplate) => {
    setEditingId(template.id)
    setName(template.name)
    setContent(template.content)
    setMediaPhoto(template.mediaPhoto ? { ...template.mediaPhoto } : null)
    setAntiSpamDelay(template.antiSpamDelay === true)
    setShowAddModal(true)
  }

  const handleUpdate = () => {
    if (!canSave || !editingId) return

    updateMessageTemplate(editingId, {
      name: name.trim(),
      content: content.trim(),
      mediaPhoto: mediaPhoto ?? undefined,
      antiSpamDelay: antiSpamDelay || undefined,
    })

    resetForm()
    setShowAddModal(false)
  }

  const resetForm = () => {
    setName('')
    setContent('')
    setMediaPhoto(null)
    setAntiSpamDelay(false)
    setEditingId(null)
  }

  const onPickFile = () => fileInputRef.current?.click()

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const photo = await fileToTemplatePhoto(file, (msg) => pushToast(msg, 'error'))
    if (photo) setMediaPhoto(photo)
  }

  const handleDelete = (id: string) => {
    if (confirm('Bu şablonu silmek istediğinize emin misiniz? Zamanlayıcıda kullanılıyorsa gönderim etkilenebilir.')) {
      removeMessageTemplate(id)
    }
  }

  return (
    <div className="fade-in relative z-10 min-h-full">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h2 className="text-4xl font-bold text-white mb-3 gradient-text tracking-tight">Mesaj şablonları</h2>
          <p className="text-white/50 text-base font-medium max-w-2xl">
            Tekrar kullanılacak metinleri adlandırın; zamanlayıcıda şablon seçerek aynı içeriği birden
            çok gönderime bağlayın. İsteğe bağlı olarak bir görsel de ekleyebilirsiniz.
          </p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddModal(true)
          }}
          className="btn-primary flex items-center gap-2 px-6 py-3 rounded-xl font-bold"
        >
          <Plus size={20} />
          Şablon Ekle
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_IMAGES}
        className="hidden"
        onChange={onFileChange}
      />

      {messageTemplates.length === 0 ? (
        <div className="text-center py-24 surface-muted rounded-2xl shadow-2xl fade-in">
          <div className="w-24 h-24 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 shadow-lg">
            <MessageSquare size={48} className="text-white/40" />
          </div>
          <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">
            Kayıtlı şablon yok
          </h3>
          <p className="text-white/50 text-sm mb-8 font-medium max-w-md mx-auto">
            Şablon Ekle ile bir ad ve mesaj metni tanımlayın. Zamanlayıcı bu şablonlardan seçim yapar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {messageTemplates.map((template, index) => (
            <div
              key={template.id}
              className="surface-panel rounded-2xl p-6 card-hover shadow-2xl fade-in electric-border relative overflow-hidden"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16" />
              
              <div className="flex justify-between items-start mb-5 relative z-10 gap-2">
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-xl tracking-tight">{template.name}</h3>
                  {template.antiSpamDelay && (
                    <span className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300/95 border border-emerald-500/25">
                      Anti-spam gecikme
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(template)}
                    className="text-white/40 hover:text-blue-400 transition-colors p-2 hover:bg-blue-500/10 rounded-lg border border-transparent hover:border-blue-500/20"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleDelete(template.id)}
                    className="text-white/40 hover:text-red-400 transition-colors p-2 hover:bg-red-500/10 rounded-lg border border-transparent hover:border-red-500/20"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              {template.mediaPhoto && (
                <div className="relative z-10 mb-4 max-h-40 rounded-xl overflow-hidden border border-white/10 bg-black/20">
                  <img
                    src={templatePhotoDataUrl(template.mediaPhoto)}
                    alt=""
                    className="w-full h-full max-h-40 object-contain"
                  />
                </div>
              )}
              {template.content ? (
                <p className="text-white/70 whitespace-pre-wrap leading-relaxed relative z-10 font-medium">
                  {template.content}
                </p>
              ) : (
                <p className="text-white/40 text-sm relative z-10 italic">Yalnızca görsel</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 surface-modal-overlay backdrop-blur-md flex items-center justify-center z-50 p-4 fade-in">
          <div className="surface-modal rounded-2xl p-8 w-full max-w-2xl shadow-2xl fade-in relative overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -ml-32 -mb-32" />
            
            <h3 className="text-2xl font-bold text-white mb-6 tracking-tight relative z-10">
              {editingId ? 'Şablon Düzenle' : 'Yeni Şablon Ekle'}
            </h3>
            <div className="space-y-6 relative z-10">
              <div>
                <label className="block text-sm font-bold text-white mb-3 tracking-tight">
                  Şablon Adı
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Hoşgeldin Mesajı"
                  className="input-focus w-full px-4 py-3.5 rounded-xl text-white placeholder-white/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-white mb-3 tracking-tight">
                  Mesaj İçeriği
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Mesaj içeriğini buraya yazın (görsel tek başına da kullanılabilir)..."
                  rows={8}
                  className="input-focus w-full px-4 py-3.5 rounded-xl text-white placeholder-white/30 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-white mb-3 tracking-tight">
                  Görsel (opsiyonel)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={onPickFile}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold bg-white/10 hover:bg-white/15 text-white border border-white/10"
                  >
                    <ImageIcon size={18} />
                    Dosya seç
                  </button>
                  {hasMedia && (
                    <button
                      type="button"
                      onClick={() => setMediaPhoto(null)}
                      className="inline-flex items-center gap-1.5 text-sm text-red-300/90 hover:text-red-200"
                    >
                      <X size={16} />
                      Görseli kaldır
                    </button>
                  )}
                </div>
                {hasMedia && mediaPhoto && (
                  <div className="mt-3 rounded-xl overflow-hidden border border-white/10 max-h-48 bg-black/20">
                    <img
                      src={templatePhotoDataUrl(mediaPhoto)}
                      alt=""
                      className="w-full max-h-48 object-contain"
                    />
                    <p className="text-[11px] text-white/45 px-2 py-1.5 break-all">
                      {mediaPhoto.fileName}
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-white/50 mt-2 leading-relaxed">
                  En fazla 10MB, en-boy oranı en fazla 20:1, genişlik+yükseklik toplamı en fazla 10000. Veriler
                  tarayıcınızda (localStorage) tutulur; çok büyük görseller kaydedilemeyebilir.
                </p>
              </div>
              <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={antiSpamDelay}
                  onChange={(e) => setAntiSpamDelay(e.target.checked)}
                  className="accent-emerald-500 mt-0.5 shrink-0"
                />
                <span className="text-sm text-white/85 leading-snug">
                  <span className="font-bold text-white">Anti-spam koruması</span>
                  <span className="block text-white/50 text-xs mt-1 font-medium">
                    Zamanlayıcıdaki mesajlar arası / hesaplar arası süreleri taban alarak bekleme sürelerini
                    rastgele seçer. Ayrıca her gönderimde metni anlamı değiştirmeden hafifçe çeşitlendirir
                    (boşluklar, görünmez karakterler, cümle başı) — birebir aynı metin imzasını zorlaştırır.
                  </span>
                </span>
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    resetForm()
                  }}
                  className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all"
                >
                  İptal
                </button>
                <button
                  onClick={editingId ? handleUpdate : handleAdd}
                  disabled={!canSave}
                  className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold disabled:opacity-40 disabled:pointer-events-none"
                >
                  {editingId ? 'Güncelle' : 'Ekle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
