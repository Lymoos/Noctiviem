import { useState } from 'react'
import { X, Users, Film } from 'lucide-react'
import { MediaItem } from '../types'

interface CreateRoomModalProps {
  media: MediaItem[]
  preselectedMediaId?: string
  onClose: () => void
  onCreate: (data: { name: string; mediaId: string; maxParticipants: number }) => void
}

export default function CreateRoomModal({ media, preselectedMediaId, onClose, onCreate }: CreateRoomModalProps) {
  const [name, setName] = useState('Movie Night')
  const [mediaId, setMediaId] = useState(preselectedMediaId || media.find(m => m.status === 'ready')?.id || '')
  const [maxParticipants, setMaxParticipants] = useState(20)

  const selectedMedia = media.find(m => m.id === mediaId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!mediaId) return
    onCreate({ name: name.trim() || 'Movie Night', mediaId, maxParticipants })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-cinema-text">Create Cinema Hall</h2>
            <p className="text-sm text-cinema-muted mt-0.5">You'll become the Leader</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-2">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Room name */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">Hall Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder="Movie Night"
              maxLength={50}
            />
          </div>

          {/* Film selection */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">Film</label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {media.filter(m => m.status === 'ready').map(m => (
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
                      <span className="text-xs text-slate-500">{m.audio.length} audio</span>
                      <span className="text-xs text-slate-500">{m.subtitles.filter(s=>s.id!=='off').length} subs</span>
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
          </div>

          {/* Max participants */}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wide mb-2">
              Seat Limit: <span className="text-purple-400">{maxParticipants}</span>
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

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={!mediaId} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Film size={14} />
              Create Hall
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
