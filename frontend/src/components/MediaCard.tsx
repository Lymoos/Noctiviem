import { Play, Clapperboard, Headphones, Subtitles, Wifi, Clock, X, RefreshCw } from 'lucide-react'
import { MediaItem } from '../types'
import { useStore } from '../store'
import { translations } from '../i18n'

interface MediaCardProps {
  item: MediaItem
  onWatch?: () => void
  onCreateRoom?: () => void
  onManage?: () => void
  onDelete?: () => void
  onRedownload?: () => void
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function MediaCard({ item, onWatch, onCreateRoom, onManage, onDelete, onRedownload }: MediaCardProps) {
  const { lang } = useStore()
  const t = translations[lang]
  const isReady = item.status === 'ready'

  return (
    <div className="media-card group">
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-cinema-card overflow-hidden rounded-xl">
        <img
          src={item.poster}
          alt={item.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={e => {
            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${item.id}/400/600`
          }}
        />

        {/* Processing overlay */}
        {item.status === 'processing' && (
          <div className="absolute inset-0 bg-cinema-bg/75 flex flex-col items-center justify-center gap-3 px-4">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">{t.processingDots}</span>
            {item.progress !== undefined && (
              <div className="w-full">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Converting…</span>
                  <span>{item.progress}%</span>
                </div>
                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${item.progress}%`,
                      background: 'linear-gradient(90deg, #7c3aed, #3b82f6)',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error overlay */}
        {item.status === 'error' && (
          <div className="absolute inset-0 bg-cinema-bg/70 flex items-center justify-center">
            <span className="text-xs text-red-400">{t.error}</span>
          </div>
        )}

        {/* Hover overlay */}
        <div className="media-card-overlay" />

        {/* Status badge */}
        <div className="absolute top-2 left-2">
          {item.status === 'ready' && <span className="badge-ready">{t.ready}</span>}
          {item.status === 'processing' && <span className="badge-processing">{t.processingBadge}</span>}
          {item.status === 'error' && <span className="badge-error">{t.error}</span>}
        </div>

        {/* Re-download button */}
        {onRedownload && (
          <button
            onClick={e => { e.stopPropagation(); onRedownload() }}
            className="absolute top-2 right-9 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-600/90 z-10"
            title="Re-download (recover all audio tracks)"
          >
            <RefreshCw size={11} className="text-white" />
          </button>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600/90 z-10"
            title={t.deleteMedia}
          >
            <X size={11} className="text-white" />
          </button>
        )}

        {/* Actions */}
        {isReady && (
          <div className="media-card-actions">
            <div className="flex flex-col gap-2">
              <button
                onClick={e => { e.stopPropagation(); onWatch?.() }}
                className="flex items-center gap-2 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded-lg px-3 py-2 transition-colors w-full"
              >
                <Play size={12} fill="currentColor" />
                {t.watch}
              </button>
              <button
                onClick={e => { e.stopPropagation(); onCreateRoom?.() }}
                className="flex items-center gap-2 text-xs font-medium text-white bg-purple-600/80 hover:bg-purple-600 rounded-lg px-3 py-2 transition-colors w-full"
              >
                <Clapperboard size={12} />
                {t.createHall}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="mt-3 px-1">
        <h3 className="text-sm font-semibold text-cinema-text truncate">{item.title}</h3>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-cinema-muted">{item.year}</span>
          <span className="text-xs text-cinema-muted">·</span>
          <span className="text-xs text-cinema-muted">{item.genre}</span>
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Clock size={10} />
            <span>{formatDuration(item.duration)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Headphones size={10} />
            <span>{item.audio.length}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <Subtitles size={10} />
            <span>{item.subtitles.filter(s => s.id !== 'off').length}</span>
          </div>
          <div
            className="flex items-center gap-1 text-xs text-slate-500"
            title={item.videoUrl.includes('.m3u8') ? 'HLS — адаптивный стриминг' : item.qualities[item.qualities.length - 1]}
          >
            <Wifi size={10} />
            <span>{item.videoUrl.includes('.m3u8') ? 'HLS' : item.qualities[item.qualities.length - 1]}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
