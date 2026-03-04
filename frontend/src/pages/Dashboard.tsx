import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Clapperboard, Upload, Plus, Film, Users, Zap, HardDrive, Search } from 'lucide-react'
import Navbar from '../components/Navbar'
import MediaCard from '../components/MediaCard'
import DownloadingCard from '../components/DownloadingCard'
import RoomCard from '../components/RoomCard'
import CreateRoomModal from '../components/CreateRoomModal'
import { useStore, apiFetch, apiDelete, apiPost } from '../store'
import { translations } from '../i18n'
import { socket, connectSocket } from '../socket'
import { MediaItem, RoomState, User } from '../types'

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1_073_741_824) return `${(b / 1_048_576).toFixed(1)} MB`
  return `${(b / 1_073_741_824).toFixed(2)} GB`
}

function StorageStat({ bytes }: { bytes: number | null }) {
  if (bytes === null) return null
  const color = bytes > 50_000_000_000 ? 'text-red-400' : bytes > 20_000_000_000 ? 'text-yellow-400' : 'text-emerald-400'
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <HardDrive size={14} className={color} />
      <span className={color}>{formatBytes(bytes)}</span>
      <span>на диске</span>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { setMediaLibrary, mediaLibrary, downloads, setRoom, setCurrentUser, nickname, toggleDownloads, lang } = useStore()
  const t = translations[lang]
  const [loading, setLoading] = useState(true)
  const [createError, setCreateError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [preselectedMedia, setPreselectedMedia] = useState<string | undefined>()
  const [myRooms, setMyRooms] = useState<{ id: string; name: string; mediaTitle: string; mediaPoster: string; participantCount: number; maxParticipants: number; isPlaying: boolean; isLocked: boolean; isLeader: boolean }[]>([])
  const [storageBytes, setStorageBytes] = useState<number | null>(null)

  useEffect(() => {
    apiFetch<MediaItem[]>('/api/media')
      .then(data => {
        if (!Array.isArray(data)) return
        setMediaLibrary(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [setMediaLibrary])

  // Storage usage — refresh on mount and whenever media library or downloads change
  useEffect(() => {
    apiFetch<{ totalBytes: number }>('/api/storage/stats')
      .then(s => { if (!s.error) setStorageBytes(s.totalBytes) })
      .catch(() => {})
  }, [mediaLibrary.length, downloads.length])

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

  const handleRedownloadMedia = useCallback(async (id: string) => {
    const r = await apiPost(`/api/media/${id}/redownload`, {})
    if (r.error) alert(r.error)
    // 'media:updated' socket event will refresh the library;
    // download progress appears in the Downloads panel
  }, [])

  const filtered = mediaLibrary.filter(m =>
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.genre.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const readyMedia = filtered.filter(m => m.status === 'ready')
  const processingMedia = filtered.filter(m => m.status !== 'ready')

  // Active downloads that don't yet have a media entry — shown as "in-coming" cards
  const downloadingItems = downloads.filter(d =>
    (d.status === 'queued' || d.status === 'metadata' || d.status === 'downloading') &&
    d.mediaIds.length === 0
  )

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
      <div className="relative px-4 sm:px-6 pt-6 sm:pt-10 pb-6 sm:pb-8 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-purple-600/5 blur-3xl" />
          <div className="absolute -top-10 right-20 w-64 h-64 rounded-full bg-blue-600/5 blur-3xl" />
        </div>
        <div className="relative">
          <h1 className="text-2xl sm:text-3xl font-bold text-cinema-text">
            {t.welcomeBackUser}{' '}
            <span className="accent-gradient-text">{nickname}</span>
          </h1>
          <p className="text-cinema-muted mt-1.5 text-sm sm:text-base">{t.readyToStart}</p>

          <div className="flex items-center gap-3 sm:gap-6 mt-4 sm:mt-5 flex-wrap">
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
            <StorageStat bytes={storageBytes} />
          </div>
        </div>
      </div>

      {/* Mobile search bar — only visible on small screens */}
      <div className="px-4 pb-2 sm:hidden">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none z-10" />
          <input
            type="text"
            placeholder={t.searchLibrary}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="input-field py-2 text-sm w-full"
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
      </div>

      <div className="px-4 sm:px-6 pb-16 space-y-8 sm:space-y-12">
        {/* ── MY MEDIA LIBRARY ── */}
        <section>
          <div className="section-header">
            <Library size={16} className="text-purple-400" />
            <h2 className="section-title">{t.myMediaLibrary}</h2>
            <div className="section-line" />
            {!loading && (
              <span className="text-xs text-slate-500">
                {readyMedia.length} {t.filmsCount}
                {(processingMedia.length + downloadingItems.length) > 0 && (
                  <span className="text-purple-400 ml-2">
                    +{processingMedia.length + downloadingItems.length} загружается
                  </span>
                )}
              </span>
            )}
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl bg-cinema-card animate-pulse" />
              ))}
            </div>
          ) : readyMedia.length === 0 && processingMedia.length === 0 && downloadingItems.length === 0 ? (
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
              {/* Downloading items first (in-progress, sorted by queue order) */}
              {downloadingItems.map(item => (
                <DownloadingCard key={item.id} item={item} />
              ))}
              {/* Processing (remuxing/converting) */}
              {processingMedia.map(item => (
                <MediaCard key={item.id} item={item} />
              ))}
              {/* Ready to watch */}
              {readyMedia.map(item => (
                <MediaCard
                  key={item.id}
                  item={item}
                  onWatch={() => handleOpenCreate(item.id)}
                  onCreateRoom={() => handleOpenCreate(item.id)}
                  onDelete={() => handleDeleteMedia(item.id)}
                  onRedownload={() => handleRedownloadMedia(item.id)}
                />
              ))}
            </div>
          )}
        </section>

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
