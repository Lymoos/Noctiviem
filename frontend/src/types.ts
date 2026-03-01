export interface User {
  id: string;
  nickname: string;
  avatar: string;
  isLeader: boolean;
  seatNumber: number;
}

export interface Message {
  id: string;
  userId: string;
  nickname: string;
  text: string;
  timestamp: number;
  isWhisper?: boolean;
  whisperTo?: string;
  whisperToId?: string;
}

export interface Reaction {
  id: string;
  userId: string;
  nickname: string;
  emoji: string;
  timestamp: number;
  timelinePosition: number;
}

export interface RoomState {
  id: string;
  name: string;
  inviteCode: string;
  mediaId: string;
  mediaTitle: string;
  mediaPoster: string;
  mediaDuration: number;
  currentTime: number;
  isPlaying: boolean;
  selectedAudio: number;
  selectedSubs: string;
  selectedQuality: string;
  chatEnabled: boolean;
  reactionsEnabled: boolean;
  isLocked: boolean;
  maxParticipants: number;
  participants: User[];
  messages: Message[];
  reactions: Reaction[];
  leaderId: string;
  createdAt: number;
  updatedAt: number;
}

export interface MediaItem {
  id: string;
  title: string;
  poster: string;
  thumbnail: string;
  duration: number;
  year: number;
  genre: string;
  description: string;
  audio: { id: number; label: string; lang: string }[];
  subtitles: { id: string; label: string; lang: string }[];
  qualities: string[];
  status: 'ready' | 'processing' | 'error';
  videoUrl: string;
}

export interface RoomPreview {
  id: string;
  name: string;
  mediaTitle: string;
  mediaPoster: string;
  participantCount: number;
  maxParticipants: number;
  isLocked: boolean;
  leaderId: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface UserSettings {
  nickname: string;
  avatarSeed: string;
  defaultQuality: string;
  defaultAudioLang: string;
  defaultSubsLang: string;
  maxConcurrentDownloads: number;
  autoSyncOnJoin: boolean;
}

export interface Account {
  id: string;
  username: string;
  email: string;
  createdAt: number;
  settings: UserSettings;
}

// ── Downloads ─────────────────────────────────────────────────────────────────
export interface DownloadFile {
  name: string;
  size: number;
  progress: number;
  isVideo: boolean;
}

export interface DownloadItem {
  id: string;
  name: string;
  status: 'queued' | 'metadata' | 'downloading' | 'completed' | 'error' | 'paused';
  progress: number;
  downloaded: number;
  total: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  eta: number;
  files: DownloadFile[];
  error?: string;
  createdAt: number;
  completedAt?: number;
  mediaIds: string[];
}

export interface ActiveBubble {
  userId: string;
  text: string;
  id: string;
}

export interface FloatingReaction {
  id: string;
  userId: string;
  emoji: string;
  seatNumber: number;
}
