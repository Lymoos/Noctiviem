import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Library, Download, Clapperboard, Plug, RefreshCw, Plus, Film, Users, Zap } from 'lucide-react'
import Navbar from '../components/Navbar'
import MediaCard from '../components/MediaCard'
import RoomCard from '../components/RoomCard'
import CreateRoomModal from '../components/CreateRoomModal'
import { useStore } from '../store'
import { socket, connectSocket, getLocalUserId } from '../socket'
import { MediaItem, RoomState } from '../types'

const DEMO_ROOMS = [
  { id: 'demo1', name: 'Friday Night 🎬', mediaTitle: 'Big Buck Bunny', mediaPoster: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/400px-Big_buck_bunny_poster_big.jpg', participantCount: 7, maxParticipants: 20, isPlaying: true, isLocked: false },
  { id: 'demo2', name: 'Sci-Fi Night', mediaTitle: 'Tears of Steel', mediaPoster: 'https://picsum.photos/seed/tearsofsteel/400/600', participantCount: 3, maxParticipants: 10, isPlaying: false, isLocked: false },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { setMediaLibrary, mediaLibrary, setRoom, setCurrentUser } = useStore()
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [preselectedMedia, setPreselectedMedia] = useState<string | undefined>()
  const [connectSourceOpen, setConnectSourceOpen] = useState(false)

  // Fetch media library
  useEffect(() => {
    fetch('/api/media')
      .then(r => r.json())
      .then((data: MediaItem[]) => {
        setMediaLibrary(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [setMediaLibrary])

  // Connect socket
  useEffect(() => {
    connectSocket()
  }, [])

  const handleCreateRoom = useCallback((data: { name: string; mediaId: string; maxParticipants: number }) => {
    setCreateModalOpen(false)
    socket.emit('room:create', data, (res: { room: RoomState; media: MediaItem; userId: string; error?: string }) => {
      if (res.error) { alert(res.error); return }
      setRoom(res.room, res.media)
      const me = res.room.participants.find(p => p.id === res.userId)
      if (me) setCurrentUser(me)
      navigate(`/room/${res.room.id}`)
    })
  }, [navigate, setRoom, setCurrentUser])

  const handleOpenCreate = (mediaId?: string) => {
    setPreselectedMedia(mediaId)
    setCreateModalOpen(true)
  }

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
        onConnectSource={() => setConnectSourceOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {/* Hero section */}
      <div className="relative px-6 pt-10 pb-8 overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-purple-600/5 blur-3xl" />
          <div className="absolute -top-10 right-20 w-64 h-64 rounded-full bg-blue-600/5 blur-3xl" />
        </div>
        <div className="relative">
          <h1 className="text-3xl font-bold text-cinema-text">
            Welcome back,{' '}
            <span className="accent-gradient-text">{useStore.getState().nickname}</span>
          </h1>
          <p className="text-cinema-muted mt-1.5">Ready to start a screening?</p>

          {/* Quick stats */}
          <div className="flex items-center gap-6 mt-5">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Film size={14} className="text-purple-400" />
              <span>{mediaLibrary.filter(m => m.status === 'ready').length} films ready</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clapperboard size={14} className="text-blue-400" />
              <span>{DEMO_ROOMS.length} active halls</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Zap size={14} className="text-green-400" />
              <span>Sync ready</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-16 space-y-12">
        {/* ── MY MEDIA LIBRARY ── */}
        <section>
          <div className="section-header">
            <Library size={16} className="text-purple-400" />
            <h2 className="section-title">My Media Library</h2>
            <div className="section-line" />
            {!loading && (
              <span className="text-xs text-slate-500">{readyMedia.length} films</span>
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
              <p className="text-cinema-muted text-sm">No films found</p>
              <button onClick={() => setConnectSourceOpen(true)} className="btn-primary mt-4 text-sm flex items-center gap-2">
                <Plug size={13} />
                Connect a Source
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
                />
              ))}
            </div>
          )}
        </section>

        {/* ── DOWNLOADED ── */}
        {processingMedia.length > 0 && (
          <section>
            <div className="section-header">
              <Download size={16} className="text-blue-400" />
              <h2 className="section-title">Downloaded</h2>
              <div className="section-line" />
              <span className="text-xs text-slate-500">{processingMedia.length} files</span>
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
            <h2 className="section-title">Active Halls</h2>
            <div className="section-line" />
            <button
              onClick={() => handleOpenCreate()}
              className="btn-ghost text-xs flex items-center gap-1 py-1"
            >
              <Plus size={12} />
              New
            </button>
          </div>

          {DEMO_ROOMS.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cinema-card flex items-center justify-center mb-3 opacity-30">
                <Users size={24} className="text-slate-500" />
              </div>
              <p className="text-cinema-muted text-sm">No active halls</p>
              <button
                onClick={() => handleOpenCreate()}
                className="btn-primary mt-4 text-sm flex items-center gap-2"
              >
                <Plus size={13} />
                Create a Hall
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {DEMO_ROOMS.map(room => (
                <RoomCard key={room.id} {...room} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Create Room Modal */}
      {createModalOpen && (
        <CreateRoomModal
          media={mediaLibrary}
          preselectedMediaId={preselectedMedia}
          onClose={() => setCreateModalOpen(false)}
          onCreate={handleCreateRoom}
        />
      )}

      {/* Connect Source Modal */}
      {connectSourceOpen && (
        <div className="modal-backdrop" onClick={() => setConnectSourceOpen(false)}>
          <div className="modal-content max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-cinema-text mb-2">Connect Source</h2>
            <p className="text-sm text-cinema-muted mb-6">
              Connect a media server, NAS, or cloud storage to automatically populate your library.
            </p>
            <div className="space-y-3">
              {['Jellyfin / Emby', 'Plex Media Server', 'Local Network (SMB)', 'WebDAV', 'S3 / R2 Storage'].map(src => (
                <div key={src} className="flex items-center justify-between p-3 glass rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-600/20 flex items-center justify-center">
                      <Plug size={14} className="text-purple-400" />
                    </div>
                    <span className="text-sm text-cinema-text">{src}</span>
                  </div>
                  <button className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                    Connect →
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setConnectSourceOpen(false)}
              className="btn-secondary w-full mt-5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
