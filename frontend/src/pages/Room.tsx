import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Crown, Users, MessageSquare, Share2, Settings,
  ArrowLeft, CheckCheck, WifiOff,
  MonitorPlay, Columns, Play, Pause,
} from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import CinemaHall from '../components/CinemaHall'
import Chat from '../components/Chat'
import LeaderPanel from '../components/LeaderPanel'
import Avatar from '../components/Avatar'
import { useStore, selectIsLeader, apiPost } from '../store'
import { socket, connectSocket, getLocalUserId } from '../socket'
import { RoomState, MediaItem, Message, Reaction, User, FloatingReaction } from '../types'
import { SkipForward } from 'lucide-react'

const BUBBLE_DURATION = 4000

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const {
    room, media, currentUser, setRoom, setCurrentUser, clearRoom,
    updateRoomSync, updateRoomSettings, updateParticipants, addParticipant,
    addMessage, deleteMessage, addReaction, changeRoomMedia,
    chatOpen, toggleChat, leaderPanelOpen, toggleLeaderPanel,
    isAuthenticated, setMediaWatchPosition,
  } = useStore()

  const isLeader = useStore(selectIsLeader)
  const userId = getLocalUserId()

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [kicked, setKicked] = useState(false)
  const [copied, setCopied] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'cinema' | 'side'>('cinema')
  const [activeBubbles, setActiveBubbles] = useState<{ [userId: string]: string }>({})
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
  const bubbleTimers = useRef<{ [userId: string]: ReturnType<typeof setTimeout> }>({})
  const [currentVideoTime, setCurrentVideoTime] = useState(0)
  const timeRef = useRef(0)

  const handleTimeUpdate = useCallback((tSec: number) => {
    timeRef.current = tSec
    setCurrentVideoTime(tSec)
  }, [])

  // Join room via socket
  useEffect(() => {
    connectSocket()

    const join = () => {
      if (!roomId) return

      // If store already has this room (e.g. we just created it), use that data
      // but still call room:join to re-establish server-side socket membership
      const storeRoom = useStore.getState().room
      const storeMedia = useStore.getState().media
      const storeUser = useStore.getState().currentUser

      socket.emit('room:join', { roomId }, (res: {
        room: RoomState; user: User; media: MediaItem; userId: string; error?: string
      }) => {
        if (res.error) {
          // If we have local room data (just created), stay in the room
          if (storeRoom?.id === roomId && storeUser) {
            setConnectionStatus('connected')
            return
          }
          setJoinError(res.error)
          return
        }
        setRoom(res.room, res.media)
        setCurrentUser(res.user)
        setConnectionStatus('connected')
      })

      // If store already has room data, consider it connected while waiting for server response
      if (storeRoom?.id === roomId && storeUser && storeMedia) {
        setConnectionStatus('connected')
      }
    }

    if (socket.connected) {
      join()
    } else {
      socket.once('connect', join)
    }

    return () => { socket.off('connect', join) }
  }, [roomId, setRoom, setCurrentUser])

  // Socket event handlers
  useEffect(() => {
    socket.on('room:sync', (data: { currentTime?: number; isPlaying?: boolean; updatedAt: number }) => {
      const update: Partial<Pick<RoomState, 'currentTime' | 'isPlaying'>> = {}
      if (data.currentTime !== undefined) update.currentTime = data.currentTime
      if (data.isPlaying !== undefined) update.isPlaying = data.isPlaying
      updateRoomSync(update)
    })

    socket.on('room:heartbeat', (data: { currentTime: number; isPlaying: boolean }) => {
      updateRoomSync({ currentTime: data.currentTime, isPlaying: data.isPlaying })
    })

    socket.on('room:audio', (data: { audioIndex: number }) => {
      updateRoomSettings({ selectedAudio: data.audioIndex })
    })

    socket.on('room:subs', (data: { subsId: string }) => {
      updateRoomSettings({ selectedSubs: data.subsId })
    })

    socket.on('room:quality', (data: { quality: string }) => {
      updateRoomSettings({ selectedQuality: data.quality })
    })

    socket.on('room:settings_update', (data: Partial<RoomState>) => {
      updateRoomSettings(data as Parameters<typeof updateRoomSettings>[0])
    })

    socket.on('room:participant_join', (data: { participant: User; participants: User[] }) => {
      addParticipant(data.participant, data.participants)
    })

    socket.on('room:participant_leave', (data: { userId: string; participants: User[]; newLeaderId: string }) => {
      updateParticipants(data.participants, data.newLeaderId)
    })

    socket.on('room:message', (msg: Message) => {
      addMessage(msg)
      // Show chat bubble
      if (msg.userId !== userId && !msg.isWhisper) {
        showBubble(msg.userId, msg.text)
      }
    })

    socket.on('room:message_deleted', (data: { messageId: string }) => {
      deleteMessage(data.messageId)
    })

    socket.on('room:reaction', (reaction: Reaction) => {
      addReaction(reaction)
      // Show floating reaction
      const fr: FloatingReaction = {
        id: reaction.id,
        userId: reaction.userId,
        emoji: reaction.emoji,
        seatNumber: 1,
      }
      setFloatingReactions(prev => [...prev, fr])
      setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== fr.id))
      }, 2500)
    })

    socket.on('room:media_changed', (data: { room: RoomState; media: MediaItem }) => {
      changeRoomMedia(data.room, data.media)
    })

    socket.on('room:kicked', () => {
      setKicked(true)
      clearRoom()
      setTimeout(() => navigate('/'), 3000)
    })

    socket.on('disconnect', () => {
      setConnectionStatus('error')
    })

    socket.on('connect', () => {
      setConnectionStatus('connected')
    })

    return () => {
      socket.off('room:sync')
      socket.off('room:heartbeat')
      socket.off('room:audio')
      socket.off('room:subs')
      socket.off('room:quality')
      socket.off('room:settings_update')
      socket.off('room:participant_join')
      socket.off('room:participant_leave')
      socket.off('room:message')
      socket.off('room:message_deleted')
      socket.off('room:reaction')
      socket.off('room:media_changed')
      socket.off('room:kicked')
      socket.off('disconnect')
      socket.off('connect')
    }
  }, [userId, addMessage, addParticipant, addReaction, changeRoomMedia, clearRoom, deleteMessage, navigate, updateParticipants, updateRoomSettings, updateRoomSync])

  // Leave room on unmount — only called on explicit navigation, NOT on F5
  // F5 triggers a socket disconnect; the server has a grace period before
  // removing the user, so the leader stays until they actually leave.
  useEffect(() => {
    return () => {
      clearRoom()
    }
  }, [clearRoom])

  // Persist "continue watching" position for logged-in users (every 15s + on leave)
  useEffect(() => {
    if (!isAuthenticated || !media) return
    const mediaId = media.id
    const duration = media.duration
    const save = () => {
      const pos = timeRef.current
      if (pos > 5) {
        apiPost(`/api/media/${mediaId}/progress`, { position: pos, duration }).catch(() => {})
        setMediaWatchPosition(mediaId, pos, duration)
      }
    }
    const iv = setInterval(save, 15000)
    return () => { save(); clearInterval(iv) }
  }, [isAuthenticated, media, setMediaWatchPosition])

  const showBubble = useCallback((uid: string, text: string) => {
    if (bubbleTimers.current[uid]) clearTimeout(bubbleTimers.current[uid])
    setActiveBubbles(prev => ({ ...prev, [uid]: text.length > 40 ? text.slice(0, 40) + '…' : text }))
    bubbleTimers.current[uid] = setTimeout(() => {
      setActiveBubbles(prev => {
        const next = { ...prev }
        delete next[uid]
        return next
      })
    }, BUBBLE_DURATION)
  }, [])

  const copyInvite = () => {
    if (!room) return
    navigator.clipboard.writeText(`${window.location.origin}/join/${room.inviteCode}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLeave = () => {
    socket.emit('room:leave')
    clearRoom()
    navigate('/')
  }

  // ── Kicked screen ──────────────────────────────────────────────────────────
  if (kicked) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-cinema-text mb-2">You've been removed</h1>
          <p className="text-cinema-muted">The Leader removed you from the hall.</p>
          <button onClick={() => navigate('/')} className="btn-primary mt-6">
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Join error screen ──────────────────────────────────────────────────────
  if (joinError) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-4">🎬</div>
          <h1 className="text-xl font-bold text-cinema-text mb-2">Cannot enter hall</h1>
          <p className="text-cinema-muted text-sm mb-6">{joinError}</p>
          <button onClick={() => navigate('/')} className="btn-primary">
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (!room || !media || !currentUser) {
    return (
      <div className="min-h-screen bg-cinema-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-cinema-muted">Entering the hall…</p>
        </div>
      </div>
    )
  }

  const timer = new Date(currentVideoTime * 1000).toISOString().slice(11, 19)

  return (
    <div className="h-screen bg-cinema-bg flex flex-col overflow-hidden">
      {/* ── TOP BAR ──────────────────────────────────────────────────────────── */}
      <header className="glass-strong px-4 py-2.5 flex items-center gap-3 flex-shrink-0 z-30">
        <button onClick={handleLeave} className="btn-ghost p-2">
          <ArrowLeft size={16} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-cinema-text truncate">{room.name}</h1>
            {isLeader && (
              <span className="text-xs text-yellow-400 flex items-center gap-0.5 flex-shrink-0">
                <Crown size={11} />
                Leader
              </span>
            )}
          </div>
          <p className="text-xs text-cinema-muted truncate">{media.title}</p>
        </div>

        {/* Playback state + timer */}
        <div className="text-xs font-mono flex-shrink-0 hidden sm:flex items-center gap-1.5">
          {room.isPlaying
            ? <Play size={10} fill="currentColor" className="text-green-400" />
            : <Pause size={10} className="text-amber-400" />}
          <span className="text-slate-500">{timer}</span>
        </div>

        {/* Sync status */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {connectionStatus === 'connected' ? (
            <>
              <div className="sync-dot" />
              <span className="text-xs text-slate-500 hidden sm:inline">Sync</span>
            </>
          ) : (
            <>
              <WifiOff size={12} className="text-red-400" />
              <span className="text-xs text-red-400 hidden sm:inline">Lost</span>
            </>
          )}
        </div>

        {/* Participants presence — stacked avatars of who's watching */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex -space-x-2">
            {room.participants.slice(0, 5).map(p => (
              <div key={p.id} className="rounded-full ring-2 ring-cinema-bg" title={p.nickname}>
                <Avatar seed={p.id} name={p.nickname} src={p.avatar} size={22} />
              </div>
            ))}
          </div>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Users size={12} />
            {room.participants.length}
          </span>
        </div>

        {/* Invite */}
        <button
          onClick={copyInvite}
          title={`${window.location.origin}/join/${room.inviteCode}`}
          className="invite-badge flex items-center gap-1.5 text-xs flex-shrink-0"
        >
          {copied ? <CheckCheck size={12} /> : <Share2 size={12} />}
          <span>{copied ? 'Copied!' : 'Invite'}</span>
          <span className="hidden sm:inline text-white/40">· {room.inviteCode}</span>
        </button>

        {/* Leader panel toggle */}
        {isLeader && (
          <div className="relative flex-shrink-0">
            <button
              onClick={toggleLeaderPanel}
              className={`btn-ghost p-2 ${leaderPanelOpen ? 'text-purple-400 bg-purple-900/20' : ''}`}
            >
              <Settings size={15} />
            </button>
            {leaderPanelOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={toggleLeaderPanel} />
                <div className="absolute right-0 top-10 z-50">
                  <LeaderPanel onClose={toggleLeaderPanel} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Chat toggle (cinema mode only) */}
        {layoutMode === 'cinema' && (
          <button
            onClick={toggleChat}
            className={`btn-ghost p-2 flex-shrink-0 ${chatOpen ? 'text-purple-400' : ''}`}
          >
            <MessageSquare size={15} />
          </button>
        )}

        {/* Layout mode toggle */}
        <button
          onClick={() => setLayoutMode(m => m === 'cinema' ? 'side' : 'cinema')}
          title={layoutMode === 'cinema' ? 'Screen + Chat' : 'Cinema Hall'}
          className={`btn-ghost p-2 flex-shrink-0 ${layoutMode === 'side' ? 'text-purple-400' : ''}`}
        >
          {layoutMode === 'cinema' ? <Columns size={15} /> : <MonitorPlay size={15} />}
        </button>
      </header>

      {/* ── MAIN AREA ────────────────────────────────────────────────────────── */}
      {layoutMode === 'side' ? (
        /* ── SIDE MODE: video left + chat right, no overlap ── */
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Video — fills remaining space */}
          <div className="flex-1 min-w-0 min-h-0 bg-black flex flex-col items-stretch relative">
            <div className="flex-1 min-h-0 relative">
              <VideoPlayer
                media={media}
                serverTime={room.currentTime}
                isPlaying={room.isPlaying}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => { if (isLeader) socket.emit('room:next_episode') }}
              />
            </div>

            {/* Up Next banner */}
            {room.queuedMediaId && (
              <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 glass-strong rounded-xl px-4 py-2.5 border border-blue-500/20 animate-fade-in">
                {room.queuedMediaPoster && (
                  <img
                    src={room.queuedMediaPoster}
                    alt={room.queuedMediaTitle ?? ''}
                    className="w-8 h-11 object-cover rounded flex-shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-500 leading-none mb-0.5">Up next</p>
                  <p className="text-xs font-medium text-cinema-text truncate max-w-[140px]">{room.queuedMediaTitle}</p>
                </div>
                {isLeader && (
                  <button
                    onClick={() => socket.emit('room:play_next')}
                    className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors flex-shrink-0 ml-1"
                  >
                    <SkipForward size={14} />
                    <span className="hidden sm:inline">Play now</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Chat panel — fixed width, always visible, flush with video */}
          <div className="w-80 flex-shrink-0 border-l border-white/10 flex flex-col bg-[#0d0f13]">
            <Chat
              messages={room.messages}
              currentUserId={userId}
              chatEnabled={room.chatEnabled}
              onClose={() => setLayoutMode('cinema')}
            />
          </div>
        </div>
      ) : (
        /* ── CINEMA MODE: video + seats + optional chat overlay ── */
        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Left: Cinema stage */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden cinema-room-stage">

            {/* ── Screen section ── */}
            <div className="flex-shrink-0 flex justify-center relative cinema-screen-enter px-0 pt-5">
              <div className="cinema-curtain-l" />
              <div className="cinema-curtain-r" />

              <div className="cinema-screen-frame aspect-video" style={{ width: '72%', maxWidth: 'calc(56vh * (16 / 9))' }}>
                <VideoPlayer
                  media={media}
                  serverTime={room.currentTime}
                  isPlaying={room.isPlaying}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => { if (isLeader) socket.emit('room:next_episode') }}
                />
              </div>

              {/* Up Next banner */}
              {room.queuedMediaId && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 glass-strong rounded-xl px-4 py-2.5 border border-blue-500/20 animate-fade-in">
                  {room.queuedMediaPoster && (
                    <img
                      src={room.queuedMediaPoster}
                      alt={room.queuedMediaTitle ?? ''}
                      className="w-8 h-11 object-cover rounded flex-shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[10px] text-slate-500 leading-none mb-0.5">Up next</p>
                    <p className="text-xs font-medium text-cinema-text truncate max-w-[140px]">{room.queuedMediaTitle}</p>
                  </div>
                  {isLeader && (
                    <button
                      onClick={() => socket.emit('room:play_next')}
                      className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors flex-shrink-0 ml-1"
                      title="Switch to queued film now"
                    >
                      <SkipForward size={14} />
                      <span className="hidden sm:inline">Play now</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="stage-edge" />
            <div className="screen-floor-glow" />

            {/* ── Seats ── */}
            <div className="flex-1 overflow-y-auto min-h-0 cinema-hall-enter">
              <CinemaHall
                participants={room.participants}
                leaderId={room.leaderId}
                currentUserId={userId}
                chatEnabled={room.chatEnabled}
                reactionsEnabled={room.reactionsEnabled}
                activeBubbles={activeBubbles}
                floatingReactions={floatingReactions}
                currentTime={currentVideoTime}
              />
            </div>
          </div>

          {/* Right: Chat overlay */}
          {chatOpen && (
            <div className="fixed inset-0 z-50 sm:inset-auto sm:right-0 sm:top-14 sm:bottom-0 w-full sm:w-80 flex flex-col border-l border-white/5 bg-cinema-bg/95 backdrop-blur-sm animate-slide-in-right">
              <Chat
                messages={room.messages}
                currentUserId={userId}
                chatEnabled={room.chatEnabled}
                onClose={toggleChat}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
