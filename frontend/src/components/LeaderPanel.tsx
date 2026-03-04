import React, { useState } from 'react'
import { X, MessageSquare, Smile, Lock, Unlock, Users, Film, SkipForward, ListVideo, XCircle } from 'lucide-react'
import { socket } from '../socket'
import { useStore } from '../store'

interface LeaderPanelProps {
  onClose: () => void
}

export default function LeaderPanel({ onClose }: LeaderPanelProps) {
  const room = useStore(s => s.room)
  const mediaLibrary = useStore(s => s.mediaLibrary)
  const currentMedia = useStore(s => s.media)
  const [queuePickerOpen, setQueuePickerOpen] = useState(false)

  if (!room) return null

  const toggle = (key: 'chatEnabled' | 'reactionsEnabled' | 'isLocked', currentVal: boolean) => {
    switch (key) {
      case 'chatEnabled':       socket.emit('room:chat_toggle',      { enabled: !currentVal }); break
      case 'reactionsEnabled':  socket.emit('room:reactions_toggle', { enabled: !currentVal }); break
      case 'isLocked':          socket.emit('room:lock',             { locked: !currentVal });  break
    }
  }

  const handleQueue = (mediaId: string) => {
    socket.emit('room:queue_media', { mediaId })
    setQueuePickerOpen(false)
  }

  const handleClearQueue = () => socket.emit('room:queue_media', { mediaId: null })
  const handlePlayNext = () => socket.emit('room:play_next')

  const availableMedia = mediaLibrary.filter(m => m.status === 'ready' && m.id !== currentMedia?.id)

  return (
    <div className="menu-dropdown w-80 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">👑</span>
          <span className="text-sm font-semibold text-cinema-text">Leader Controls</span>
        </div>
        <button onClick={onClose} className="btn-ghost p-1.5">
          <X size={14} />
        </button>
      </div>

      <div className="p-3 space-y-2" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
        {/* Room info */}
        <div className="flex items-center gap-2 px-1 py-1">
          <Users size={14} className="text-slate-500" />
          <span className="text-xs text-slate-400">
            {room.participants.length}/{room.maxParticipants} viewers
          </span>
        </div>

        {/* Invite code */}
        <div className="glass rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1.5">Invite Code</div>
          <div className="flex items-center justify-between">
            <span className="invite-badge">{room.inviteCode}</span>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/join/${room.inviteCode}`)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Copy link
            </button>
          </div>
        </div>

        {/* ── Up Next ──────────────────────────────────────────────────── */}
        <div className="pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-2 px-1 mb-2">
            <ListVideo size={13} className="text-blue-400" />
            <span className="text-xs font-semibold text-cinema-text">Up Next</span>
          </div>

          {room.queuedMediaId ? (
            <div className="glass rounded-lg p-2.5 flex items-center gap-3">
              {room.queuedMediaPoster && (
                <img
                  src={room.queuedMediaPoster}
                  alt={room.queuedMediaTitle ?? ''}
                  className="w-10 h-14 object-cover rounded flex-shrink-0"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-cinema-text truncate">{room.queuedMediaTitle}</p>
                <p className="text-xs text-slate-500 mt-0.5">Queued — ready to play</p>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button
                  onClick={handlePlayNext}
                  className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
                >
                  <SkipForward size={12} />
                  Play now
                </button>
                <button
                  onClick={handleClearQueue}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                  <XCircle size={11} />
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setQueuePickerOpen(v => !v)}
              className="w-full glass rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-cinema-text flex items-center gap-2 transition-colors"
            >
              <Film size={12} />
              {queuePickerOpen ? 'Close picker' : 'Choose next film…'}
            </button>
          )}

          {queuePickerOpen && !room.queuedMediaId && (
            <div className="mt-1.5 glass rounded-lg overflow-hidden" style={{ maxHeight: 192, overflowY: 'auto' }}>
              {availableMedia.length === 0 ? (
                <p className="text-xs text-slate-500 p-3">No other films in library</p>
              ) : availableMedia.map(m => (
                <button
                  key={m.id}
                  onClick={() => handleQueue(m.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                >
                  {m.poster && (
                    <img src={m.poster} alt={m.title} className="w-7 h-10 object-cover rounded flex-shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-cinema-text truncate">{m.title}</p>
                    <p className="text-[10px] text-slate-500">{m.year > 0 ? m.year : ''} {m.genre}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Toggles */}
        <div className="space-y-1 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <ToggleRow
            icon={<MessageSquare size={14} />}
            label="Chat"
            description="Allow viewers to chat"
            value={room.chatEnabled}
            onChange={() => toggle('chatEnabled', room.chatEnabled)}
          />
          <ToggleRow
            icon={<Smile size={14} />}
            label="Reactions"
            description="Allow emoji reactions"
            value={room.reactionsEnabled}
            onChange={() => toggle('reactionsEnabled', room.reactionsEnabled)}
          />
          <ToggleRow
            icon={room.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
            label="Lock Hall"
            description="Prevent new viewers from joining"
            value={room.isLocked}
            onChange={() => toggle('isLocked', room.isLocked)}
            dangerWhenOn
          />
        </div>

        {/* Participants list */}
        {room.participants.length > 1 && (
          <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-xs text-slate-500 mb-2 px-1">Viewers</div>
            <div className="space-y-1" style={{ maxHeight: 160, overflowY: 'auto' }}>
              {room.participants.filter(p => !p.isLeader).map(p => (
                <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-white/3 group">
                  <div className="flex items-center gap-2">
                    <img
                      src={p.avatar}
                      alt={p.nickname}
                      className="w-6 h-6 rounded-full"
                      onError={e => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${p.id}/24/24` }}
                    />
                    <span className="text-xs text-cinema-text">{p.nickname}</span>
                    {p.specialRole === 'miloe-solnyshko' && (
                      <span className="text-[10px]">🌸</span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${p.nickname} from the hall?`)) {
                        socket.emit('room:kick', { targetUserId: p.id })
                      }
                    }}
                    className="text-xs text-red-500/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ToggleRowProps {
  icon: React.ReactNode
  label: string
  description: string
  value: boolean
  onChange: () => void
  dangerWhenOn?: boolean
}

function ToggleRow({ icon, label, description, value, onChange, dangerWhenOn }: ToggleRowProps) {
  return (
    <div
      onClick={onChange}
      className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer hover:bg-white/3 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <span className={value ? (dangerWhenOn ? 'text-red-400' : 'text-purple-400') : 'text-slate-600'}>
          {icon}
        </span>
        <div>
          <div className="text-sm text-cinema-text">{label}</div>
          <div className="text-xs text-slate-600">{description}</div>
        </div>
      </div>
      <div className={`w-9 h-5 rounded-full transition-colors relative ${
        value
          ? dangerWhenOn ? 'bg-red-600' : 'bg-purple-600'
          : 'bg-slate-700'
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      </div>
    </div>
  )
}
