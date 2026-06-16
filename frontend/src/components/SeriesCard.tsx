import { Play, Layers } from 'lucide-react'
import { Series } from '../types'
import Poster from './Poster'

interface Props {
  series: Series
  progress: Record<string, { position: number; duration: number }>
  onOpen: (s: Series) => void
}

const seasonWord = (n: number) => (n === 1 ? 'сезон' : n < 5 ? 'сезона' : 'сезонов')

export default function SeriesCard({ series, progress, onOpen }: Props) {
  const hasProgress = series.episodes.some(e => {
    const p = progress[e.id]
    return p && p.position > 5 && (p.duration === 0 || p.position < p.duration - 5)
  })

  return (
    <div className="media-card group" onClick={() => onOpen(series)}>
      <div className="relative aspect-[2/3] bg-cinema-card overflow-hidden rounded-xl">
        <Poster src={series.poster} title={series.title} seed={series.id} className="w-full h-full object-cover" />

        <div className="absolute top-2 left-2 flex items-center gap-1 glass px-2 py-0.5 rounded text-[10px] text-white/90">
          <Layers size={10} /> Сериал
        </div>

        <div className="media-card-overlay" />
        <div className="media-card-actions">
          <button className="flex items-center gap-2 text-xs font-medium text-white bg-purple-600/80 hover:bg-purple-600 rounded-lg px-3 py-2 w-full justify-center">
            <Play size={12} fill="currentColor" />
            {hasProgress ? 'Продолжить' : 'Открыть'}
          </button>
        </div>
      </div>

      <div className="mt-3 px-1">
        <h3 className="text-sm font-semibold text-cinema-text truncate">{series.title}</h3>
        <div className="flex items-center gap-2 mt-1 text-xs text-cinema-muted">
          <span>{series.seasons} {seasonWord(series.seasons)}</span>
          <span>·</span>
          <span>{series.episodeCount} серий</span>
        </div>
      </div>
    </div>
  )
}
