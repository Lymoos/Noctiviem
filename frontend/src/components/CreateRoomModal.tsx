import { useState } from 'react'
import { X, Film, Download, Globe, Lock, UserCheck } from 'lucide-react'
import { MediaItem } from '../types'
import { useStore } from '../store'
import { translations } from '../i18n'

type PrivacyMode = 'public' | 'password' | 'friends'

interface CreateRoomModalProps {
  media: MediaItem[]
  preselectedMediaId?: string
  onClose: () => void
  onCreate: (data: { name: string; mediaId: string; maxParticipants: number; password?: string; friendsOnly?: boolean }) => void
}

export default function CreateRoomModal({ media, preselectedMediaId, onClose, onCreate }: CreateRoomModalProps) {
  const { lang } = useStore()
  const t = translations[lang]
  const readyMedia = media.filter(m => m.status === 'ready')
  const [name, setName] = useState<string>(t.movieNight)
  const [mediaId, setMediaId] = useState(preselectedMediaId || readyMedia[0]?.id || '')
  const [maxParticipants, setMaxParticipants] = useState(20)
  const [privacy, setPrivacy] = useState<PrivacyMode>('public')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!mediaId) return
    const pw = privacy === 'password' ? password.trim() : undefined
    const friendsOnly = privacy === 'friends'
    onCreate({ name: name.trim() || t.movieNight, mediaId, maxParticipants, password: pw || undefined, friendsOnly })
  }

  const privacyOptions: { value: PrivacyMode; icon: React.ReactNode; label: string; desc: string }[] = [
    { value: 'public',   icon: <Globe size={13} />,    label: t.publicRoom,   desc: t.publicRoomDesc },
    { value: 'password', icon: <Lock size={13} />,     label: t.passwordRoom, desc: t.passwordRoomDesc },
    { value: 'friends',  icon: <UserCheck size={13} />, label: t.friendsOnly,  desc: t.friendsOnlyDesc },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-cinema-text">{t.createCinemaHall}</h2>
            <p className="text-sm text-cinema-muted mt-0.5">{t.youllBeLeader}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Room name */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">{t.hallName}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder={t.movieNight}
              maxLength={50}
              style={{ paddingLeft: '14px' }}
            />
          </div>

          {/* Film selection */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">{t.film}</label>
            {readyMedia.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3 glass rounded-xl border border-white/5">
                <div className="w-12 h-12 rounded-xl bg-cinema-card flex items-center justify-center opacity-40">
                  <Download size={20} className="text-slate-400" />
                </div>
                <p className="text-sm text-cinema-muted font-medium">{t.noFilmsDownloaded}</p>
                <p className="text-xs text-slate-600 text-center px-4">{t.importTorrentFirst}</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {readyMedia.map(m => (
                  <div
                    key={m.id}
                    onClick={() => setMediaId(m.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                      mediaId === m.id
                        ? 'bg-purple-600/20 border border-purple-500/40'
                        : 'bg-white/3 border border-white/5 hover:bg-white/5'
                    }`}
                  >
                    <img
                      src={m.poster}
                      alt={m.title}
                      className="w-10 h-14 object-cover rounded"
                      onError={e => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${m.id}/80/112` }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-cinema-text truncate">{m.title}</div>
                      <div className="text-xs text-cinema-muted">{m.year} · {m.genre}</div>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-slate-500">{m.audio.length} {t.audio}</span>
                        <span className="text-xs text-slate-500">{m.subtitles.filter(s=>s.id!=='off').length} {t.subs}</span>
                      </div>
                    </div>
                    {mediaId === m.id && (
                      <div className="w-5 h-5 rounded-full accent-gradient flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs">✓</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Max participants */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">
              {t.seatLimit}: <span className="text-purple-400">{maxParticipants}</span>
            </label>
            <input
              type="range"
              min={2}
              max={50}
              value={maxParticipants}
              onChange={e => setMaxParticipants(Number(e.target.value))}
              className="w-full accent-purple-500"
            />
            <div className="flex justify-between text-xs text-slate-600 mt-1">
              <span>2</span>
              <span>50</span>
            </div>
          </div>

          {/* Privacy */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">{t.privacy}</label>
            <div className="grid grid-cols-3 gap-2">
              {privacyOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPrivacy(opt.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs transition-all ${
                    privacy === opt.value
                      ? 'border-purple-500/60 bg-purple-600/15 text-purple-300'
                      : 'border-white/5 bg-white/3 text-cinema-muted hover:bg-white/6'
                  }`}
                >
                  {opt.icon}
                  <span className="font-medium">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-1.5">
              {privacyOptions.find(o => o.value === privacy)?.desc}
            </p>
            {privacy === 'password' && (
              <input
                type="text"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input-field mt-2 text-sm"
                placeholder={t.enterPassword}
                maxLength={32}
                style={{ paddingLeft: '14px' }}
                required
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              {t.cancel}
            </button>
            <button type="submit" disabled={!mediaId || (privacy === 'password' && !password.trim())} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Film size={14} />
              {t.createHall}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
