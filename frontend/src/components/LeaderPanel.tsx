import { X, MessageSquare, Smile, Lock, Unlock, Users } from 'lucide-react'
import { socket } from '../socket'
import { useStore } from '../store'

interface LeaderPanelProps {
  onClose: () => void
}

export default function LeaderPanel({ onClose }: LeaderPanelProps) {
  const room = useStore(s => s.room)
  if (!room) return null

  const toggle = (key: 'chatEnabled' | 'reactionsEnabled' | 'isLocked', currentVal: boolean) => {
    switch (key) {
      case 'chatEnabled':
        socket.emit('room:chat_toggle', { enabled: !currentVal })
        break
      case 'reactionsEnabled':
        socket.emit('room:reactions_toggle', { enabled: !currentVal })
        break
      case 'isLocked':
        socket.emit('room:lock', { locked: !currentVal })
        break
    }
  }

  return (
    <div className="menu-dropdown w-72 animate-fade-in">
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

      <div className="p-3 space-y-2">
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
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/join/${room.inviteCode}`)
              }}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              Copy link
            </button>
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-1 pt-1">
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
            <div className="space-y-1 max-h-40 overflow-y-auto">
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
