import { useState, useEffect, useCallback } from 'react'
import { Crown, Mic, MicOff } from 'lucide-react'
import { User, FloatingReaction } from '../types'
import { socket } from '../socket'
import { useStore, selectIsLeader } from '../store'

interface CinemaHallProps {
  participants: User[]
  leaderId: string
  currentUserId: string
  chatEnabled: boolean
  reactionsEnabled: boolean
  activeBubbles: { [userId: string]: string }
  floatingReactions: FloatingReaction[]
  currentTime: number
}

const REACTION_EMOJIS = ['😂', '😱', '🔥', '👏', '❤️']
const SEATS_PER_ROW = 8
const MAX_ROWS = 3

export default function CinemaHall({
  participants,
  leaderId,
  currentUserId,
  chatEnabled,
  reactionsEnabled,
  activeBubbles,
  floatingReactions,
  currentTime,
}: CinemaHallProps) {
  const isLeader = useStore(selectIsLeader)
  const [whisperTarget, setWhisperTarget] = useState<User | null>(null)
  const [whisperText, setWhisperText] = useState('')
  const [waveActive, setWaveActive] = useState(false)

  const totalSeats = MAX_ROWS * SEATS_PER_ROW
  const seats = Array.from({ length: totalSeats }, (_, i) => {
    const seatNum = i + 1
    const participant = participants.find(p => p.seatNumber === seatNum)
    return { seatNum, participant }
  })

  // Clap wave effect
  useEffect(() => {
    const handler = (reaction: { emoji: string }) => {
      if (reaction.emoji === '👏') {
        setWaveActive(true)
        setTimeout(() => setWaveActive(false), 800)
      }
    }
    socket.on('room:reaction', handler)
    return () => { socket.off('room:reaction', handler) }
  }, [])

  const sendReaction = (emoji: string) => {
    if (!reactionsEnabled) return
    socket.emit('room:reaction', { emoji, currentTime })
  }

  const sendWhisper = () => {
    if (!whisperTarget || !whisperText.trim()) return
    socket.emit('room:whisper', {
      targetUserId: whisperTarget.id,
      text: whisperText.trim(),
    })
    setWhisperText('')
    setWhisperTarget(null)
  }

  const handleKick = (userId: string) => {
    if (!isLeader) return
    if (confirm('Remove this viewer from the hall?')) {
      socket.emit('room:kick', { targetUserId: userId })
    }
  }

  return (
    <div className="relative">
      {/* Screen glow reflection */}
      <div className="h-1 mx-12 rounded-full mb-3"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(124,58,237,0.3), rgba(59,130,246,0.3), transparent)' }}
      />

      {/* Hall container */}
      <div className="glass rounded-2xl p-5 relative overflow-hidden"
        style={{ background: 'rgba(10,12,16,0.6)' }}>

        {/* Ambient lighting from screen */}
        <div className="absolute top-0 left-0 right-0 h-8 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(124,58,237,0.08), transparent)' }}
        />

        {/* Floating reactions */}
        {floatingReactions.map(fr => {
          const p = participants.find(p => p.id === fr.userId)
          if (!p) return null
          const seatCol = (p.seatNumber - 1) % SEATS_PER_ROW
          const leftPercent = (seatCol / (SEATS_PER_ROW - 1)) * 80 + 10
          return (
            <div
              key={fr.id}
              className="floating-reaction"
              style={{ left: `${leftPercent}%`, bottom: '60px' }}
            >
              {fr.emoji}
            </div>
          )
        })}

        {/* Seats grid */}
        <div className="space-y-3">
          {Array.from({ length: MAX_ROWS }, (_, rowIdx) => (
            <div key={rowIdx} className="flex items-end justify-center gap-2">
              {/* Row number */}
              <span className="text-xs text-slate-700 w-4 flex-shrink-0 text-right">{rowIdx + 1}</span>

              {/* Seats */}
              {seats.slice(rowIdx * SEATS_PER_ROW, (rowIdx + 1) * SEATS_PER_ROW).map(({ seatNum, participant }) => (
                <SeatItem
                  key={seatNum}
                  seatNum={seatNum}
                  participant={participant}
                  leaderId={leaderId}
                  currentUserId={currentUserId}
                  isLeader={isLeader}
                  chatEnabled={chatEnabled}
                  bubble={participant ? activeBubbles[participant.id] : undefined}
                  waveActive={waveActive}
                  onWhisper={p => p.id !== currentUserId && setWhisperTarget(p)}
                  onKick={handleKick}
                  rowIndex={rowIdx}
                />
              ))}

              <span className="text-xs text-slate-700 w-4 flex-shrink-0">{rowIdx + 1}</span>
            </div>
          ))}
        </div>

        {/* Reactions bar */}
        {reactionsEnabled && (
          <div className="flex items-center justify-center gap-2 mt-5 pt-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            {REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="reaction-btn"
                title={emoji}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {!reactionsEnabled && (
          <div className="text-center text-xs text-slate-600 mt-4 pt-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            Reactions disabled by Leader
          </div>
        )}
      </div>

      {/* Whisper modal */}
      {whisperTarget && (
        <div className="modal-backdrop" onClick={() => setWhisperTarget(null)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-cinema-text mb-1">
              🤫 Whisper to <span className="text-purple-400">{whisperTarget.nickname}</span>
            </h3>
            <p className="text-xs text-cinema-muted mb-4">Only they will see this message</p>
            <input
              type="text"
              value={whisperText}
              onChange={e => setWhisperText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendWhisper()}
              className="input-field mb-3"
              placeholder="Whisper something…"
              maxLength={200}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setWhisperTarget(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={sendWhisper} disabled={!whisperText.trim()} className="btn-primary flex-1">
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Single Seat ─────────────────────────────────────────────────────────────
interface SeatItemProps {
  seatNum: number
  participant?: User
  leaderId: string
  currentUserId: string
  isLeader: boolean
  chatEnabled: boolean
  bubble?: string
  waveActive: boolean
  onWhisper: (p: User) => void
  onKick: (userId: string) => void
  rowIndex: number
}

function SeatItem({
  seatNum, participant, leaderId, currentUserId, isLeader,
  chatEnabled, bubble, waveActive, onWhisper, onKick, rowIndex,
}: SeatItemProps) {
  const isOccupied = !!participant
  const isThisLeader = participant?.id === leaderId
  const isCurrentUser = participant?.id === currentUserId
  const [showMenu, setShowMenu] = useState(false)

  const waveDelay = (seatNum - 1) * 50

  return (
    <div className="cinema-seat" style={{ width: 52 }}>
      {/* Chat bubble */}
      {bubble && chatEnabled && (
        <div className="chat-bubble animate-bubble-in">
          {bubble}
        </div>
      )}

      {/* Crown for leader */}
      {isThisLeader && (
        <div className="leader-crown">👑</div>
      )}

      {/* Avatar above seat */}
      {participant && (
        <div
          className={`relative mb-1 cursor-pointer ${isCurrentUser ? 'ring-2 ring-purple-500 rounded-full' : ''}`}
          onClick={() => !isCurrentUser && setShowMenu(!showMenu)}
        >
          <img
            src={participant.avatar}
            alt={participant.nickname}
            className="w-8 h-8 rounded-full"
            style={{ filter: isCurrentUser ? 'none' : 'brightness(0.9)' }}
            onError={e => {
              (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/thumbs/svg?seed=${participant.id}`
            }}
          />
        </div>
      )}

      {/* Seat body */}
      <div
        className={`seat-base ${isOccupied ? (isThisLeader ? 'leader' : 'occupied') : ''} ${
          waveActive ? 'animate-wave' : ''
        }`}
        style={waveActive ? { animationDelay: `${waveDelay}ms` } : undefined}
      >
        <div className="seat-armrest-left" />
        <div className="seat-armrest-right" />

        {/* Seat number for empty */}
        {!isOccupied && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-white/10">{seatNum}</span>
          </div>
        )}
      </div>

      {/* Nickname */}
      {participant && (
        <div className={`text-center mt-1 text-xs truncate w-full px-1 ${
          isCurrentUser ? 'text-purple-300' : 'text-slate-500'
        }`}>
          {participant.nickname.length > 7
            ? participant.nickname.slice(0, 7) + '…'
            : participant.nickname}
        </div>
      )}

      {/* Context menu */}
      {showMenu && participant && !isCurrentUser && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowMenu(false)}
          />
          <div className="menu-dropdown absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 min-w-36">
            <div className="px-3 py-2 border-b border-white/5">
              <div className="text-xs font-medium text-cinema-text">{participant.nickname}</div>
              {isThisLeader && <div className="text-xs text-yellow-400">👑 Leader</div>}
            </div>
            <div
              onClick={() => { onWhisper(participant); setShowMenu(false) }}
              className="menu-item"
            >
              🤫 Whisper
            </div>
            {isLeader && !isThisLeader && (
              <div
                onClick={() => { onKick(participant.id); setShowMenu(false) }}
                className="menu-item text-red-400 hover:bg-red-500/10"
              >
                Remove from hall
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
