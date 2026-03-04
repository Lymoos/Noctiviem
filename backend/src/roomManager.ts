import { v4 as uuidv4 } from 'uuid';
import { RoomState, User, Message, Reaction } from './types';

const rooms = new Map<string, RoomState>();
const inviteCodeToRoomId = new Map<string, string>();
// Grace period timers: don't delete empty rooms immediately, give 60s to reconnect
const deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function createRoom(
  name: string,
  mediaId: string,
  mediaTitle: string,
  mediaPoster: string,
  mediaDuration: number,
  maxParticipants: number,
  leaderId: string,
  leaderSocketId: string,
  leaderNickname: string,
  leaderSpecialRole?: string | null,
): RoomState {
  const id = uuidv4();
  const inviteCode = generateInviteCode();

  const leader: User = {
    id: leaderId,
    nickname: leaderNickname,
    avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${leaderId}&backgroundColor=7c3aed,3b82f6`,
    isLeader: true,
    seatNumber: 1,
    socketId: leaderSocketId,
    specialRole: leaderSpecialRole ?? null,
  };

  const room: RoomState = {
    id,
    name,
    inviteCode,
    mediaId,
    mediaTitle,
    mediaPoster,
    mediaDuration,
    currentTime: 0,
    isPlaying: false,
    selectedAudio: 0,
    selectedSubs: 'off',
    selectedQuality: 'Auto',
    chatEnabled: true,
    reactionsEnabled: true,
    isLocked: false,
    maxParticipants,
    participants: [leader],
    messages: [],
    reactions: [],
    leaderId,
    leaderSocketId,
    queuedMediaId: null,
    queuedMediaTitle: null,
    queuedMediaPoster: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  rooms.set(id, room);
  inviteCodeToRoomId.set(inviteCode, id);
  return room;
}

export function getRoomById(id: string): RoomState | undefined {
  return rooms.get(id);
}

export function getRoomByInviteCode(code: string): RoomState | undefined {
  const id = inviteCodeToRoomId.get(code.toUpperCase());
  if (!id) return undefined;
  return rooms.get(id);
}

export function joinRoom(
  roomId: string,
  userId: string,
  socketId: string,
  nickname: string,
  specialRole?: string | null,
): { room: RoomState; user: User } | { error: string } {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  // Cancel any pending deletion since someone is joining
  if (deletionTimers.has(roomId)) {
    clearTimeout(deletionTimers.get(roomId)!);
    deletionTimers.delete(roomId);
  }

  const existing = room.participants.find(p => p.id === userId);
  if (existing) {
    // Reconnecting user — update socketId and refresh specialRole
    existing.socketId = socketId;
    if (specialRole !== undefined) existing.specialRole = specialRole;
    return { room, user: existing };
  }

  if (room.isLocked) return { error: 'Room is locked by the Leader' };
  if (room.participants.length >= room.maxParticipants) return { error: 'Room is full' };

  const occupiedSeats = new Set(room.participants.map(p => p.seatNumber));
  let seatNumber = 1;
  while (occupiedSeats.has(seatNumber)) seatNumber++;

  const user: User = {
    id: userId,
    nickname,
    avatar: `https://api.dicebear.com/7.x/thumbs/svg?seed=${userId}&backgroundColor=0f1115`,
    isLeader: false,
    seatNumber,
    socketId,
    specialRole: specialRole ?? null,
  };

  room.participants.push(user);
  room.updatedAt = Date.now();
  return { room, user };
}

export function queueMedia(
  roomId: string,
  mediaId: string | null,
  mediaTitle: string | null,
  mediaPoster: string | null,
): RoomState | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  room.queuedMediaId = mediaId;
  room.queuedMediaTitle = mediaTitle;
  room.queuedMediaPoster = mediaPoster;
  room.updatedAt = Date.now();
  return room;
}

export function switchToQueuedMedia(
  roomId: string,
  mediaId: string,
  mediaTitle: string,
  mediaPoster: string,
  mediaDuration: number,
): RoomState | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  room.mediaId = mediaId;
  room.mediaTitle = mediaTitle;
  room.mediaPoster = mediaPoster;
  room.mediaDuration = mediaDuration;
  room.currentTime = 0;
  room.isPlaying = false;
  room.selectedAudio = 0;
  room.selectedSubs = 'off';
  room.queuedMediaId = null;
  room.queuedMediaTitle = null;
  room.queuedMediaPoster = null;
  room.updatedAt = Date.now();
  return room;
}

export function leaveRoom(roomId: string, userId: string): RoomState | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;

  room.participants = room.participants.filter(p => p.id !== userId);
  room.updatedAt = Date.now();

  if (room.participants.length === 0) {
    // Don't delete immediately — give 60s grace period for reconnects
    if (!deletionTimers.has(room.id)) {
      const timer = setTimeout(() => {
        rooms.delete(room.id);
        inviteCodeToRoomId.delete(room.inviteCode);
        deletionTimers.delete(room.id);
        console.log(`[room] ${room.id} expired after grace period`);
      }, 60_000);
      deletionTimers.set(room.id, timer);
    }
    return room; // return room (empty) so callers can broadcast leave
  }

  if (userId === room.leaderId && room.participants.length > 0) {
    room.participants[0].isLeader = true;
    room.leaderId = room.participants[0].id;
    room.leaderSocketId = room.participants[0].socketId;
  }

  return room;
}

export function addMessage(
  roomId: string,
  message: Omit<Message, 'id' | 'timestamp'>,
): Message | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;

  const msg: Message = {
    ...message,
    id: uuidv4(),
    timestamp: Date.now(),
  };

  room.messages.push(msg);
  if (room.messages.length > 300) room.messages = room.messages.slice(-300);
  return msg;
}

export function addReaction(
  roomId: string,
  reaction: Omit<Reaction, 'id'>,
): Reaction | undefined {
  const room = rooms.get(roomId);
  if (!room) return undefined;

  const r: Reaction = { ...reaction, id: uuidv4() };
  room.reactions.push(r);
  if (room.reactions.length > 500) room.reactions = room.reactions.slice(-500);
  return r;
}

export function updateRoomPlayback(
  roomId: string,
  update: Partial<Pick<RoomState, 'currentTime' | 'isPlaying' | 'selectedAudio' | 'selectedSubs' | 'selectedQuality'>>,
): void {
  const room = rooms.get(roomId);
  if (!room) return;
  Object.assign(room, update, { updatedAt: Date.now() });
}

export function updateRoomSettings(
  roomId: string,
  update: Partial<Pick<RoomState, 'chatEnabled' | 'reactionsEnabled' | 'isLocked'>>,
): void {
  const room = rooms.get(roomId);
  if (!room) return;
  Object.assign(room, update, { updatedAt: Date.now() });
}

export function transferLeader(roomId: string, fromUserId: string, toUserId: string): RoomState | undefined {
  const room = rooms.get(roomId);
  if (!room || room.leaderId !== fromUserId) return undefined;
  const target = room.participants.find(p => p.id === toUserId);
  if (!target) return undefined;
  // Demote current leader
  const current = room.participants.find(p => p.id === fromUserId);
  if (current) current.isLeader = false;
  // Promote target
  target.isLeader = true;
  room.leaderId = toUserId;
  room.leaderSocketId = target.socketId;
  room.updatedAt = Date.now();
  return room;
}

export function deleteMessage(roomId: string, messageId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const before = room.messages.length;
  room.messages = room.messages.filter(m => m.id !== messageId);
  return room.messages.length < before;
}
