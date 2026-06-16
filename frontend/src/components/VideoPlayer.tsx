import { useRef, useEffect, useState, useCallback } from 'react'
import Hls from 'hls.js'
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  Headphones, Subtitles, Wifi, ChevronDown, ChevronUp,
  Gauge, RotateCcw, RotateCw
} from 'lucide-react'
import { MediaItem, Reaction } from '../types'
import { socket } from '../socket'
import { useStore, selectIsLeader } from '../store'

interface VideoPlayerProps {
  media: MediaItem
  serverTime: number
  isPlaying: boolean
  onTimeUpdate?: (time: number) => void
  onEnded?: () => void
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VideoPlayer({ media, serverTime, isPlaying, onTimeUpdate, onEnded }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last known playback position — used to resume after an HLS source swap
  // (audio-track change reloads the manifest, which would otherwise restart at 0).
  const resumeTimeRef = useRef(serverTime)

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
  const [hlsError, setHlsError] = useState(false)
  // Browsers block autoplay with sound until the user interacts. When the Leader
  // starts playback, viewers may need one tap to begin with audio.
  const [needsGesture, setNeedsGesture] = useState(false)

  const selectedAudio = room?.selectedAudio ?? 0
  const selectedSubs = room?.selectedSubs ?? 'off'
  const selectedQuality = room?.selectedQuality ?? 'Auto'
  const reactions = room?.reactions ?? []

  // Attach video source: plain MP4/WebM or HLS (.m3u8) via hls.js.
  // For HLS the chosen audio track is encoded in the manifest URL (?a=N) — the
  // backend muxes that audio stream into each segment, so switching audio just
  // reloads the source. media.videoUrl already carries ?p=…, so append &a=.
  const isHls = media.videoUrl.includes('.m3u8')
  const hlsSrc = isHls ? `${media.videoUrl}&a=${selectedAudio}` : media.videoUrl

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Destroy any previous hls.js instance
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    // Restore position after a source swap (audio-track change). On first mount
    // resumeTimeRef === serverTime so a fresh join still starts at the right spot.
    const seekTo = resumeTimeRef.current
    const resume = () => { if (seekTo > 0.5) { try { video.currentTime = seekTo } catch {} } }

    if (isHls) {
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 })
        hls.loadSource(hlsSrc)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, resume)
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            console.error('[hls] fatal error:', data.type, data.details)
            setHlsError(true)
          }
        })
        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = hlsSrc
        video.addEventListener('loadedmetadata', resume, { once: true })
      }
    } else {
      video.src = media.videoUrl
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [hlsSrc, isHls, media.videoUrl])

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
      video.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true))
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

  const handleSkip = useCallback((seconds: number) => {
    if (!isLeader) return
    const video = videoRef.current
    if (!video) return
    const newTime = Math.max(0, Math.min(video.currentTime + seconds, duration))
    video.currentTime = newTime
    socket.emit('room:seek', { currentTime: newTime })
  }, [isLeader, duration])

  // Keyboard shortcuts: ← = -5s, → = +15s
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handleSkip(-5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); handleSkip(15) }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handleSkip])

  const handleQuality = (q: string) => {
    if (!isLeader) return
    socket.emit('room:quality', { quality: q })
    setQualityMenuOpen(false)
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  // Apply audio track selection via the native audioTracks API (Chrome/Safari).
  // Must be called both after metadata loads (tracks become available) and
  // whenever the selected index changes. Without the metadata call, all tracks
  // start enabled simultaneously and the effect runs before tracks are ready.
  const applyAudioTrack = useCallback((index: number) => {
    const video = videoRef.current
    if (!video) return
    if (isHls) return // HLS audio tracks are managed via EXT-X-MEDIA renditions (future work)
    const tracks = (video as any).audioTracks
    if (!tracks || tracks.length === 0) return
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = (i === index)
    }
    // Force decoder flush so the new audio track takes effect immediately
    // (Chrome buffers the old track; a seek to the same position re-decodes)
    video.currentTime = video.currentTime
  }, [])

  useEffect(() => {
    applyAudioTrack(selectedAudio)
  }, [selectedAudio, applyAudioTrack])

  // Subtitles: WebVTT <track>s are toggled via the native textTracks API.
  // Track order matches the rendered <track> order (subtitles that have a src).
  const applySubtitleTrack = useCallback((subId: string) => {
    const video = videoRef.current
    if (!video) return
    const subTracks = media.subtitles.filter(s => s.src)
    const tt = video.textTracks
    for (let i = 0; i < tt.length && i < subTracks.length; i++) {
      tt[i].mode = subTracks[i].id === subId ? 'showing' : 'disabled'
    }
  }, [media.subtitles])

  useEffect(() => {
    applySubtitleTrack(selectedSubs)
  }, [selectedSubs, applySubtitleTrack])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black overflow-hidden vignette group"
      style={{ borderRadius: fullscreen ? 0 : '2px' }}
      onMouseMove={showControls}
      onMouseLeave={() => isPlaying && setControlsVisible(false)}
    >
      {/* Video — fills the container, letterboxed to keep aspect ratio */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        style={{
          objectFit: 'contain',
          background: '#000',
          cursor: isLeader ? 'pointer' : 'default',
        }}
        playsInline
        preload="metadata"
        onTimeUpdate={() => {
          const t = videoRef.current?.currentTime ?? 0
          resumeTimeRef.current = t
          setCurrentTime(t)
          onTimeUpdate?.(t)
        }}
        onLoadedMetadata={() => {
          setDuration(videoRef.current?.duration ?? media.duration)
          // Seek to the last known position (serverTime on first load, current
          // position after an audio-track source swap).
          if (resumeTimeRef.current > 0.5 && videoRef.current) {
            videoRef.current.currentTime = resumeTimeRef.current
          }
          // Initialize audio tracks — disable all except the selected one.
          // Without this, Chrome plays all tracks at once when multiple exist.
          applyAudioTrack(selectedAudio)
          applySubtitleTrack(selectedSubs)
        }}
        onEnded={() => onEnded?.()}
        onClick={handlePlayPause}
      >
        {media.subtitles.filter(s => s.src).map(s => (
          <track key={s.id} kind="subtitles" src={s.src} srcLang={s.lang} label={s.label} />
        ))}
      </video>

      {/* Sync indicator */}
      {/* HLS fatal error overlay */}
      {hlsError && (
        <div className="absolute inset-0 z-20 bg-black/85 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-4xl">⚠️</div>
          <p className="text-sm font-semibold text-red-400">Ошибка воспроизведения</p>
          <p className="text-xs text-slate-400">Не удалось загрузить видео.<br/>Файл может быть повреждён или формат не поддерживается.</p>
          <button
            onClick={() => { setHlsError(false); if (hlsRef.current) hlsRef.current.loadSource(media.videoUrl) }}
            className="mt-2 px-4 py-2 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      )}

      {isSyncing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 glass px-3 py-1.5 rounded-full text-xs text-purple-300 flex items-center gap-2">
          <Gauge size={12} className="animate-spin" />
          Syncing…
        </div>
      )}

      {/* Autoplay blocked — viewer needs one tap to start with sound */}
      {needsGesture && isPlaying && (
        <div
          className="absolute inset-0 z-30 bg-black/70 flex flex-col items-center justify-center gap-3 cursor-pointer"
          onClick={() => {
            const video = videoRef.current
            if (!video) return
            video.muted = false
            video.play().then(() => setNeedsGesture(false)).catch(() => {})
          }}
        >
          <div className="w-16 h-16 rounded-full accent-gradient flex items-center justify-center" style={{ boxShadow: '0 0 40px rgba(124,58,237,0.5)' }}>
            <Play size={28} fill="white" className="text-white ml-1" />
          </div>
          <p className="text-sm text-white/90">Нажмите, чтобы смотреть вместе</p>
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

          {/* Skip back 5s */}
          <button
            onClick={() => handleSkip(-5)}
            disabled={!isLeader}
            title="-5 seconds"
            className={`relative flex-shrink-0 ${isLeader ? 'text-white/70 hover:text-white' : 'text-white/20 cursor-not-allowed'} transition-colors`}
          >
            <RotateCcw size={16} />
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold leading-none">5</span>
          </button>

          {/* Skip forward 15s */}
          <button
            onClick={() => handleSkip(15)}
            disabled={!isLeader}
            title="+15 seconds"
            className={`relative flex-shrink-0 ${isLeader ? 'text-white/70 hover:text-white' : 'text-white/20 cursor-not-allowed'} transition-colors`}
          >
            <RotateCw size={16} />
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold leading-none">15</span>
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
                {media.subtitles.filter(s => s.id === 'off' || s.src).map(s => (
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
