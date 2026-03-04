import { create } from 'zustand';
import { RoomState, User, Message, Reaction, MediaItem, Account, DownloadItem } from './types';
import { Lang } from './i18n';
import { randomUUID } from './utils';

// ── Token helpers ────────────────────────────────────────────────────────────
const TOKEN_KEY = 'noctiviem_token';
const USERID_KEY = 'noctiviem_userId';
const NICK_KEY = 'noctiviem_nickname';
const LANG_KEY = 'noctiviem_lang';

function detectLang(): Lang {
  const stored = localStorage.getItem(LANG_KEY) as Lang | null;
  if (stored === 'ru' || stored === 'en') return stored;
  return navigator.language.startsWith('ru') ? 'ru' : 'en';
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const storedUserId = localStorage.getItem(USERID_KEY) || randomUUID();
const storedNickname = localStorage.getItem(NICK_KEY) || `Viewer_${storedUserId.slice(0, 4).toUpperCase()}`;
if (!localStorage.getItem(USERID_KEY)) localStorage.setItem(USERID_KEY, storedUserId);
if (!localStorage.getItem(NICK_KEY)) localStorage.setItem(NICK_KEY, storedNickname);

// ── Fetch helpers ────────────────────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T & { error?: string }> {
  const r = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers ?? {}) },
  });
  return r.json() as Promise<T & { error?: string }>;
}

export async function apiPost<T = unknown>(url: string, body: unknown): Promise<T & { error?: string }> {
  return apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function apiPatch<T = unknown>(url: string, body: unknown): Promise<T & { error?: string }> {
  return apiFetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export async function apiDelete(url: string) {
  return apiFetch<{ success: boolean }>(url, { method: 'DELETE' });
}

// ── Store interface ──────────────────────────────────────────────────────────
interface AppStore {
  account: Account | null;
  isAuthenticated: boolean;
  userId: string;
  nickname: string;
  setAccount: (account: Account, token: string) => void;
  updateAccount: (account: Account) => void;
  logout: () => void;
  setNickname: (n: string) => void;

  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;

  mediaLibrary: MediaItem[];
  setMediaLibrary: (items: MediaItem[]) => void;

  downloads: DownloadItem[];
  setDownloads: (items: DownloadItem[]) => void;
  downloadsOpen: boolean;
  toggleDownloads: () => void;

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

  chatOpen: boolean;
  toggleChat: () => void;
  leaderPanelOpen: boolean;
  toggleLeaderPanel: () => void;
}

export const useStore = create<AppStore>((set) => ({
  account: null,
  isAuthenticated: !!getToken(),
  userId: storedUserId,
  nickname: storedNickname,

  setAccount: (account, token) => {
    setToken(token);
    localStorage.setItem(NICK_KEY, account.settings.nickname);
    // Sync socket userId to the authenticated user's DB ID so profile lookups work
    localStorage.setItem(USERID_KEY, account.id);
    set({ account, isAuthenticated: true, nickname: account.settings.nickname, userId: account.id });
  },

  updateAccount: (account) => {
    localStorage.setItem(NICK_KEY, account.settings.nickname);
    set({ account, nickname: account.settings.nickname });
  },

  logout: () => {
    clearToken();
    set({ account: null, isAuthenticated: false });
  },

  setNickname: (n) => {
    localStorage.setItem(NICK_KEY, n);
    set({ nickname: n });
  },

  lang: detectLang(),
  setLang: (l) => {
    localStorage.setItem(LANG_KEY, l);
    set({ lang: l });
  },
  toggleLang: () => set(s => {
    const next: Lang = s.lang === 'ru' ? 'en' : 'ru';
    localStorage.setItem(LANG_KEY, next);
    return { lang: next };
  }),

  mediaLibrary: [],
  setMediaLibrary: (items) => set({ mediaLibrary: items }),

  downloads: [],
  setDownloads: (items) => set({ downloads: items }),
  downloadsOpen: false,
  toggleDownloads: () => set(s => ({ downloadsOpen: !s.downloadsOpen })),

  room: null,
  media: null,
  currentUser: null,
  isInRoom: false,
  setRoom: (room, media = null) => set({ room, media: media ?? null, isInRoom: true }),
  setCurrentUser: (u) => set({ currentUser: u }),

  updateRoomSync: (data) => set(s => ({ room: s.room ? { ...s.room, ...data } : null })),
  updateRoomSettings: (data) => set(s => ({ room: s.room ? { ...s.room, ...data } : null })),

  updateParticipants: (participants, newLeaderId) => set(s => {
    if (!s.room) return {};
    const room = { ...s.room, participants, ...(newLeaderId ? { leaderId: newLeaderId } : {}) };
    const currentUser = s.currentUser ? participants.find(p => p.id === s.currentUser!.id) ?? s.currentUser : null;
    return { room, currentUser };
  }),

  addParticipant: (_p, participants) => set(s => ({ room: s.room ? { ...s.room, participants } : null })),

  addMessage: (msg) => set(s => {
    if (!s.room) return {};
    return { room: { ...s.room, messages: [...s.room.messages, msg].slice(-300) } };
  }),

  deleteMessage: (id) => set(s => {
    if (!s.room) return {};
    return { room: { ...s.room, messages: s.room.messages.filter(m => m.id !== id) } };
  }),

  addReaction: (r) => set(s => {
    if (!s.room) return {};
    return { room: { ...s.room, reactions: [...s.room.reactions, r].slice(-500) } };
  }),

  clearRoom: () => set({ room: null, media: null, currentUser: null, isInRoom: false }),

  chatOpen: true,
  toggleChat: () => set(s => ({ chatOpen: !s.chatOpen })),
  leaderPanelOpen: false,
  toggleLeaderPanel: () => set(s => ({ leaderPanelOpen: !s.leaderPanelOpen })),
}));

export const selectIsLeader = (s: AppStore) => s.currentUser?.isLeader ?? false;
