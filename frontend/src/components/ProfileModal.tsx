import { useEffect, useState } from 'react'
import { X, Crown, Lock, Clock, Users } from 'lucide-react'
import { UserProfile } from '../types'
import { apiFetch, apiPost, apiDelete } from '../store'
import Avatar from './Avatar'

interface ProfileModalProps {
  userId: string
  nickname: string          // participant's nickname as fallback for guests
  isLeader: boolean
  currentUserId: string
  onClose: () => void
  onTransferLeader: () => void
}

export default function ProfileModal({
  userId,
  nickname: participantNickname,
  isLeader,
  currentUserId,
  onClose,
  onTransferLeader,
}: ProfileModalProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(false)
  const [isFriend, setIsFriend] = useState(false)
  const [friendLoading, setFriendLoading] = useState(false)

  const isSelf = userId === currentUserId

  useEffect(() => {
    setLoading(true)
    setIsGuest(false)
    apiFetch<UserProfile>(`/api/users/${userId}/profile`)
      .then(p => {
        if (p.error) { setIsGuest(true); return }
        setProfile(p)
      })
      .catch(() => setIsGuest(true))
      .finally(() => setLoading(false))
  }, [userId])

  // Determine if already friends (current user appears in friends list)
  useEffect(() => {
    if (!profile?.friends) return
    setIsFriend(profile.friends.some(f => f.id === currentUserId))
  }, [profile, currentUserId])

  const toggleFriend = async () => {
    if (!profile) return
    setFriendLoading(true)
    if (isFriend) {
      await apiDelete(`/api/users/${userId}/friend`)
      setIsFriend(false)
    } else {
      await apiPost(`/api/users/${userId}/friend`, {})
      setIsFriend(true)
    }
    setFriendLoading(false)
  }

  const avatarUrl = profile
    ? `https://api.dicebear.com/7.x/thumbs/svg?seed=${profile.avatarSeed}&backgroundColor=7c3aed,3b82f6`
    : undefined

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content max-w-sm w-full"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar
              seed={profile?.avatarSeed || userId}
              name={profile?.nickname ?? participantNickname}
              src={avatarUrl}
              size={48}
            />
            <div>
              {loading ? (
                <div className="w-24 h-4 bg-white/10 rounded animate-pulse mb-1" />
              ) : (
                <div className="font-semibold text-cinema-text">
                  {profile?.nickname ?? participantNickname}
                </div>
              )}
              {profile && (
                <div className="text-xs text-cinema-muted">@{profile.username}</div>
              )}
              {profile && (
                <div className="text-xs text-slate-600 mt-0.5">
                  Member since {new Date(profile.createdAt).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Guest badge — no DB account */}
        {!loading && isGuest && (
          <div className="flex items-center gap-2 text-xs text-slate-500 glass rounded-lg px-3 py-2 mb-4">
            <Users size={12} />
            Guest — no account, no profile data
          </div>
        )}

        {/* Transfer button available even for guests */}
        {!loading && isGuest && !isSelf && isLeader && (
          <button
            onClick={() => { onTransferLeader(); onClose() }}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg glass text-yellow-400 hover:bg-yellow-500/10 transition-colors w-full justify-center"
          >
            <Crown size={13} />
            Transfer Leadership
          </button>
        )}

        {!loading && profile && (
          <>
            {/* Private badge */}
            {profile.isPrivate && !isSelf && (
              <div className="flex items-center gap-2 text-xs text-slate-500 glass rounded-lg px-3 py-2 mb-4">
                <Lock size={12} />
                Private account — history and friends are hidden
              </div>
            )}

            {/* Watch history */}
            {profile.watchHistory && profile.watchHistory.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 uppercase tracking-wide mb-2">
                  <Clock size={11} />
                  Recently watched
                </div>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {profile.watchHistory.slice(0, 8).map((w, i) => (
                    <div key={i} className="glass rounded-lg px-3 py-1.5">
                      <div className="text-xs text-cinema-text truncate">{w.mediaTitle}</div>
                      <div className="text-xs text-slate-600">{w.roomName} · {new Date(w.watchedAt).toLocaleDateString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Friends */}
            {profile.friends && profile.friends.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 uppercase tracking-wide mb-2">
                  <Users size={11} />
                  Friends ({profile.friends.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {profile.friends.slice(0, 10).map(f => (
                    <div key={f.id} className="flex items-center gap-1.5 glass rounded-full px-2.5 py-1">
                      <Avatar
                        seed={f.avatarSeed || f.id}
                        name={f.nickname}
                        src={`https://api.dicebear.com/7.x/thumbs/svg?seed=${f.avatarSeed}&backgroundColor=7c3aed,3b82f6`}
                        size={16}
                      />
                      <span className="text-xs text-cinema-muted">{f.nickname}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {!isSelf && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={toggleFriend}
                  disabled={friendLoading}
                  className="btn-secondary flex-1 text-sm py-2"
                >
                  {isFriend ? 'Remove friend' : 'Add friend'}
                </button>

                {isLeader && (
                  <button
                    onClick={() => { onTransferLeader(); onClose() }}
                    className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg glass text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                  >
                    <Crown size={13} />
                    Transfer
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
