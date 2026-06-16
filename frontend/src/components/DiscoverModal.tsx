import { useState, useCallback, useRef } from 'react'
import { X, Search, Download, Loader, Star, Users, ArrowLeft, Magnet, AlertTriangle } from 'lucide-react'
import { useStore, apiFetch, apiPost } from '../store'
import Poster from './Poster'

interface DiscoverMovie { id: number; title: string; year: number; poster: string; overview: string }
interface TrackerResult {
  trackerId: string; title: string; sizeBytes: number; seeders: number
  leechers: number; quality: string; category: string; url: string; score: number
}

function fmtSize(b: number): string {
  if (!b) return '—'
  const gb = b / 1e9
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`
}

const QUALITY_COLOR: Record<string, string> = {
  '2160p': 'text-amber-300 border-amber-400/30 bg-amber-500/10',
  '1080p': 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  '720p': 'text-sky-300 border-sky-400/30 bg-sky-500/10',
  '480p': 'text-slate-300 border-white/15 bg-white/5',
  CAM: 'text-red-300 border-red-400/30 bg-red-500/10',
}

export default function DiscoverModal({ onClose }: { onClose: () => void }) {
  const toggleDownloads = useStore(s => s.toggleDownloads)
  const [query, setQuery] = useState('')
  const [movies, setMovies] = useState<DiscoverMovie[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<DiscoverMovie | null>(null)
  const [releases, setReleases] = useState<TrackerResult[]>([])
  const [relLoading, setRelLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [magnet, setMagnet] = useState('')
  const [done, setDone] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const runSearch = useCallback((q: string) => {
    if (debounce.current) clearTimeout(debounce.current)
    if (q.trim().length < 2) { setMovies([]); return }
    debounce.current = setTimeout(async () => {
      setSearching(true)
      const r = await apiFetch<{ results: DiscoverMovie[] }>(`/api/discover/search?q=${encodeURIComponent(q)}`)
      setMovies(Array.isArray(r.results) ? r.results : [])
      setSearching(false)
    }, 400)
  }, [])

  const openMovie = async (m: DiscoverMovie) => {
    setSelected(m); setReleases([]); setError(null); setRelLoading(true)
    const r = await apiFetch<{ results: TrackerResult[]; error?: string }>(
      `/api/tracker/search?q=${encodeURIComponent(m.title)}&year=${m.year || ''}`,
    )
    if (r.error) setError(r.error)
    else setReleases(Array.isArray(r.results) ? r.results : [])
    setRelLoading(false)
  }

  const finish = () => { setDone(true); setTimeout(() => { onClose(); toggleDownloads() }, 800) }

  const downloadRelease = async (rel: TrackerResult) => {
    setDownloadingId(rel.trackerId); setError(null)
    const name = selected ? `${selected.title} (${selected.year || ''})`.trim() : rel.title
    const r = await apiPost<{ id?: string; error?: string }>('/api/downloads/tracker', { trackerId: rel.trackerId, displayName: name })
    setDownloadingId(null)
    if (r.error) { setError(r.error); return }
    finish()
  }

  const downloadMagnet = async () => {
    if (!magnet.trim()) return
    setError(null)
    const r = await apiPost<{ id?: string; error?: string }>('/api/downloads/magnet', { magnet: magnet.trim() })
    if (r.error) { setError(r.error); return }
    finish()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content w-full"
        style={{ maxWidth: 640, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 min-w-0">
            {selected && (
              <button onClick={() => { setSelected(null); setError(null) }} className="btn-ghost p-1.5 flex-shrink-0">
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 className="text-lg font-bold text-cinema-text truncate">
              {selected ? `${selected.title}${selected.year ? ` (${selected.year})` : ''}` : 'Найти фильм'}
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2 flex-shrink-0"><X size={16} /></button>
        </div>

        {done && (
          <div className="mb-4 flex items-center gap-2 text-sm text-green-400 bg-green-900/15 border border-green-500/20 rounded-lg px-3 py-2.5">
            <Download size={14} /> Загрузка добавлена — смотри в панели загрузок
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
            <AlertTriangle size={14} className="flex-shrink-0" /><span>{error}</span>
          </div>
        )}

        {!selected ? (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); runSearch(e.target.value) }}
                placeholder="Название фильма…"
                className="input-field w-full"
                style={{ paddingLeft: '2.25rem' }}
              />
            </div>

            {searching && <div className="flex justify-center py-8"><Loader size={22} className="text-purple-400 animate-spin" /></div>}

            {!searching && movies.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {movies.map(m => (
                  <button key={m.id} onClick={() => openMovie(m)} className="group text-left">
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-cinema-card">
                      <Poster src={m.poster} title={m.title} seed={String(m.id)} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                        <Download size={20} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                    <div className="text-xs text-cinema-text truncate mt-1">{m.title}</div>
                    {m.year > 0 && <div className="text-[10px] text-cinema-muted">{m.year}</div>}
                  </button>
                ))}
              </div>
            )}

            {!searching && query.trim().length >= 2 && movies.length === 0 && (
              <p className="text-sm text-cinema-muted text-center py-8">Ничего не найдено</p>
            )}
            {query.trim().length < 2 && (
              <p className="text-xs text-slate-600 text-center py-6">Введите название, чтобы найти фильм и скачать его в один клик</p>
            )}

            {/* Manual magnet */}
            <div className="mt-5 pt-4 border-t border-white/5">
              <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5"><Magnet size={12} /> Или вставьте magnet-ссылку</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={magnet}
                  onChange={e => setMagnet(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && downloadMagnet()}
                  placeholder="magnet:?xt=urn:btih:…"
                  className="input-field flex-1 text-sm"
                  style={{ paddingLeft: '14px' }}
                />
                <button onClick={downloadMagnet} disabled={!magnet.trim()} className="btn-primary px-3 flex items-center"><Download size={14} /></button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Releases */}
            {relLoading && <div className="flex justify-center py-10"><Loader size={22} className="text-purple-400 animate-spin" /></div>}

            {!relLoading && releases.length > 0 && (
              <div className="space-y-2">
                {releases.map((r, i) => (
                  <div key={r.trackerId} className="flex items-center gap-3 glass rounded-lg px-3 py-2.5 border border-white/5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${QUALITY_COLOR[r.quality] ?? 'text-slate-300 border-white/15 bg-white/5'}`}>
                          {r.quality}
                        </span>
                        {i === 0 && (
                          <span className="text-[10px] text-purple-300 flex items-center gap-0.5"><Star size={9} fill="currentColor" /> рекомендуем</span>
                        )}
                      </div>
                      <div className="text-xs text-cinema-text truncate" title={r.title}>{r.title}</div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                        <span>{fmtSize(r.sizeBytes)}</span>
                        <span className={`flex items-center gap-1 ${r.seeders > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          <Users size={10} /> {r.seeders}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => downloadRelease(r)}
                      disabled={downloadingId === r.trackerId}
                      className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 flex-shrink-0"
                    >
                      {downloadingId === r.trackerId
                        ? <Loader size={12} className="animate-spin" />
                        : <Download size={12} />}
                      Скачать
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!relLoading && !error && releases.length === 0 && (
              <p className="text-sm text-cinema-muted text-center py-10">Раздач не найдено</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
