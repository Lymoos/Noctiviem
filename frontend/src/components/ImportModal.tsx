import { useState, useRef, DragEvent, ChangeEvent } from 'react'
import { X, Upload, FileArchive, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { getToken } from '../store'

interface ImportModalProps {
  onClose: () => void
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const { toggleDownloads } = useStore()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.torrent')) {
      setError('Only .torrent files are accepted')
      return
    }
    setError(null)
    setUploading(true)

    const form = new FormData()
    form.append('torrent', file)

    try {
      const r = await fetch('/api/downloads', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      })
      const data = await r.json()
      if (data.error) { setError(data.error); setUploading(false); return }
      // Success — open downloads panel and close modal
      onClose()
      toggleDownloads()
    } catch {
      setError('Upload failed. Please try again.')
      setUploading(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload(file)
    // reset input
    e.target.value = ''
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content max-w-md animate-fade-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-cinema-text">Import media</h2>
          <button onClick={onClose} className="btn-ghost p-2 -mr-2">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-cinema-muted mb-6">
          Add a <span className="text-purple-400">.torrent</span> file and the server will download it automatically.
          Once complete, the film will appear in your library.
        </p>

        {/* Drop zone */}
        <div
          className={`relative rounded-2xl border-2 border-dashed transition-colors cursor-pointer p-10 flex flex-col items-center justify-center gap-4 text-center
            ${dragging
              ? 'border-purple-500/60 bg-purple-600/10'
              : 'border-white/10 bg-cinema-card/40 hover:border-purple-500/30 hover:bg-purple-600/5'
            }`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="hidden"
            onChange={onFileChange}
          />

          {uploading ? (
            <>
              <div className="w-12 h-12 rounded-2xl accent-gradient flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium text-cinema-text">Uploading…</p>
                <p className="text-xs text-cinema-muted mt-1">The server is receiving your file</p>
              </div>
            </>
          ) : (
            <>
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                dragging ? 'accent-gradient' : 'bg-purple-600/15'
              }`}>
                <Upload size={22} className={dragging ? 'text-white' : 'text-purple-400'} />
              </div>
              <div>
                <p className="text-sm font-medium text-cinema-text">
                  {dragging ? 'Drop it!' : 'Drag & drop a .torrent file'}
                </p>
                <p className="text-xs text-cinema-muted mt-1">or click to browse</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <FileArchive size={11} />
                <span>.torrent files only · max 10 MB</span>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/15 border border-red-500/20 rounded-lg px-3 py-2.5">
            <AlertCircle size={14} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={() => { !uploading && fileInputRef.current?.click() }}
            disabled={uploading}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            <Upload size={14} />
            Browse file
          </button>
          <button onClick={onClose} className="btn-secondary px-5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
