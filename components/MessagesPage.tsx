'use client'

import { useState } from 'react'
import { Plus, Trash2, Edit2, MessageSquare } from 'lucide-react'
import { useAppStore, MessageTemplate } from '@/store/appStore'

export default function MessagesPage() {
  const messageTemplates = useAppStore((state) => state.messageTemplates)
  const addMessageTemplate = useAppStore((state) => state.addMessageTemplate)
  const removeMessageTemplate = useAppStore((state) => state.removeMessageTemplate)
  const updateMessageTemplate = useAppStore((state) => state.updateMessageTemplate)

  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const handleAdd = () => {
    if (!name.trim() || !content.trim()) return

    const newTemplate: MessageTemplate = {
      id: Date.now().toString(),
      name: name.trim(),
      content: content.trim(),
    }

    addMessageTemplate(newTemplate)
    setName('')
    setContent('')
    setShowAddModal(false)
  }

  const handleEdit = (template: MessageTemplate) => {
    setEditingId(template.id)
    setName(template.name)
    setContent(template.content)
    setShowAddModal(true)
  }

  const handleUpdate = () => {
    if (!name.trim() || !content.trim() || !editingId) return

    updateMessageTemplate(editingId, {
      name: name.trim(),
      content: content.trim(),
    })

    setName('')
    setContent('')
    setEditingId(null)
    setShowAddModal(false)
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
            çok gönderime bağlayın.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null)
            setName('')
            setContent('')
            setShowAddModal(true)
          }}
          className="btn-primary flex items-center gap-2 px-6 py-3 rounded-xl font-bold"
        >
          <Plus size={20} />
          Şablon Ekle
        </button>
      </div>

      {messageTemplates.length === 0 ? (
        <div className="text-center py-24 bg-black/40 backdrop-blur-sm rounded-2xl border border-white/5 shadow-2xl fade-in">
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
              className="bg-black/60 backdrop-blur-sm border border-white/10 rounded-2xl p-6 card-hover shadow-2xl fade-in electric-border relative overflow-hidden"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16" />
              
              <div className="flex justify-between items-start mb-5 relative z-10">
                <h3 className="font-bold text-white text-xl tracking-tight">{template.name}</h3>
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
              <p className="text-white/70 whitespace-pre-wrap leading-relaxed relative z-10 font-medium">
                {template.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50 p-4 fade-in">
          <div className="bg-black/95 backdrop-blur-xl border border-white/10 rounded-2xl p-8 w-full max-w-2xl shadow-2xl fade-in relative overflow-hidden">
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
                  className="input-focus w-full px-4 py-3.5 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-white mb-3 tracking-tight">
                  Mesaj İçeriği
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Mesaj içeriğini buraya yazın..."
                  rows={8}
                  className="input-focus w-full px-4 py-3.5 bg-black/40 border border-white/10 rounded-xl text-white placeholder-white/30 focus:outline-none resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingId(null)
                    setName('')
                    setContent('')
                  }}
                  className="flex-1 px-4 py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl font-bold border border-white/10 hover:border-white/20 transition-all"
                >
                  İptal
                </button>
                <button
                  onClick={editingId ? handleUpdate : handleAdd}
                  className="btn-primary flex-1 px-4 py-3 rounded-xl font-bold"
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

