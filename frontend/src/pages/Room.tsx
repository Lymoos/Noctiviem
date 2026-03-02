import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Crown, Users, MessageSquare, Share2, Settings,
  ArrowLeft, Copy, CheckCheck, Wifi, WifiOff, X
} from 'lucide-react'
import VideoPlayer from '../components/VideoPlayer'
import CinemaHall from '../components/CinemaHall'
import Chat from '../components/Chat'
import LeaderPanel from '../components/LeaderPanel'
import { useStore, selectIsLeader } from '../store'
import { socket, connectSocket, getLocalUserId } from '../socket'
import { RoomState, MediaItem, Message, Reaction, User, FloatingReaction } from '../types'

const BUBBLE_DURATION = 4000

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const {
    room, media, currentUser, setRoom, setCurrentUser, clearRoom,
    updateRoomSync, updateRoomSettings, updateParticipants, addParticipant,
    addMessage, deleteMessage, addReaction,
    chatOpen, toggleChat, leaderPanelOpen, toggleLeaderPanel,
  } = useStore()

  const isLeader = useStore(selectIsLeader)
  const userId = getLocalUserId()

  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [kicked, setKicked] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeBubbles, setActiveBubbles] = useState<{ [userId: string]: string }>({})
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([])
  const bubbleTimers = useRef<{ [userId: string]: ReturnType<typeof setTimeout> }>({})
  const [currentVideoTime, setCurrentVideoTime] = useState(0)

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
      socket.off('room:kicked')
      socket.off('disconnect')
      socket.off('connect')
    }
  }, [userId, addMessage, addParticipant, addReaction, clearRoom, deleteMessage, navigate, updateParticipants, updateRoomSettings, updateRoomSync])

  // Leave room on unmount
  useEffect(() => {
    return () => {
      socket.emit('room:leave')
      clearRoom()
    }
  }, [clearRoom])

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

        {/* Timer */}
        <div className="text-xs font-mono text-slate-500 flex-shrink-0 hidden sm:block">
          {timer}
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

        {/* Participants */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-shrink-0">
          <Users size={13} />
          <span>{room.participants.length}</span>
        </div>

        {/* Invite */}
        <button
          onClick={copyInvite}
          className="invite-badge flex items-center gap-1.5 text-xs flex-shrink-0"
        >
          {copied ? <CheckCheck size={12} /> : <Share2 size={12} />}
          <span className="hidden sm:inline">{copied ? 'Copied!' : room.inviteCode}</span>
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

        {/* Chat toggle */}
        <button
          onClick={toggleChat}
          className={`btn-ghost p-2 flex-shrink-0 ${chatOpen ? 'text-purple-400' : ''}`}
        >
          <MessageSquare size={15} />
        </button>
      </header>

      {/* ── MAIN AREA ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Left: Cinema stage */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden cinema-room-stage">

          {/* ── Screen section ── */}
          <div className="flex-shrink-0 flex justify-center relative cinema-screen-enter px-0 pt-5">
            {/* Curtain decorations flanking the screen */}
            <div className="cinema-curtain-l" />
            <div className="cinema-curtain-r" />

            {/* Cinema screen frame */}
            <div className="cinema-screen-frame" style={{ width: '72%' }}>
              <VideoPlayer
                media={media}
                serverTime={room.currentTime}
                isPlaying={room.isPlaying}
                onTimeUpdate={setCurrentVideoTime}
              />
            </div>
          </div>

          {/* Stage edge — glowing divider between screen and seats */}
          <div className="stage-edge" />

          {/* Screen ambient spill onto "floor" */}
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

        {/* Right: Chat */}
        {chatOpen && (
          <div className="w-72 flex-shrink-0 border-l border-white/5 flex flex-col min-h-0 animate-slide-in-right">
            <Chat
              messages={room.messages}
              currentUserId={userId}
              chatEnabled={room.chatEnabled}
              onClose={toggleChat}
            />
          </div>
        )}
      </div>
    </div>
  )
}
