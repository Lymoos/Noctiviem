import { X, Play, Check, Layers } from 'lucide-react'
import { Series, MediaItem } from '../types'

interface Props {
  series: Series
  progress: Record<string, { position: number; duration: number }>
  onClose: () => void
  onPlay: (mediaId: string) => void
}

function epCode(e: MediaItem): string {
  const s = e.season ?? 1, n = e.episode ?? 0
  return `S${String(s).padStart(2, '0')}E${String(n).padStart(2, '0')}`
}
function epLabel(e: MediaItem): string {
  return e.episodeTitle ? `${epCode(e)} · ${e.episodeTitle}` : epCode(e)
}

export default function SeriesModal({ series, progress, onClose, onPlay }: Props) {
  const seasons = [...new Set(series.episodes.map(e => e.season ?? 1))].sort((a, b) => a - b)

  const isInProgress = (e: MediaItem) => {
    const p = progress[e.id]
    return !!p && p.position > 5 && (p.duration === 0 || p.position < p.duration - 5)
  }
  const isWatched = (e: MediaItem) => {
    const p = progress[e.id]
    return !!p && p.duration > 0 && p.position >= p.duration - 5
  }
  // Continue target: in-progress episode → first unwatched → first episode.
  const cont = series.episodes.find(isInProgress)
    ?? series.episodes.find(e => !isWatched(e))
    ?? series.episodes[0]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content max-w-lg w-full"
        onClick={e => e.stopPropagation()}
        style={{ maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-purple-300 mb-1"><Layers size={12} /> Сериал</div>
            <h2 className="text-lg font-bold text-cinema-text truncate">{series.title}</h2>
            <div className="text-xs text-cinema-muted mt-0.5">{series.seasons} · {series.episodeCount} серий</div>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 flex-shrink-0"><X size={16} /></button>
        </div>

        {cont && (
          <button onClick={() => onPlay(cont.id)} className="btn-primary w-full flex items-center justify-center gap-2 mb-5">
            <Play size={14} fill="currentColor" /> Продолжить · {epLabel(cont)}
          </button>
        )}

        {seasons.map(season => (
          <div key={season} className="mb-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Сезон {season}</div>
            <div className="space-y-1.5">
              {series.episodes.filter(e => (e.season ?? 1) === season).map(e => {
                const p = progress[e.id]
                const pct = p && p.duration > 0 ? Math.min(100, (p.position / p.duration) * 100) : 0
                const watched = pct >= 95
                const inProg = pct > 1 && pct < 95
                return (
                  <button
                    key={e.id}
                    onClick={() => onPlay(e.id)}
                    className="w-full flex items-center gap-3 glass rounded-lg px-3 py-2 hover:bg-white/6 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                      {watched
                        ? <Check size={13} className="text-green-400" />
                        : <Play size={12} className="text-purple-300" fill="currentColor" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-cinema-text truncate">{epLabel(e)}</div>
                      {inProg && (
                        <div className="h-0.5 mt-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
