import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as rm from './roomManager';
import * as auth from './auth';
import * as dl from './downloads';
import { MediaItem } from './types';

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ── Multer for .torrent uploads ──────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.torrent') || file.mimetype === 'application/x-bittorrent') {
      cb(null, true);
    } else {
      cb(new Error('Only .torrent files are accepted'));
    }
  },
});

// ── Dynamic media library ────────────────────────────────────────────────────
const mediaLibrary: MediaItem[] = [];

dl.setOnCompleted((item) => {
  item.files
    .filter(f => f.isVideo)
    .forEach(f => {
      if (mediaLibrary.find(m => m.title === f.name.replace(/\.[^.]+$/, ''))) return;
      const mediaItem: MediaItem = {
        id: uuidv4(),
        title: f.name.replace(/\.[^.]+$/, ''),
        poster: `https://picsum.photos/seed/${item.id}/400/600`,
        thumbnail: `https://picsum.photos/seed/${item.id}/800/450`,
        duration: 0,
        year: new Date().getFullYear(),
        genre: 'Downloaded',
        description: `Downloaded via torrent: ${item.name}`,
        audio: [{ id: 0, label: 'Track 1', lang: 'und' }],
        subtitles: [{ id: 'off', label: 'Off', lang: 'off' }],
        qualities: ['Auto'],
        status: 'ready',
        videoUrl: `/media/${encodeURIComponent(item.name)}/${encodeURIComponent(f.name)}`,
      };
      mediaLibrary.push(mediaItem);
      item.mediaIds.push(mediaItem.id);
    });
  io.emit('media:updated', mediaLibrary);
});

app.use('/media', express.static(dl.DOWNLOADS_DIR));

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const userId = auth.verifyToken(h.slice(7));
  if (!userId) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
  (req as any).userId = userId;
  next();
}

// ── Auth routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'All fields required' }); return; }
  const r = auth.register(username, email, password);
  if ('error' in r) { res.status(400).json(r); return; }
  res.json(r);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }
  const r = auth.login(email, password);
  if ('error' in r) { res.status(401).json(r); return; }
  res.json(r);
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = auth.getById((req as any).userId);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user });
});

app.patch('/api/auth/settings', requireAuth, (req, res) => {
  const r = auth.updateSettings((req as any).userId, req.body);
  if ('error' in r) { res.status(400).json(r); return; }
  res.json(r);
});

app.delete('/api/auth/account', requireAuth, (req, res) => {
  auth.deleteAccount((req as any).userId);
  res.json({ success: true });
});

// ── Media routes ─────────────────────────────────────────────────────────────
app.get('/api/media', requireAuth, (_req, res) => { res.json(mediaLibrary); });

app.get('/api/media/:id', requireAuth, (req, res) => {
  const item = mediaLibrary.find(m => m.id === req.params.id);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

// ── Download routes ───────────────────────────────────────────────────────────
app.get('/api/downloads', requireAuth, (_req, res) => { res.json(dl.list()); });

app.post('/api/downloads', requireAuth, upload.single('torrent'), (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No .torrent file uploaded' }); return; }
  const item = dl.add(req.file.path, req.file.originalname);
  res.json(item);
});

app.delete('/api/downloads/:id', requireAuth, (req, res) => {
  res.json({ success: dl.remove(req.params.id) });
});

// ── Room invite preview (public — shareable link) ─────────────────────────────
app.get('/api/rooms/invite/:code', (req, res) => {
  const room = rm.getRoomByInviteCode(req.params.code);
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  res.json({
    id: room.id, name: room.name, mediaTitle: room.mediaTitle,
    mediaPoster: room.mediaPoster, participantCount: room.participants.length,
    maxParticipants: room.maxParticipants, isLocked: room.isLocked, leaderId: room.leaderId,
  });
});

// ── Socket.io download broadcast ─────────────────────────────────────────────
dl.setBroadcast((items) => io.emit('downloads:update', items));

// ── Socket.io rooms ───────────────────────────────────────────────────────────
io.on('connection', socket => {
  const userId = (socket.handshake.query.userId as string) || uuidv4();
  const nickname = (socket.handshake.query.nickname as string) || `Guest_${userId.slice(0, 4)}`;
  socket.data.userId = userId;
  socket.data.nickname = nickname;
  socket.data.roomId = null as string | null;

  console.log(`[+] ${nickname} (${socket.id})`);

  socket.on('room:create', (data: { name: string; mediaId: string; maxParticipants?: number }, cb) => {
    const media = mediaLibrary.find(m => m.id === data.mediaId);
    if (!media) { cb({ error: 'Media not found' }); return; }
    if (media.status !== 'ready') { cb({ error: 'Media is not ready' }); return; }
    const room = rm.createRoom(data.name.trim() || 'Movie Night', media.id, media.title, media.poster, media.duration, data.maxParticipants || 24, socket.data.userId, socket.id, socket.data.nickname);
    socket.data.roomId = room.id;
    socket.join(room.id);
    cb({ room, media, userId: socket.data.userId });
  });

  socket.on('room:join', (data: { roomId: string }, cb) => {
    const result = rm.joinRoom(data.roomId, socket.data.userId, socket.id, socket.data.nickname);
    if ('error' in result) { cb({ error: result.error }); return; }
    const media = mediaLibrary.find(m => m.id === result.room.mediaId);
    socket.data.roomId = result.room.id;
    socket.join(result.room.id);
    socket.to(result.room.id).emit('room:participant_join', { participant: result.user, participants: result.room.participants });
    cb({ room: result.room, user: result.user, media, userId: socket.data.userId });
  });

  socket.on('room:leave', () => doLeave(socket.data.roomId, socket.data.userId, socket));

  socket.on('room:play',  (d: { currentTime: number }) => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { isPlaying: true,  currentTime: d.currentTime }); io.to(socket.data.roomId!).emit('room:sync', { isPlaying: true,  currentTime: d.currentTime, updatedAt: Date.now() }); });
  socket.on('room:pause', (d: { currentTime: number }) => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { isPlaying: false, currentTime: d.currentTime }); io.to(socket.data.roomId!).emit('room:sync', { isPlaying: false, currentTime: d.currentTime, updatedAt: Date.now() }); });
  socket.on('room:seek',  (d: { currentTime: number }) => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { currentTime: d.currentTime }); io.to(socket.data.roomId!).emit('room:sync', { currentTime: d.currentTime, updatedAt: Date.now() }); });
  socket.on('room:audio',   (d: { audioIndex: number }) => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { selectedAudio: d.audioIndex }); io.to(socket.data.roomId!).emit('room:audio', d); });
  socket.on('room:subs',    (d: { subsId: string })     => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { selectedSubs: d.subsId }); io.to(socket.data.roomId!).emit('room:subs', d); });
  socket.on('room:quality', (d: { quality: string })    => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, { selectedQuality: d.quality }); io.to(socket.data.roomId!).emit('room:quality', d); });
  socket.on('room:heartbeat', (d: { currentTime: number; isPlaying: boolean }) => { if (!isLeader()) return; rm.updateRoomPlayback(socket.data.roomId!, d); socket.to(socket.data.roomId!).emit('room:heartbeat', { ...d, updatedAt: Date.now() }); });

  socket.on('room:message', (d: { text: string }, cb?: (r: unknown) => void) => {
    const rid = socket.data.roomId; if (!rid) return;
    const room = rm.getRoomById(rid); if (!room) return;
    if (!room.chatEnabled && room.leaderId !== socket.data.userId) return;
    const msg = rm.addMessage(rid, { userId: socket.data.userId, nickname: socket.data.nickname, text: d.text.substring(0, 500).trim() });
    if (msg) { io.to(rid).emit('room:message', msg); cb?.({ success: true }); }
  });

  socket.on('room:whisper', (d: { targetUserId: string; text: string }) => {
    const rid = socket.data.roomId; if (!rid) return;
    const room = rm.getRoomById(rid); if (!room) return;
    const target = room.participants.find(p => p.id === d.targetUserId); if (!target) return;
    const msg = rm.addMessage(rid, { userId: socket.data.userId, nickname: socket.data.nickname, text: d.text.substring(0, 500).trim(), isWhisper: true, whisperTo: target.nickname, whisperToId: d.targetUserId });
    if (msg) { socket.emit('room:message', msg); io.sockets.sockets.get(target.socketId)?.emit('room:message', msg); }
  });

  socket.on('room:delete_message', (d: { messageId: string }) => {
    const rid = socket.data.roomId; if (!rid || !isLeader()) return;
    rm.deleteMessage(rid, d.messageId);
    io.to(rid).emit('room:message_deleted', { messageId: d.messageId });
  });

  socket.on('room:reaction', (d: { emoji: string; currentTime: number }) => {
    const rid = socket.data.roomId; if (!rid) return;
    const room = rm.getRoomById(rid); if (!room || !room.reactionsEnabled) return;
    const r = rm.addReaction(rid, { userId: socket.data.userId, nickname: socket.data.nickname, emoji: d.emoji, timestamp: Date.now(), timelinePosition: d.currentTime });
    if (r) io.to(rid).emit('room:reaction', r);
  });

  socket.on('room:kick', (d: { targetUserId: string }) => {
    const rid = socket.data.roomId; if (!rid || !isLeader()) return;
    const room = rm.getRoomById(rid); if (!room) return;
    const target = room.participants.find(p => p.id === d.targetUserId); if (!target || target.isLeader) return;
    const updated = rm.leaveRoom(rid, d.targetUserId);
    const ts = io.sockets.sockets.get(target.socketId);
    ts?.emit('room:kicked'); ts?.leave(rid);
    if (updated) io.to(rid).emit('room:participant_leave', { userId: d.targetUserId, participants: updated.participants, newLeaderId: updated.leaderId });
  });

  socket.on('room:chat_toggle',      (d: { enabled: boolean }) => { if (!isLeader()) return; rm.updateRoomSettings(socket.data.roomId!, { chatEnabled: d.enabled });      io.to(socket.data.roomId!).emit('room:settings_update', { chatEnabled: d.enabled }); });
  socket.on('room:reactions_toggle', (d: { enabled: boolean }) => { if (!isLeader()) return; rm.updateRoomSettings(socket.data.roomId!, { reactionsEnabled: d.enabled }); io.to(socket.data.roomId!).emit('room:settings_update', { reactionsEnabled: d.enabled }); });
  socket.on('room:lock',             (d: { locked: boolean })  => { if (!isLeader()) return; rm.updateRoomSettings(socket.data.roomId!, { isLocked: d.locked });           io.to(socket.data.roomId!).emit('room:settings_update', { isLocked: d.locked }); });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.data.nickname} (${socket.id})`);
    doLeave(socket.data.roomId, socket.data.userId, socket);
  });

  function isLeader(): boolean {
    const rid = socket.data.roomId; if (!rid) return false;
    const room = rm.getRoomById(rid);
    return !!room && room.leaderId === socket.data.userId;
  }

  function doLeave(roomId: string | null, userId: string, s: typeof socket) {
    if (!roomId) return;
    const room = rm.leaveRoom(roomId, userId);
    s.leave(roomId); s.data.roomId = null;
    if (room) io.to(roomId).emit('room:participant_leave', { userId, participants: room.participants, newLeaderId: room.leaderId });
  }
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`🎬 Noctiviem backend → http://localhost:${PORT}`));
