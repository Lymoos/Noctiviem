import { useState } from 'react'
import { hueFromString, initialsFromName } from '../utils'

interface AvatarProps {
  /** Stable identity used for the fallback gradient color. */
  seed: string
  /** Display name — used for the initials fallback. */
  name?: string
  /** Optional image URL (e.g. DiceBear). Falls back to initials if it fails. */
  src?: string
  /** Pixel number or any CSS length (e.g. "clamp(28px,5vw,44px)"). */
  size?: number | string
  className?: string
}

/**
 * Avatar that never shows a broken image: it tries `src`, and on error (or when
 * absent) renders a deterministic gradient with the user's initials. Sizing is
 * container-query based so initials scale with the avatar at any size.
 */
export default function Avatar({ seed, name, src, size = 40, className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const hue = hueFromString(seed || name || 'x')
  const grad = `linear-gradient(135deg, hsl(${hue} 62% 56%), hsl(${(hue + 38) % 360} 70% 42%))`
  const dim = typeof size === 'number' ? `${size}px` : size

  return (
    <div
      className={`relative rounded-full overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: dim, height: dim, ['containerType' as any]: 'size' }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={name ?? ''}
          className="w-full h-full object-cover"
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="w-full h-full flex items-center justify-center font-bold text-white/95 select-none uppercase"
          style={{ background: grad, fontSize: '42cqmin', lineHeight: 1 }}
        >
          {initialsFromName(name)}
        </div>
      )}
    </div>
  )
}
