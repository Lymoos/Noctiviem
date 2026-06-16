import { Users, Play, Clock, Lock, Crown } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Poster from './Poster'

interface RoomCardProps {
  id: string
  name: string
  mediaTitle: string
  mediaPoster: string
  participantCount: number
  maxParticipants: number
  isPlaying?: boolean
  isLocked?: boolean
  isLeader?: boolean
}

export default function RoomCard({
  id, name, mediaTitle, mediaPoster,
  participantCount, maxParticipants, isPlaying, isLocked, isLeader,
}: RoomCardProps) {
  const navigate = useNavigate()

  return (
    <div
      onClick={() => navigate(`/room/${id}`)}
      className="glass rounded-xl overflow-hidden cursor-pointer hover:border-purple-500/20 transition-all hover:shadow-lg hover:shadow-purple-500/10 group"
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex gap-0">
        {/* Poster */}
        <div className="w-20 h-28 flex-shrink-0 relative overflow-hidden">
          <Poster src={mediaPoster} title={mediaTitle} seed={id} className="w-full h-full object-cover" compact />
          {isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="w-6 h-6 rounded-full bg-purple-600/80 flex items-center justify-center">
                <Play size={10} fill="white" className="text-white ml-0.5" />
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-cinema-text group-hover:text-purple-300 transition-colors truncate">
                {name}
              </h3>
              <div className="flex items-center gap-1 flex-shrink-0">
                {isLeader && <Crown size={12} className="text-yellow-400" />}
                {isLocked && <Lock size={12} className="text-slate-500" />}
              </div>
            </div>
            <p className="text-xs text-cinema-muted mt-0.5 truncate">{mediaTitle}</p>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Users size={11} />
              <span>{participantCount}/{maxParticipants}</span>
            </div>
            <div className={`flex items-center gap-1 text-xs ${isPlaying ? 'text-green-400' : 'text-slate-500'}`}>
              {isPlaying ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span>Live</span>
                </>
              ) : (
                <>
                  <Clock size={11} />
                  <span>Waiting</span>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full accent-gradient rounded-full"
              style={{ width: `${(participantCount / maxParticipants) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
