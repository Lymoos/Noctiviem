import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import * as rm from './roomManager';
import { mediaLibrary } from './data';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ─── REST API ────────────────────────────────────────────────────────────────
app.get('/api/media', (_req, res) => {
  res.json(mediaLibrary);
});

app.get('/api/media/:id', (req, res) => {
  const item = mediaLibrary.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.get('/api/rooms/invite/:code', (req, res) => {
  const room = rm.getRoomByInviteCode(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id,
    name: room.name,
    mediaTitle: room.mediaTitle,
    mediaPoster: room.mediaPoster,
    participantCount: room.participants.length,
    maxParticipants: room.maxParticipants,
    isLocked: room.isLocked,
    leaderId: room.leaderId,
  });
});

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  const userId = (socket.handshake.query.userId as string) || uuidv4();
  const nickname = (socket.handshake.query.nickname as string) || `Guest_${userId.slice(0, 4)}`;

  socket.data.userId = userId;
  socket.data.nickname = nickname;
  socket.data.roomId = null as string | null;

  console.log(`[+] ${nickname} (${socket.id})`);

  // ── CREATE ROOM ─────────────────────────────────────────────────────────
  socket.on('room:create', (data: { name: string; mediaId: string; maxParticipants?: number }, cb) => {
    const media = mediaLibrary.find(m => m.id === data.mediaId);
    if (!media) { cb({ error: 'Media not found' }); return; }
    if (media.status !== 'ready') { cb({ error: 'Media is not ready' }); return; }

    const room = rm.createRoom(
      data.name.trim() || 'Movie Night',
      media.id, media.title, media.poster, media.duration,
      data.maxParticipants || 24,
      socket.data.userId, socket.id, socket.data.nickname,
    );

    socket.data.roomId = room.id;
    socket.join(room.id);
    cb({ room, media, userId: socket.data.userId });
  });

  // ── JOIN ROOM ────────────────────────────────────────────────────────────
  socket.on('room:join', (data: { roomId: string }, cb) => {
    const result = rm.joinRoom(data.roomId, socket.data.userId, socket.id, socket.data.nickname);
    if ('error' in result) { cb({ error: result.error }); return; }

    const media = mediaLibrary.find(m => m.id === result.room.mediaId);
    socket.data.roomId = result.room.id;
    socket.join(result.room.id);

    socket.to(result.room.id).emit('room:participant_join', {
      participant: result.user,
      participants: result.room.participants,
    });

    cb({ room: result.room, user: result.user, media, userId: socket.data.userId });
  });

  // ── LEAVE ROOM ───────────────────────────────────────────────────────────
  socket.on('room:leave', () => {
    handleLeave(socket.data.roomId, socket.data.userId, socket);
  });

  // ── PLAYBACK ─────────────────────────────────────────────────────────────
  socket.on('room:play', (data: { currentTime: number }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { isPlaying: true, currentTime: data.currentTime });
    io.to(socket.data.roomId!).emit('room:sync', { isPlaying: true, currentTime: data.currentTime, updatedAt: Date.now() });
  });

  socket.on('room:pause', (data: { currentTime: number }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { isPlaying: false, currentTime: data.currentTime });
    io.to(socket.data.roomId!).emit('room:sync', { isPlaying: false, currentTime: data.currentTime, updatedAt: Date.now() });
  });

  socket.on('room:seek', (data: { currentTime: number }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { currentTime: data.currentTime });
    io.to(socket.data.roomId!).emit('room:sync', { currentTime: data.currentTime, updatedAt: Date.now() });
  });

  socket.on('room:audio', (data: { audioIndex: number }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { selectedAudio: data.audioIndex });
    io.to(socket.data.roomId!).emit('room:audio', { audioIndex: data.audioIndex });
  });

  socket.on('room:subs', (data: { subsId: string }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { selectedSubs: data.subsId });
    io.to(socket.data.roomId!).emit('room:subs', { subsId: data.subsId });
  });

  socket.on('room:quality', (data: { quality: string }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { selectedQuality: data.quality });
    io.to(socket.data.roomId!).emit('room:quality', { quality: data.quality });
  });

  // ── HEARTBEAT ────────────────────────────────────────────────────────────
  socket.on('room:heartbeat', (data: { currentTime: number; isPlaying: boolean }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomPlayback(socket.data.roomId!, { currentTime: data.currentTime, isPlaying: data.isPlaying });
    socket.to(socket.data.roomId!).emit('room:heartbeat', {
      currentTime: data.currentTime,
      isPlaying: data.isPlaying,
      updatedAt: Date.now(),
    });
  });

  // ── CHAT ─────────────────────────────────────────────────────────────────
  socket.on('room:message', (data: { text: string }, cb?: (r: unknown) => void) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rm.getRoomById(roomId);
    if (!room) return;
    if (!room.chatEnabled && room.leaderId !== socket.data.userId) return;

    const msg = rm.addMessage(roomId, {
      userId: socket.data.userId,
      nickname: socket.data.nickname,
      text: data.text.substring(0, 500).trim(),
    });
    if (msg) {
      io.to(roomId).emit('room:message', msg);
      cb?.({ success: true });
    }
  });

  socket.on('room:whisper', (data: { targetUserId: string; text: string }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rm.getRoomById(roomId);
    if (!room) return;
    const target = room.participants.find(p => p.id === data.targetUserId);
    if (!target) return;

    const msg = rm.addMessage(roomId, {
      userId: socket.data.userId,
      nickname: socket.data.nickname,
      text: data.text.substring(0, 500).trim(),
      isWhisper: true,
      whisperTo: target.nickname,
      whisperToId: data.targetUserId,
    });
    if (msg) {
      socket.emit('room:message', msg);
      const targetSocket = io.sockets.sockets.get(target.socketId);
      targetSocket?.emit('room:message', msg);
    }
  });

  socket.on('room:delete_message', (data: { messageId: string }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !isLeader(socket)) return;
    rm.deleteMessage(roomId, data.messageId);
    io.to(roomId).emit('room:message_deleted', { messageId: data.messageId });
  });

  // ── REACTIONS ────────────────────────────────────────────────────────────
  socket.on('room:reaction', (data: { emoji: string; currentTime: number }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rm.getRoomById(roomId);
    if (!room || !room.reactionsEnabled) return;

    const reaction = rm.addReaction(roomId, {
      userId: socket.data.userId,
      nickname: socket.data.nickname,
      emoji: data.emoji,
      timestamp: Date.now(),
      timelinePosition: data.currentTime,
    });
    if (reaction) io.to(roomId).emit('room:reaction', reaction);
  });

  // ── LEADER SETTINGS ──────────────────────────────────────────────────────
  socket.on('room:kick', (data: { targetUserId: string }) => {
    const roomId = socket.data.roomId;
    if (!roomId || !isLeader(socket)) return;
    const room = rm.getRoomById(roomId);
    if (!room) return;
    const target = room.participants.find(p => p.id === data.targetUserId);
    if (!target || target.isLeader) return;

    const updated = rm.leaveRoom(roomId, data.targetUserId);
    const targetSocket = io.sockets.sockets.get(target.socketId);
    targetSocket?.emit('room:kicked');
    targetSocket?.leave(roomId);

    if (updated) {
      io.to(roomId).emit('room:participant_leave', {
        userId: data.targetUserId,
        participants: updated.participants,
        newLeaderId: updated.leaderId,
      });
    }
  });

  socket.on('room:chat_toggle', (data: { enabled: boolean }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomSettings(socket.data.roomId!, { chatEnabled: data.enabled });
    io.to(socket.data.roomId!).emit('room:settings_update', { chatEnabled: data.enabled });
  });

  socket.on('room:reactions_toggle', (data: { enabled: boolean }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomSettings(socket.data.roomId!, { reactionsEnabled: data.enabled });
    io.to(socket.data.roomId!).emit('room:settings_update', { reactionsEnabled: data.enabled });
  });

  socket.on('room:lock', (data: { locked: boolean }) => {
    if (!isLeader(socket)) return;
    rm.updateRoomSettings(socket.data.roomId!, { isLocked: data.locked });
    io.to(socket.data.roomId!).emit('room:settings_update', { isLocked: data.locked });
  });

  // ── DISCONNECT ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.data.nickname} (${socket.id})`);
    handleLeave(socket.data.roomId, socket.data.userId, socket);
  });

  // ── HELPERS ──────────────────────────────────────────────────────────────
  function isLeader(s: typeof socket): boolean {
    const roomId = s.data.roomId;
    if (!roomId) return false;
    const room = rm.getRoomById(roomId);
    return !!room && room.leaderId === s.data.userId;
  }

  function handleLeave(roomId: string | null, userId: string, s: typeof socket) {
    if (!roomId) return;
    const room = rm.leaveRoom(roomId, userId);
    s.leave(roomId);
    s.data.roomId = null;
    if (room) {
      io.to(roomId).emit('room:participant_leave', {
        userId,
        participants: room.participants,
        newLeaderId: room.leaderId,
      });
    }
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🎬 Noctiviem backend → http://localhost:${PORT}`);
});
