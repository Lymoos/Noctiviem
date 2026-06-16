import { useState } from 'react'
import { Film } from 'lucide-react'
import { hueFromString } from '../utils'

interface PosterProps {
  src?: string
  title: string
  /** Stable identity for the placeholder color (defaults to the title). */
  seed?: string
  /** Applied to both the <img> and the placeholder (e.g. "w-full h-full object-cover"). */
  className?: string
  /** Hide the title text in the placeholder (for tiny thumbnails). */
  compact?: boolean
}

/**
 * Movie poster that degrades gracefully: when there is no real poster (TMDB
 * miss / network), it shows an on-theme gradient card with the film title
 * instead of a random stock photo.
 */
export default function Poster({ src, title, seed, className = '', compact = false }: PosterProps) {
  const [failed, setFailed] = useState(false)
  const hue = hueFromString(seed || title || 'x')
  const bg = `radial-gradient(ellipse at 50% 22%, hsl(${hue} 55% 26%) 0%, hsl(${(hue + 40) % 360} 45% 13%) 55%, hsl(${(hue + 90) % 360} 35% 7%) 100%)`

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={title}
        className={className}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center text-center overflow-hidden ${className}`}
      style={{ background: bg, ['containerType' as any]: 'size' }}
    >
      <Film className="text-white/25" style={{ width: '24%', height: 'auto' }} />
      {!compact && (
        <span
          className="px-2 mt-2 text-white/85 font-semibold leading-tight line-clamp-3"
          style={{ fontSize: 'clamp(10px, 9cqw, 18px)' }}
        >
          {title}
        </span>
      )}
    </div>
  )
}
