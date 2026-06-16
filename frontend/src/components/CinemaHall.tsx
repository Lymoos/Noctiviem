import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Crown } from 'lucide-react'
import { User, FloatingReaction } from '../types'
import { socket } from '../socket'
import { useStore, selectIsLeader } from '../store'
import ProfileModal from './ProfileModal'
import Avatar from './Avatar'

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
  const [profileUserId, setProfileUserId] = useState<string | null>(null)

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

  const handleTransferLeader = (userId: string) => {
    if (!isLeader) return
    socket.emit('room:transfer_leader', { targetUserId: userId })
  }

  return (
    <div className="relative px-4 pt-2 pb-6">

      {/* Floating reactions */}
      {floatingReactions.map(fr => {
        const p = participants.find(p => p.id === fr.userId)
        if (!p) return null
        const seatCol = (p.seatNumber - 1) % SEATS_PER_ROW
        const leftPercent = (seatCol / (SEATS_PER_ROW - 1)) * 70 + 15
        return (
          <div
            key={fr.id}
            className="floating-reaction"
            style={{ left: `${leftPercent}%`, bottom: '100px' }}
          >
            {fr.emoji}
          </div>
        )
      })}

      {/* Seats — uniform depth: back rows slightly smaller + dimmer, no horizontal
          squish. Seat size is responsive via the --seat CSS var so 8-across always
          fits without overflow. */}
      <div
        className="flex flex-col items-center w-full"
        style={{ ['--seat' as any]: 'clamp(34px, 6vw, 56px)', gap: 'clamp(8px, 1.6vw, 16px)' }}
      >
        {Array.from({ length: MAX_ROWS }, (_, rowIdx) => {
          const t = MAX_ROWS > 1 ? rowIdx / (MAX_ROWS - 1) : 1  // 0 (back) → 1 (front)
          const scale   = 0.9 + t * 0.1                          // 0.90 → 1.00
          const opacity = 0.68 + t * 0.32                        // 0.68 → 1.00

          return (
            <div
              key={rowIdx}
              className="flex items-end justify-center w-full"
              style={{
                transform: `scale(${scale})`,
                opacity,
                transformOrigin: 'center bottom',
                transition: 'transform 0.4s ease, opacity 0.4s ease',
                gap: 'clamp(4px, 1vw, 12px)',
              }}
            >
              <span className="text-[10px] text-slate-700 w-3 flex-shrink-0 text-right select-none hidden sm:block">
                {rowIdx + 1}
              </span>

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
                  onProfile={p => setProfileUserId(p.id)}
                />
              ))}

              <span className="text-[10px] text-slate-700 w-3 flex-shrink-0 select-none hidden sm:block">
                {rowIdx + 1}
              </span>
            </div>
          )
        })}
      </div>

      {/* Reactions bar */}
      <div className="flex items-center justify-center gap-3 mt-6">
        {reactionsEnabled
          ? REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="reaction-btn"
                title={emoji}
              >
                {emoji}
              </button>
            ))
          : <span className="text-xs text-slate-700">Reactions disabled by Leader</span>
        }
      </div>

      {/* Profile modal — rendered via portal to escape transform stacking contexts */}
      {profileUserId && createPortal(
        <ProfileModal
          userId={profileUserId}
          nickname={participants.find(p => p.id === profileUserId)?.nickname ?? ''}
          isLeader={isLeader}
          currentUserId={currentUserId}
          onClose={() => setProfileUserId(null)}
          onTransferLeader={() => handleTransferLeader(profileUserId)}
        />,
        document.body
      )}

      {/* Whisper modal — rendered via portal */}
      {whisperTarget && createPortal(
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
        </div>,
        document.body
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
  onProfile: (p: User) => void
}

function SeatItem({
  seatNum, participant, leaderId, currentUserId, isLeader,
  chatEnabled, bubble, waveActive, onWhisper, onKick, onProfile,
}: SeatItemProps) {
  const isOccupied = !!participant
  const isThisLeader = participant?.id === leaderId
  const isCurrentUser = participant?.id === currentUserId
  const [showMenu, setShowMenu] = useState(false)

  const waveDelay = (seatNum - 1) * 50

  return (
    <div className="cinema-seat">
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
          className={`relative mb-1 cursor-pointer rounded-full transition-transform hover:scale-105 ${
            participant.specialRole === 'miloe-solnyshko'
              ? 'ring-2 ring-rose-400/60'
              : isCurrentUser ? 'ring-2 ring-purple-500'
              : isThisLeader ? 'ring-2 ring-yellow-400/50' : ''
          }`}
          onClick={() => onProfile(participant)}
          title={participant.nickname}
        >
          {participant.specialRole === 'miloe-solnyshko' && (
            <div className="sparkle-cluster" aria-hidden="true">
              <span className="sparkle-item sparkle-1">🌸</span>
              <span className="sparkle-item sparkle-2">✨</span>
              <span className="sparkle-item sparkle-3">🌸</span>
            </div>
          )}
          <Avatar
            seed={participant.id}
            name={participant.nickname}
            src={participant.avatar}
            size="calc(var(--seat) * 0.82)"
          />
        </div>
      )}

      {/* Seat body */}
      <div
        className={`seat-base ${isOccupied ? (isThisLeader ? 'leader' : `occupied seat-${participant?.seatColor || 'default'}`) : ''} ${
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
              onClick={() => { onProfile(participant); setShowMenu(false) }}
              className="menu-item"
            >
              👤 View profile
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
