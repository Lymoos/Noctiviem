import { useRef, useEffect, useState, useCallback } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Headphones, Subtitles, Wifi, ChevronDown, ChevronUp,
  Gauge
} from 'lucide-react'
import { MediaItem, Reaction } from '../types'
import { socket } from '../socket'
import { useStore, selectIsLeader } from '../store'

interface VideoPlayerProps {
  media: MediaItem
  serverTime: number
  isPlaying: boolean
  onTimeUpdate?: (time: number) => void
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VideoPlayer({ media, serverTime, isPlaying, onTimeUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLeader = useStore(selectIsLeader)
  const room = useStore(s => s.room)

  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(serverTime)
  const [duration, setDuration] = useState(media.duration)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [audioMenuOpen, setAudioMenuOpen] = useState(false)
  const [subsMenuOpen, setSubsMenuOpen] = useState(false)
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  const selectedAudio = room?.selectedAudio ?? 0
  const selectedSubs = room?.selectedSubs ?? 'off'
  const selectedQuality = room?.selectedQuality ?? 'Auto'
  const reactions = room?.reactions ?? []

  // Sync video with server state
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const diff = Math.abs(video.currentTime - serverTime)
    if (diff > 1.5) {
      video.currentTime = serverTime
      setIsSyncing(true)
      setTimeout(() => setIsSyncing(false), 1500)
    }
  }, [serverTime])

  // Play/Pause sync
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying && video.paused) {
      video.play().catch(() => {})
    } else if (!isPlaying && !video.paused) {
      video.pause()
    }
  }, [isPlaying])

  // Heartbeat (leader sends state every 3s)
  useEffect(() => {
    if (!isLeader) return
    heartbeatRef.current = setInterval(() => {
      const video = videoRef.current
      if (!video) return
      socket.emit('room:heartbeat', {
        currentTime: video.currentTime,
        isPlaying: !video.paused,
      })
    }, 3000)
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current) }
  }, [isLeader])

  // Auto-hide controls
  const showControls = useCallback(() => {
    setControlsVisible(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    if (isPlaying) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000)
    }
  }, [isPlaying])

  useEffect(() => {
    showControls()
  }, [isPlaying, showControls])

  const handlePlayPause = () => {
    if (!isLeader) return
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      socket.emit('room:play', { currentTime: video.currentTime })
    } else {
      socket.emit('room:pause', { currentTime: video.currentTime })
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isLeader) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const newTime = ratio * duration
    if (videoRef.current) videoRef.current.currentTime = newTime
    socket.emit('room:seek', { currentTime: newTime })
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
    setMuted(v === 0)
  }

  const toggleMute = () => {
    const newMuted = !muted
    setMuted(newMuted)
    if (videoRef.current) videoRef.current.muted = newMuted
  }

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  const handleAudio = (id: number) => {
    if (!isLeader) return
    socket.emit('room:audio', { audioIndex: id })
    setAudioMenuOpen(false)
  }

  const handleSubs = (id: string) => {
    if (!isLeader) return
    socket.emit('room:subs', { subsId: id })
    setSubsMenuOpen(false)
  }

  const handleQuality = (q: string) => {
    if (!isLeader) return
    socket.emit('room:quality', { quality: q })
    setQualityMenuOpen(false)
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  // Apply browser-native audio track switching when selectedAudio changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const tracks = (video as any).audioTracks
    if (!tracks || tracks.length === 0) return
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = (i === selectedAudio)
    }
  }, [selectedAudio])

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded-xl overflow-hidden screen-glow vignette group"
      style={{ maxHeight: 'calc(100vh - 150px)' }}
      onMouseMove={showControls}
      onMouseLeave={() => isPlaying && setControlsVisible(false)}
    >
      {/* Video */}
      <video
        ref={videoRef}
        src={media.videoUrl}
        className="w-full aspect-video"
        style={{ maxHeight: 'calc(100vh - 150px)', objectFit: 'contain', cursor: isLeader ? 'pointer' : 'default' }}
        playsInline
        preload="metadata"
        onTimeUpdate={() => {
          const t = videoRef.current?.currentTime ?? 0
          setCurrentTime(t)
          onTimeUpdate?.(t)
        }}
        onLoadedMetadata={() => {
          setDuration(videoRef.current?.duration ?? media.duration)
          if (serverTime > 0 && videoRef.current) {
            videoRef.current.currentTime = serverTime
          }
        }}
        onClick={handlePlayPause}
      />

      {/* Sync indicator */}
      {isSyncing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 glass px-3 py-1.5 rounded-full text-xs text-purple-300 flex items-center gap-2">
          <Gauge size={12} className="animate-spin" />
          Syncing…
        </div>
      )}

      {/* Leader-only: Not playing overlay */}
      {!isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          onClick={handlePlayPause}
          style={{ cursor: isLeader ? 'pointer' : 'default' }}
        >
          <div className={`w-20 h-20 rounded-full accent-gradient flex items-center justify-center transition-transform ${isLeader ? 'hover:scale-110' : 'opacity-60'}`}
            style={{ boxShadow: '0 0 40px rgba(124,58,237,0.5)' }}>
            <Play size={32} fill="white" className="text-white ml-1" />
          </div>
          {!isLeader && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 text-xs text-slate-400">
              Waiting for Leader…
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div
        className={`video-controls absolute bottom-0 left-0 right-0 p-4 transition-opacity duration-300 z-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Reaction markers on progress */}
        <div className="relative mb-1">
          {reactions.slice(-50).map(r => (
            <div
              key={r.id}
              className="reaction-marker"
              style={{ left: `${(r.timelinePosition / duration) * 100}%` }}
              title={`${r.nickname}: ${r.emoji}`}
            >
              {r.emoji}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div
          className="progress-bar-container mb-3"
          onClick={isLeader ? handleSeek : undefined}
          style={{ cursor: isLeader ? 'pointer' : 'default' }}
        >
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={!isLeader}
            className={`flex-shrink-0 ${isLeader ? 'text-white hover:text-purple-300' : 'text-white/30 cursor-not-allowed'} transition-colors`}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
              {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-20 accent-purple-500"
            />
          </div>

          {/* Time */}
          <span className="text-xs text-white/70 font-mono flex-shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Audio */}
          <div className="relative">
            <button
              onClick={() => { if (isLeader) { setAudioMenuOpen(!audioMenuOpen); setSubsMenuOpen(false); setQualityMenuOpen(false) } }}
              className={`flex items-center gap-1 text-xs ${isLeader ? 'text-white/70 hover:text-white' : 'text-white/30 cursor-not-allowed'} transition-colors`}
            >
              <Headphones size={15} />
              <span className="hidden sm:inline">{media.audio[selectedAudio]?.label ?? 'Audio'}</span>
            </button>
            {audioMenuOpen && isLeader && (
              <div className="menu-dropdown absolute bottom-8 right-0 min-w-40">
                {media.audio.map(a => (
                  <div
                    key={a.id}
                    onClick={() => handleAudio(a.id)}
                    className={`menu-item ${selectedAudio === a.id ? 'active' : ''}`}
                  >
                    {a.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Subtitles */}
          <div className="relative">
            <button
              onClick={() => { if (isLeader) { setSubsMenuOpen(!subsMenuOpen); setAudioMenuOpen(false); setQualityMenuOpen(false) } }}
              className={`flex items-center gap-1 text-xs ${isLeader ? 'text-white/70 hover:text-white' : 'text-white/30 cursor-not-allowed'} transition-colors`}
            >
              <Subtitles size={15} />
              <span className="hidden sm:inline">{selectedSubs === 'off' ? 'Off' : selectedSubs.toUpperCase()}</span>
            </button>
            {subsMenuOpen && isLeader && (
              <div className="menu-dropdown absolute bottom-8 right-0 min-w-32">
                {media.subtitles.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleSubs(s.id)}
                    className={`menu-item ${selectedSubs === s.id ? 'active' : ''}`}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quality */}
          <div className="relative">
            <button
              onClick={() => { if (isLeader) { setQualityMenuOpen(!qualityMenuOpen); setAudioMenuOpen(false); setSubsMenuOpen(false) } }}
              className={`flex items-center gap-1 text-xs ${isLeader ? 'text-white/70 hover:text-white' : 'text-white/30 cursor-not-allowed'} transition-colors`}
            >
              <Wifi size={15} />
              <span className="hidden sm:inline">{selectedQuality}</span>
            </button>
            {qualityMenuOpen && isLeader && (
              <div className="menu-dropdown absolute bottom-8 right-0 min-w-24">
                {media.qualities.map(q => (
                  <div
                    key={q}
                    onClick={() => handleQuality(q)}
                    className={`menu-item ${selectedQuality === q ? 'active' : ''}`}
                  >
                    {q}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="text-white/70 hover:text-white transition-colors"
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
