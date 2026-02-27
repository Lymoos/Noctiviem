import { create } from 'zustand';
import { RoomState, User, Message, Reaction, MediaItem } from './types';

interface AppStore {
  // Auth
  userId: string;
  nickname: string;
  setNickname: (n: string) => void;

  // Media
  mediaLibrary: MediaItem[];
  setMediaLibrary: (items: MediaItem[]) => void;

  // Room
  room: RoomState | null;
  media: MediaItem | null;
  currentUser: User | null;
  isInRoom: boolean;

  setRoom: (room: RoomState, media?: MediaItem | null) => void;
  setCurrentUser: (user: User) => void;
  updateRoomSync: (data: Partial<Pick<RoomState, 'currentTime' | 'isPlaying'>>) => void;
  updateRoomSettings: (data: Partial<Pick<RoomState, 'chatEnabled' | 'reactionsEnabled' | 'isLocked' | 'selectedAudio' | 'selectedSubs' | 'selectedQuality'>>) => void;
  updateParticipants: (participants: User[], newLeaderId?: string) => void;
  addParticipant: (participant: User, participants: User[]) => void;
  addMessage: (msg: Message) => void;
  deleteMessage: (messageId: string) => void;
  addReaction: (reaction: Reaction) => void;
  clearRoom: () => void;

  // UI
  chatOpen: boolean;
  toggleChat: () => void;
  leaderPanelOpen: boolean;
  toggleLeaderPanel: () => void;
}

const storedUserId = localStorage.getItem('noctiviem_userId') || crypto.randomUUID();
const storedNickname = localStorage.getItem('noctiviem_nickname') || `Viewer_${storedUserId.slice(0, 4).toUpperCase()}`;
if (!localStorage.getItem('noctiviem_userId')) localStorage.setItem('noctiviem_userId', storedUserId);
if (!localStorage.getItem('noctiviem_nickname')) localStorage.setItem('noctiviem_nickname', storedNickname);

export const useStore = create<AppStore>((set, get) => ({
  userId: storedUserId,
  nickname: storedNickname,
  setNickname: (n) => {
    localStorage.setItem('noctiviem_nickname', n);
    set({ nickname: n });
  },

  mediaLibrary: [],
  setMediaLibrary: (items) => set({ mediaLibrary: items }),

  room: null,
  media: null,
  currentUser: null,
  isInRoom: false,

  setRoom: (room, media = null) => set({ room, media, isInRoom: true }),
  setCurrentUser: (user) => set({ currentUser: user }),

  updateRoomSync: (data) => set(state => ({
    room: state.room ? { ...state.room, ...data } : null,
  })),

  updateRoomSettings: (data) => set(state => ({
    room: state.room ? { ...state.room, ...data } : null,
  })),

  updateParticipants: (participants, newLeaderId) => set(state => {
    if (!state.room) return {};
    const updatedRoom = { ...state.room, participants };
    if (newLeaderId) updatedRoom.leaderId = newLeaderId;
    const updatedUser = state.currentUser
      ? participants.find(p => p.id === state.currentUser!.id) || state.currentUser
      : null;
    return { room: updatedRoom, currentUser: updatedUser };
  }),

  addParticipant: (_participant, participants) => set(state => ({
    room: state.room ? { ...state.room, participants } : null,
  })),

  addMessage: (msg) => set(state => {
    if (!state.room) return {};
    const messages = [...state.room.messages, msg].slice(-300);
    return { room: { ...state.room, messages } };
  }),

  deleteMessage: (messageId) => set(state => {
    if (!state.room) return {};
    return {
      room: {
        ...state.room,
        messages: state.room.messages.filter(m => m.id !== messageId),
      },
    };
  }),

  addReaction: (reaction) => set(state => {
    if (!state.room) return {};
    const reactions = [...state.room.reactions, reaction].slice(-500);
    return { room: { ...state.room, reactions } };
  }),

  clearRoom: () => set({ room: null, media: null, currentUser: null, isInRoom: false }),

  chatOpen: true,
  toggleChat: () => set(state => ({ chatOpen: !state.chatOpen })),
  leaderPanelOpen: false,
  toggleLeaderPanel: () => set(state => ({ leaderPanelOpen: !state.leaderPanelOpen })),
}));

// Derived selector helpers
export const selectIsLeader = (state: AppStore) =>
  state.currentUser?.isLeader ?? false;

export const selectParticipantCount = (state: AppStore) =>
  state.room?.participants.length ?? 0;
