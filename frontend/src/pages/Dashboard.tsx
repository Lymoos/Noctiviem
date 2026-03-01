import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Download, Clapperboard, Upload, Plus, Film, Users, Zap } from 'lucide-react'
import Navbar from '../components/Navbar'
import MediaCard from '../components/MediaCard'
import RoomCard from '../components/RoomCard'
import CreateRoomModal from '../components/CreateRoomModal'
import { useStore, apiFetch, apiDelete } from '../store'
import { translations } from '../i18n'
import { socket, connectSocket } from '../socket'
import { MediaItem, RoomState, User } from '../types'

export default function Dashboard() {
  const navigate = useNavigate()
  const { setMediaLibrary, mediaLibrary, setRoom, setCurrentUser, nickname, toggleDownloads, lang } = useStore()
  const t = translations[lang]
  const [loading, setLoading] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [preselectedMedia, setPreselectedMedia] = useState<string | undefined>()
  const [myRooms, setMyRooms] = useState<{ id: string; name: string; mediaTitle: string; mediaPoster: string; participantCount: number; maxParticipants: number; isPlaying: boolean; isLocked: boolean; isLeader: boolean }[]>([])

  useEffect(() => {
    apiFetch<MediaItem[]>('/api/media')
      .then(data => {
        if (!Array.isArray(data)) return
        setMediaLibrary(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [setMediaLibrary])

  useEffect(() => {
    connectSocket()

    socket.on('media:updated', (items: MediaItem[]) => {
      setMediaLibrary(items)
    })

    return () => { socket.off('media:updated') }
  }, [setMediaLibrary])

  const handleCreateRoom = useCallback((data: { name: string; mediaId: string; maxParticipants: number }) => {
    setCreateModalOpen(false)
    setCreateError(null)

    const emit = () => {
      socket.emit('room:create', data, (res: { room: RoomState; media: MediaItem; userId: string; error?: string }) => {
        if (res.error) {
          setCreateError(res.error)
          return
        }
        setRoom(res.room, res.media)
        const me = res.room.participants.find((p: User) => p.id === res.userId)
        if (me) setCurrentUser(me)
        navigate(`/room/${res.room.id}`)
      })
    }

    if (socket.connected) {
      emit()
    } else {
      socket.once('connect', emit)
    }
  }, [navigate, setRoom, setCurrentUser])

  const handleOpenCreate = (mediaId?: string) => {
    setPreselectedMedia(mediaId)
    setCreateModalOpen(true)
  }

  const handleDeleteMedia = useCallback(async (id: string) => {
    await apiDelete(`/api/media/${id}`)
    // The 'media:updated' socket event will refresh the library
  }, [])

  const filtered = mediaLibrary.filter(m =>
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.genre.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const readyMedia = filtered.filter(m => m.status === 'ready')
  const processingMedia = filtered.filter(m => m.status !== 'ready')

  return (
    <div className="min-h-screen bg-cinema-bg">
      <Navbar
        onCreateRoom={() => handleOpenCreate()}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {createError && (
        <div className="mx-6 mt-4 flex items-center justify-between glass rounded-xl px-4 py-3 border border-red-500/20">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <span>⚠</span>
            <span>{createError}</span>
          </div>
          <button onClick={() => setCreateError(null)} className="text-slate-500 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Hero section */}
      <div className="relative px-6 pt-10 pb-8 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-purple-600/5 blur-3xl" />
          <div className="absolute -top-10 right-20 w-64 h-64 rounded-full bg-blue-600/5 blur-3xl" />
        </div>
        <div className="relative">
          <h1 className="text-3xl font-bold text-cinema-text">
            {t.welcomeBackUser}{' '}
            <span className="accent-gradient-text">{nickname}</span>
          </h1>
          <p className="text-cinema-muted mt-1.5">{t.readyToStart}</p>

          <div className="flex items-center gap-6 mt-5">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Film size={14} className="text-purple-400" />
              <span>{mediaLibrary.filter(m => m.status === 'ready').length} {t.filmsReady}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clapperboard size={14} className="text-blue-400" />
              <span>{myRooms.length} {t.activeHallsStat}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Zap size={14} className="text-green-400" />
              <span>{t.syncReady}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-16 space-y-12">
        {/* ── MY MEDIA LIBRARY ── */}
        <section>
          <div className="section-header">
            <Library size={16} className="text-purple-400" />
            <h2 className="section-title">{t.myMediaLibrary}</h2>
            <div className="section-line" />
            {!loading && (
              <span className="text-xs text-slate-500">{readyMedia.length} {t.filmsCount}</span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-cinema-card animate-pulse" />
              ))}
            </div>
          ) : readyMedia.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-2xl accent-gradient flex items-center justify-center mb-4 opacity-30">
                <Film size={28} className="text-white" />
              </div>
              <p className="text-cinema-muted text-sm">{t.noFilmsYet}</p>
              <p className="text-xs text-slate-600 mt-1 mb-4">{t.importTorrentToStart}</p>
              <button onClick={toggleDownloads} className="btn-primary mt-2 text-sm flex items-center gap-2">
                <Upload size={13} />
                {t.openDownloads}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {readyMedia.map(item => (
                <MediaCard
                  key={item.id}
                  item={item}
                  onWatch={() => handleOpenCreate(item.id)}
                  onCreateRoom={() => handleOpenCreate(item.id)}
                  onDelete={() => handleDeleteMedia(item.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── DOWNLOADING / PROCESSING ── */}
        {processingMedia.length > 0 && (
          <section>
            <div className="section-header">
              <Download size={16} className="text-blue-400" />
              <h2 className="section-title">{t.processing}</h2>
              <div className="section-line" />
              <span className="text-xs text-slate-500">{processingMedia.length} {t.filesCount}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {processingMedia.map(item => (
                <MediaCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* ── MY HALLS ── */}
        <section>
          <div className="section-header">
            <Clapperboard size={16} className="text-green-400" />
            <h2 className="section-title">{t.activeHallsSection}</h2>
            <div className="section-line" />
            <button
              onClick={() => handleOpenCreate()}
              className="btn-ghost text-xs flex items-center gap-1 py-1"
            >
              <Plus size={12} />
              {t.newHall}
            </button>
          </div>

          {myRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cinema-card flex items-center justify-center mb-3 opacity-30">
                <Users size={24} className="text-slate-500" />
              </div>
              <p className="text-cinema-muted text-sm">{t.noActiveHalls}</p>
              <p className="text-xs text-slate-600 mt-1 mb-4">{t.createHallInvite}</p>
              <button
                onClick={() => handleOpenCreate()}
                className="btn-primary text-sm flex items-center gap-2"
              >
                <Plus size={13} />
                {t.createAHall}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {myRooms.map(room => (
                <RoomCard key={room.id} {...room} />
              ))}
            </div>
          )}
        </section>
      </div>

      {createModalOpen && (
        <CreateRoomModal
          media={mediaLibrary}
          preselectedMediaId={preselectedMedia}
          onClose={() => setCreateModalOpen(false)}
          onCreate={handleCreateRoom}
        />
      )}
    </div>
  )
}
