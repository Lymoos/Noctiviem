import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Users, Lock, Film, ArrowRight, Edit2, KeyRound, UserCheck } from 'lucide-react'
import { socket, connectSocket } from '../socket'
import { useStore } from '../store'
import { RoomState, MediaItem, User } from '../types'

interface RoomPreview {
  id: string
  name: string
  mediaTitle: string
  mediaPoster: string
  participantCount: number
  maxParticipants: number
  isLocked: boolean
  hasPassword: boolean
  friendsOnly: boolean
}

export default function Join() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const navigate = useNavigate()
  const { setRoom, setCurrentUser, nickname: storedNickname, isAuthenticated } = useStore()

  const [preview, setPreview] = useState<RoomPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guestNickname, setGuestNickname] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => { setGuestNickname(storedNickname) }, [storedNickname])

  useEffect(() => {
    if (!inviteCode) { navigate('/'); return }
    fetch(`/api/rooms/invite/${inviteCode}`)
      .then(r => {
        if (!r.ok) throw new Error('Room not found')
        return r.json()
      })
      .then(data => { setPreview(data); setLoading(false) })
      .catch(() => { setError('This invite link is invalid or the hall has ended.'); setLoading(false) })
  }, [inviteCode, navigate])

  const effectiveNickname = isAuthenticated ? storedNickname : (guestNickname.trim() || storedNickname)

  const handleJoin = () => {
    if (!preview || !effectiveNickname.trim()) return
    if (preview.hasPassword && !password.trim()) return
    if (!isAuthenticated && guestNickname.trim()) {
      localStorage.setItem('noctiviem_nickname', guestNickname.trim())
    }
    setJoining(true)
    connectSocket()

    const join = () => {
      socket.emit('room:join', { roomId: preview.id, password: password || undefined }, (res: {
        room: RoomState; user: User; media: MediaItem; userId: string; error?: string
      }) => {
        if (res.error) { setError(res.error); setJoining(false); return }
        setRoom(res.room, res.media)
        setCurrentUser(res.user)
        navigate(`/room/${res.room.id}`)
      })
    }

    if (socket.connected) join()
    else socket.once('connect', join)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🎬</div>
          <h1 className="text-xl font-bold text-cinema-text mb-2">Hall not found</h1>
          <p className="text-cinema-muted text-sm mb-6">{error || 'This hall no longer exists.'}</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const canJoin = !preview.isLocked && !!effectiveNickname.trim() && (!preview.hasPassword || !!password.trim())

  return (
    <div className="min-h-screen bg-cinema-bg flex items-center justify-center p-4">
      {/* Ambient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-purple-600/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-blue-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md w-full">
        {/* Card */}
        <div className="glass-strong rounded-2xl overflow-hidden"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(124,58,237,0.1)' }}>

          {/* Poster header */}
          <div className="relative h-40 overflow-hidden">
            <img
              src={preview.mediaPoster}
              alt={preview.mediaTitle}
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${preview.id}/500/200` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-cinema-bg/90" />
            <div className="absolute bottom-3 left-4 right-4">
              <h1 className="text-lg font-bold text-white truncate">{preview.name}</h1>
              <p className="text-sm text-white/60 truncate">{preview.mediaTitle}</p>
            </div>

            {/* Noctiviem badge */}
            <div className="absolute top-3 left-4 flex items-center gap-1.5 glass px-2 py-1 rounded-full">
              <Film size={11} className="text-purple-400" />
              <span className="text-xs font-semibold accent-gradient-text">Noctiviem</span>
            </div>
          </div>

          {/* Body */}
          <div className="p-6">
            <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Users size={14} />
                <span>{preview.participantCount}/{preview.maxParticipants} viewers</span>
              </div>
              <div className="flex items-center gap-2">
                {preview.isLocked && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <Lock size={14} /><span>Hall is locked</span>
                  </div>
                )}
                {preview.hasPassword && !preview.isLocked && (
                  <div className="flex items-center gap-1.5 text-sm text-yellow-400">
                    <KeyRound size={14} /><span>Password required</span>
                  </div>
                )}
                {preview.friendsOnly && !preview.isLocked && (
                  <div className="flex items-center gap-1.5 text-sm text-blue-400">
                    <UserCheck size={14} /><span>Friends only</span>
                  </div>
                )}
              </div>
            </div>

            {isAuthenticated ? (
              <>
                <div className="text-xs text-slate-500 mb-2">Joining as</div>
                <div className="flex items-center gap-2 glass rounded-lg px-3 py-2 mb-5">
                  <div className="w-6 h-6 rounded-full accent-gradient flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {storedNickname.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-sm text-cinema-text">{storedNickname}</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                  <Edit2 size={11} /> Enter your nickname
                </div>
                <input
                  type="text"
                  value={guestNickname}
                  onChange={e => setGuestNickname(e.target.value.slice(0, 24))}
                  onKeyDown={e => e.key === 'Enter' && canJoin && handleJoin()}
                  placeholder="Your nickname…"
                  className="input-field w-full mb-1"
                  autoFocus maxLength={24}
                />
                <p className="text-xs text-slate-600 mb-4">No account needed — joining as guest</p>
              </>
            )}

            {/* Password input */}
            {preview.hasPassword && (
              <div className="mb-5">
                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                  <KeyRound size={11} /> Hall password
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && canJoin && handleJoin()}
                  placeholder="Enter password…"
                  className="input-field w-full"
                  style={{ paddingLeft: '14px' }}
                  autoFocus={isAuthenticated}
                />
              </div>
            )}

            {error && (
              <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2">
                <span>⚠</span><span>{error}</span>
              </div>
            )}

            <button
              onClick={handleJoin}
              disabled={joining || !canJoin}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {joining
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Entering hall…</>
                : preview.isLocked
                  ? <><Lock size={14} /> Hall is locked</>
                  : <><ArrowRight size={14} /> Enter Cinema Hall</>
              }
            </button>

            {!isAuthenticated && (
              <p className="text-center text-xs text-slate-600 mt-4">
                Have an account?{' '}
                <button onClick={() => navigate('/login')} className="text-purple-400 hover:text-purple-300 transition-colors">
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
