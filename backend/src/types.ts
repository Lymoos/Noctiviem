export interface User {
  id: string;
  nickname: string;
  avatar: string;
  isLeader: boolean;
  seatNumber: number;
  socketId: string;
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
  leaderSocketId: string;
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
