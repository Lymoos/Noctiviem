import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import db from './db';

const execFileAsync = promisify(execFile);

// Audio codecs natively supported by all major browsers inside MP4/WebM
const BROWSER_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);

/** Returns true if any audio stream in the file uses a non-browser-safe codec. */
async function needsAudioFix(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      filePath,
    ], { timeout: 10000 });
    const codecs = stdout.trim().split('\n').filter(Boolean);
    return codecs.length > 0 && codecs.some(c => !BROWSER_SAFE_AUDIO.has(c.trim()));
  } catch {
    return false;
  }
}

/**
 * Transcode all audio streams of an existing MP4 to AAC in-place.
 * Video and subtitle streams are stream-copied unchanged.
 */
async function fixAudioInPlace(mp4Path: string): Promise<void> {
  const tmpPath = mp4Path + '.__fix.mp4';
  try {
    console.log(`[audio-fix] transcoding audio in ${path.basename(mp4Path)} → aac`);
    await execFileAsync('ffmpeg', [
      '-i', mp4Path,
      '-map', '0:v', '-map', '0:a',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      tmpPath,
    ], { timeout: 60 * 60 * 1000 });
    fs.renameSync(tmpPath, mp4Path);
    console.log(`[audio-fix] done ${path.basename(mp4Path)}`);
  } catch (e) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw e;
  }
}

/**
 * Remux a video file to MP4.
 * - Copies video stream (no re-encode)
 * - Transcodes ALL audio streams to AAC (browser-compatible)
 * - Maps every audio stream so multilingual tracks are preserved
 * Returns the .mp4 path; if input is already .mp4/.webm, returns it unchanged.
 */
async function remuxToMp4(inputPath: string): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.mp4' || ext === '.webm') return inputPath;
  const outputPath = inputPath.slice(0, -ext.length) + '.mp4';
  if (fs.existsSync(outputPath)) return outputPath;
  console.log(`[remux] ${path.basename(inputPath)} → mp4`);
  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-map', '0:v',       // all video streams
    '-map', '0:a',       // all audio streams
    '-c:v', 'copy',      // copy video — no quality loss, fast
    '-c:a', 'aac',       // transcode audio to AAC (browsers support this)
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ], { timeout: 20 * 60 * 1000 });
  console.log(`[remux] done → ${path.basename(outputPath)}`);
  try {
    await fs.promises.unlink(inputPath);
    console.log(`[remux] deleted original ${path.basename(inputPath)}`);
  } catch (e: any) {
    console.warn(`[remux] could not delete original: ${e.message}`);
  }
  return outputPath;
}

/** Run ffprobe on a video file and extract duration, audio streams, subtitle streams. */
async function probeVideoFile(filePath: string): Promise<{
  duration: number;
  audio: { id: number; label: string; lang: string }[];
  subtitles: { id: string; label: string; lang: string }[];
}> {
  const fallback = {
    duration: 0,
    audio: [{ id: 0, label: 'Track 1', lang: 'und' }],
    subtitles: [{ id: 'off', label: 'Off', lang: 'off' }],
  };
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { timeout: 30000 });

    const data = JSON.parse(stdout);
    const streams: any[] = data.streams ?? [];
    const duration = parseFloat(data.format?.duration ?? '0') || 0;

    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    const subStreams   = streams.filter(s => s.codec_type === 'subtitle');

    const audio = audioStreams.length > 0
      ? audioStreams.map((s, i) => {
          const lang  = s.tags?.language ?? 'und';
          const title = s.tags?.title;
          const label = title ?? (lang !== 'und' ? `${lang.toUpperCase()} — ${s.codec_name ?? 'audio'}` : `Track ${i + 1}`);
          return { id: i, label, lang };
        })
      : fallback.audio;

    const subtitles: { id: string; label: string; lang: string }[] = [
      { id: 'off', label: 'Off', lang: 'off' },
      ...subStreams.map((s, i) => {
        const lang  = s.tags?.language ?? 'und';
        const title = s.tags?.title;
        const label = title ?? (lang !== 'und' ? lang.toUpperCase() : `Sub ${i + 1}`);
        return { id: `sub_${i}`, label, lang };
      }),
    ];

    return { duration, audio, subtitles };
  } catch {
    return fallback;
  }
}
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
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'backend', 'uploads');
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

// ── Media library (loaded from DB at startup, updated on torrent completion) ──
const mediaLibrary: MediaItem[] = [];

function dbRowToMediaItem(row: any): MediaItem {
  return {
    id: row.id, title: row.title, poster: row.poster, thumbnail: row.thumbnail,
    duration: row.duration, year: row.year, genre: row.genre, description: row.description,
    audio: row.audio as MediaItem['audio'],
    subtitles: row.subtitles as MediaItem['subtitles'],
    qualities: row.qualities as string[],
    status: row.status as MediaItem['status'],
    videoUrl: row.videoUrl,
  };
}

dl.setOnCompleted(async (item) => {
  for (const f of item.files.filter(f => f.isVideo)) {
    const title = f.name.replace(/\.[^.]+$/, '');
    if (mediaLibrary.find(m => m.title === title)) continue;

    let filePath = path.join(dl.DOWNLOADS_DIR, f.path);
    if (!fs.existsSync(filePath)) {
      const flat = path.join(dl.DOWNLOADS_DIR, f.name);
      if (fs.existsSync(flat)) filePath = flat;
    }

    // Add a "converting" placeholder so the card appears immediately in the library
    const tempId = uuidv4();
    const tempItem: MediaItem = {
      id: tempId, title,
      poster: `https://picsum.photos/seed/${item.id}/400/600`,
      thumbnail: `https://picsum.photos/seed/${item.id}/800/450`,
      duration: 0, year: new Date().getFullYear(),
      genre: 'Downloaded', description: 'Converting…',
      audio: [{ id: 0, label: 'Track 1', lang: 'und' }],
      subtitles: [{ id: 'off', label: 'Off', lang: 'off' }],
      qualities: ['Auto'], status: 'processing', videoUrl: '',
    };
    mediaLibrary.push(tempItem);
    io.emit('media:updated', mediaLibrary);

    // Remux to MP4 (stream copy + AAC audio)
    try {
      filePath = await remuxToMp4(filePath);
    } catch (e: any) {
      console.error('[remux] failed, using original file:', e.message);
    }

    // Fix audio codec (AC3/DTS/TrueHD → AAC) for files already in MP4 container
    if (path.extname(filePath).toLowerCase() === '.mp4') {
      try {
        if (await needsAudioFix(filePath)) await fixAudioInPlace(filePath);
      } catch (e: any) {
        console.error('[audio-fix] new download:', e.message);
      }
    }

    const { duration, audio, subtitles } = await probeVideoFile(filePath);
    const relPath = path.relative(dl.DOWNLOADS_DIR, filePath);
    const videoUrl = '/media/' + relPath.split('/').map(encodeURIComponent).join('/');

    // Update placeholder in-place so the same array slot becomes ready
    tempItem.duration = Math.round(duration);  // Int — DB requires whole seconds
    tempItem.videoUrl = videoUrl;
    tempItem.audio = audio;
    tempItem.subtitles = subtitles;
    tempItem.status = 'ready';
    item.mediaIds.push(tempId);

    await db.mediaItem.create({
      data: {
        id: tempId, title, poster: tempItem.poster,
        thumbnail: tempItem.thumbnail, duration: tempItem.duration, year: tempItem.year,
        genre: tempItem.genre, description: tempItem.description,
        audio: audio as any, subtitles: subtitles as any,
        qualities: tempItem.qualities as any, status: 'ready',
        videoUrl,
      },
    }).catch((e: Error) => console.error('[media] DB save failed:', e.message));
  }
  io.emit('media:updated', mediaLibrary);
});

app.use('/media', express.static(dl.DOWNLOADS_DIR, {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mkv': 'video/x-matroska',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
    };
    if (mimeMap[ext]) res.setHeader('Content-Type', mimeMap[ext]);
    // Allow seeking via range requests
    res.setHeader('Accept-Ranges', 'bytes');
  },
}));

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const userId = auth.verifyToken(h.slice(7));
  if (!userId) { res.status(401).json({ error: 'Invalid or expired token' }); return; }
  (req as any).userId = userId;
  next();
}

// ── Auth routes (async) ───────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'All fields required' }); return; }
  const r = await auth.register(username, email, password);
  if ('error' in r) { res.status(400).json(r); return; }
  res.json(r);
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ error: 'Username and password required' }); return; }
  const r = await auth.login(username, password);
  if ('error' in r) { res.status(401).json(r); return; }
  res.json(r);
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await auth.getById((req as any).userId);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user });
});

app.patch('/api/auth/settings', requireAuth, async (req, res) => {
  const r = await auth.updateSettings((req as any).userId, req.body);
  if ('error' in r) { res.status(400).json(r); return; }
  res.json(r);
});

app.delete('/api/auth/account', requireAuth, async (req, res) => {
  await auth.deleteAccount((req as any).userId);
  res.json({ success: true });
});

// ── Media routes ──────────────────────────────────────────────────────────────
app.get('/api/media', requireAuth, (_req, res) => { res.json(mediaLibrary); });

app.get('/api/media/:id', requireAuth, (req, res) => {
  const item = mediaLibrary.find(m => m.id === req.params.id);
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

app.delete('/api/media/:id', requireAuth, async (req, res) => {
  const idx = mediaLibrary.findIndex(m => m.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return; }
  const item = mediaLibrary[idx];

  // Delete the actual video file from disk to free space
  if (item.videoUrl.startsWith('/media/')) {
    const rel = item.videoUrl.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
    const filePath = path.join(dl.DOWNLOADS_DIR, rel);
    if (fs.existsSync(filePath)) {
      try { await fs.promises.unlink(filePath); console.log(`[delete-media] removed ${path.basename(filePath)}`); }
      catch (e: any) { console.warn('[delete-media] could not delete file:', e.message); }
    }
  }

  mediaLibrary.splice(idx, 1);
  await db.mediaItem.delete({ where: { id: req.params.id } }).catch(() => {});
  io.emit('media:updated', mediaLibrary);
  res.json({ success: true });
});

/**
 * Trigger a full re-download of a media item:
 * deletes the video file, removes the media entry, removes the old download
 * entry, and re-queues the torrent so WebTorrent fetches fresh files.
 * The new remux will preserve all audio tracks and transcode to AAC.
 */
app.post('/api/media/:id/redownload', requireAuth, async (req, res) => {
  const mediaId = req.params.id;
  const idx = mediaLibrary.findIndex(m => m.id === mediaId);
  if (idx === -1) { res.status(404).json({ error: 'Media not found' }); return; }
  const item = mediaLibrary[idx];

  // Find the associated download
  const download = dl.list().find(d => d.mediaIds.includes(mediaId));
  if (!download) { res.status(404).json({ error: 'No download associated with this media item' }); return; }
  if (!fs.existsSync(download.torrentPath)) {
    res.status(409).json({ error: 'Original .torrent file is missing — re-upload the torrent manually' });
    return;
  }

  // Delete the video file on disk
  if (item.videoUrl.startsWith('/media/')) {
    const rel = item.videoUrl.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
    const filePath = path.join(dl.DOWNLOADS_DIR, rel);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e: any) {
        console.warn('[redownload] could not delete file:', e.message);
      }
    }
  }

  // Remove media item from library + DB
  mediaLibrary.splice(idx, 1);
  await db.mediaItem.delete({ where: { id: mediaId } }).catch(() => {});

  // Remove old download entry, re-queue the same torrent
  const { torrentPath, name } = download;
  await dl.remove(download.id);
  const newDownload = await dl.add(torrentPath, name);

  io.emit('media:updated', mediaLibrary);
  res.json({ success: true, downloadId: newDownload.id });
});

// ── Download routes ───────────────────────────────────────────────────────────
app.get('/api/downloads', requireAuth, (_req, res) => { res.json(dl.list()); });

// Step 1: parse torrent file list without starting download
app.post('/api/downloads/preview', requireAuth, upload.single('torrent'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No .torrent file uploaded' }); return; }
  try {
    const result = await dl.preview(req.file.path, req.file.originalname);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? 'Failed to parse torrent' });
  }
});

// Step 2: start downloading selected files from a previewed torrent
app.post('/api/downloads/confirm', requireAuth, async (req, res) => {
  const { previewId, selectedIndices } = req.body;
  if (!previewId || !Array.isArray(selectedIndices)) {
    res.status(400).json({ error: 'previewId and selectedIndices required' });
    return;
  }
  try {
    const item = await dl.confirmDownload(previewId, selectedIndices.map(Number));
    res.json(item);
  } catch (e: any) {
    res.status(400).json({ error: e.message ?? 'Failed to start download' });
  }
});

// Legacy: start download immediately (kept for backward compat)
app.post('/api/downloads', requireAuth, upload.single('torrent'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'No .torrent file uploaded' }); return; }
  const item = await dl.add(req.file.path, req.file.originalname);
  res.json(item);
});

app.delete('/api/downloads/:id', requireAuth, async (req, res) => {
  res.json({ success: await dl.remove(req.params.id) });
});

app.patch('/api/downloads/reorder', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) { res.status(400).json({ error: 'ids array required' }); return; }
  dl.reorder(ids as string[]);
  res.json({ success: true });
});

// ── Storage stats ─────────────────────────────────────────────────────────────
async function getDirSize(dirPath: string): Promise<{ bytes: number; count: number }> {
  let bytes = 0, count = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const e of entries) {
      try {
        const full = path.join(dirPath, e.name);
        if (e.isFile()) { bytes += (await fs.promises.stat(full)).size; count++; }
        else if (e.isDirectory()) { const sub = await getDirSize(full); bytes += sub.bytes; count += sub.count; }
      } catch {}
    }
  } catch {}
  return { bytes, count };
}

app.get('/api/storage/stats', requireAuth, async (_req, res) => {
  const [media, uploads] = await Promise.all([
    getDirSize(dl.DOWNLOADS_DIR),
    getDirSize(dl.UPLOADS_DIR),
  ]);
  res.json({
    mediaBytes: media.bytes,
    mediaCount: media.count,
    uploadsBytes: uploads.bytes,
    totalBytes: media.bytes + uploads.bytes,
  });
});

// ── Admin middleware ───────────────────────────────────────────────────────────
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).userId as string;
  const user = await auth.getById(userId);
  if (!user || !user.isAdmin) { res.status(403).json({ error: 'Forbidden' }); return; }
  next();
}

// ── Admin: file system browser ────────────────────────────────────────────────

interface FileEntry {
  path: string;        // relative to DOWNLOADS_DIR
  name: string;
  size: number;
  isKnown: boolean;    // referenced by a media library entry
  mediaId?: string;
  mediaTitle?: string;
}

async function listFilesRecursive(dir: string, base: string): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel  = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      results.push(...await listFilesRecursive(full, rel));
    } else if (e.isFile()) {
      let size = 0;
      try { size = (await fs.promises.stat(full)).size; } catch {}
      results.push({ path: rel, name: e.name, size, isKnown: false });
    }
  }
  return results;
}

app.get('/api/admin/files', requireAuth, requireAdmin, async (_req, res) => {
  const files = await listFilesRecursive(dl.DOWNLOADS_DIR, '');

  // Mark files that are referenced by the media library
  for (const f of files) {
    const encoded = '/media/' + f.path.split('/').map(encodeURIComponent).join('/');
    const media = mediaLibrary.find(m => m.videoUrl === encoded);
    if (media) {
      f.isKnown = true;
      f.mediaId = media.id;
      f.mediaTitle = media.title;
    }
  }

  // Sort: orphaned first, then by size descending
  files.sort((a, b) => {
    if (a.isKnown !== b.isKnown) return a.isKnown ? 1 : -1;
    return b.size - a.size;
  });

  res.json({ files, downloadsDir: dl.DOWNLOADS_DIR });
});

app.delete('/api/admin/files', requireAuth, requireAdmin, async (req, res) => {
  const { filePath } = req.body as { filePath?: string };
  if (!filePath) { res.status(400).json({ error: 'filePath required' }); return; }

  // Prevent path traversal
  const abs = path.resolve(dl.DOWNLOADS_DIR, filePath);
  if (!abs.startsWith(path.resolve(dl.DOWNLOADS_DIR))) {
    res.status(400).json({ error: 'Invalid path' }); return;
  }

  if (!fs.existsSync(abs)) { res.status(404).json({ error: 'File not found' }); return; }

  // Remove from media library if referenced
  const encoded = '/media/' + filePath.split('/').map(encodeURIComponent).join('/');
  const mediaIdx = mediaLibrary.findIndex(m => m.videoUrl === encoded);
  if (mediaIdx !== -1) {
    const mediaId = mediaLibrary[mediaIdx].id;
    mediaLibrary.splice(mediaIdx, 1);
    await db.mediaItem.delete({ where: { id: mediaId } }).catch(() => {});
    io.emit('media:updated', mediaLibrary);
  }

  try {
    await fs.promises.unlink(abs);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: user management ────────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  const users = await db.user.findMany({
    select: { id: true, username: true, nickname: true, specialRole: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ users });
});

app.post('/api/admin/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const { role } = req.body as { role: string | null };
  const allowed = new Set([null, 'miloe-solnyshko']);
  if (!allowed.has(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
  try {
    await db.user.update({ where: { id: req.params.id }, data: { specialRole: role ?? null } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'User not found' });
  }
});

// ── User profile ──────────────────────────────────────────────────────────────
app.get('/api/users/:id/profile', requireAuth, async (req, res) => {
  const requesterId = (req as any).userId as string;
  const profile = await auth.getProfile(req.params.id, requesterId);
  if (!profile) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(profile);
});

app.post('/api/users/:id/friend', requireAuth, async (req, res) => {
  const ok = await auth.addFriend((req as any).userId, req.params.id);
  res.json({ success: ok });
});

app.delete('/api/users/:id/friend', requireAuth, async (req, res) => {
  const ok = await auth.removeFriend((req as any).userId, req.params.id);
  res.json({ success: ok });
});

// ── Room invite preview (public — shareable link) ─────────────────────────────
app.get('/api/rooms/invite/:code', (req, res) => {
  const room = rm.getRoomByInviteCode(req.params.code);
  if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
  res.json({
    id: room.id, name: room.name, mediaTitle: room.mediaTitle,
    mediaPoster: room.mediaPoster, participantCount: room.participants.length,
    maxParticipants: room.maxParticipants, isLocked: room.isLocked, leaderId: room.leaderId,
    hasPassword: !!room.password, friendsOnly: room.friendsOnly,
  });
});

// ── Active rooms browser (authenticated, non-friends-only rooms) ──────────────
app.get('/api/rooms/public', requireAuth, (_req, res) => {
  const rooms = rm.getAllPublicRooms().map(r => ({
    id: r.id,
    name: r.name,
    mediaTitle: r.mediaTitle,
    mediaPoster: r.mediaPoster,
    participantCount: r.participants.length,
    maxParticipants: r.maxParticipants,
    isPlaying: r.isPlaying,
    isLocked: r.isLocked,
    hasPassword: !!r.password,
    leaderId: r.leaderId,
    inviteCode: r.inviteCode,
    createdAt: r.createdAt,
  }));
  res.json({ rooms });
});

// ── User search ───────────────────────────────────────────────────────────────
app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (q.length < 2) { res.json({ users: [] }); return; }
  const users = await db.user.findMany({
    where: {
      OR: [
        { nickname: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, nickname: true, avatarSeed: true, avatarStyle: true },
    take: 20,
  });
  res.json({ users });
});

// ── Socket.io download broadcast ─────────────────────────────────────────────
dl.setBroadcast((items) => io.emit('downloads:update', items));

// ── Socket.io rooms ───────────────────────────────────────────────────────────
// Leader reconnect grace: key = `${userId}:${roomId}`, value = timer
const leaderGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

io.on('connection', socket => {
  // Authenticated users: use the JWT user ID so profile API works by socket userId
  const token = (socket.handshake.query.token as string) || '';
  let userId = (socket.handshake.query.userId as string) || '';
  if (token) {
    const jwtId = auth.verifyToken(token);
    if (jwtId) userId = jwtId;
  }
  if (!userId) userId = uuidv4();

  const nickname = (socket.handshake.query.nickname as string) || `Guest_${userId.slice(0, 4)}`;
  socket.data.userId = userId;
  socket.data.nickname = nickname;
  socket.data.roomId = null as string | null;

  console.log(`[+] ${nickname} (${socket.id})`);

  socket.on('room:create', async (data: { name: string; mediaId: string; maxParticipants?: number; password?: string; friendsOnly?: boolean }, cb) => {
    const media = mediaLibrary.find(m => m.id === data.mediaId);
    if (!media) { cb({ error: 'Media not found' }); return; }
    if (media.status !== 'ready') { cb({ error: 'Media is not ready' }); return; }
    // Look up user info for authenticated users
    let specialRole: string | null = null;
    let avatarStyle = 'thumbs';
    let avatarSeed = socket.data.userId;
    let seatColor = 'default';
    try {
      const dbUser = await db.user.findUnique({ where: { id: socket.data.userId }, select: { specialRole: true, avatarStyle: true, avatarSeed: true, seatColor: true } });
      specialRole = dbUser?.specialRole ?? null;
      avatarStyle = dbUser?.avatarStyle ?? 'thumbs';
      avatarSeed = dbUser?.avatarSeed ?? socket.data.userId;
      seatColor = dbUser?.seatColor ?? 'default';
    } catch {}
    const room = rm.createRoom(data.name.trim() || 'Movie Night', media.id, media.title, media.poster, media.duration, data.maxParticipants || 24, socket.data.userId, socket.id, socket.data.nickname, specialRole, avatarStyle, avatarSeed, seatColor, data.password || null, data.friendsOnly ?? false);
    socket.data.roomId = room.id;
    socket.join(room.id);
    cb({ room, media, userId: socket.data.userId });
  });

  socket.on('room:join', async (data: { roomId: string; password?: string }, cb) => {
    // Cancel any pending leader-disconnect grace timer for this user
    const graceKey = `${socket.data.userId}:${data.roomId}`;
    if (leaderGraceTimers.has(graceKey)) {
      clearTimeout(leaderGraceTimers.get(graceKey)!);
      leaderGraceTimers.delete(graceKey);
      console.log(`[leader-grace] ${socket.data.nickname} reconnected — grace cancelled`);
    }

    // Check password and friends-only before joining (skip for reconnects)
    const roomCheck = rm.getRoomById(data.roomId);
    if (roomCheck) {
      const isReconnect = !!roomCheck.participants.find(p => p.id === socket.data.userId);
      if (!isReconnect) {
        if (roomCheck.password && data.password !== roomCheck.password) {
          cb({ error: 'Wrong password' }); return;
        }
        if (roomCheck.friendsOnly) {
          const isFriend = await auth.areFriends(socket.data.userId, roomCheck.leaderId);
          if (!isFriend) { cb({ error: 'This hall is for friends only' }); return; }
        }
      }
    }

    // Look up user info for authenticated users
    let specialRole: string | null = null;
    let avatarStyle = 'thumbs';
    let avatarSeed = socket.data.userId;
    let seatColor = 'default';
    try {
      const dbUser = await db.user.findUnique({ where: { id: socket.data.userId }, select: { specialRole: true, avatarStyle: true, avatarSeed: true, seatColor: true } });
      specialRole = dbUser?.specialRole ?? null;
      avatarStyle = dbUser?.avatarStyle ?? 'thumbs';
      avatarSeed = dbUser?.avatarSeed ?? socket.data.userId;
      seatColor = dbUser?.seatColor ?? 'default';
    } catch {}
    const result = rm.joinRoom(data.roomId, socket.data.userId, socket.id, socket.data.nickname, specialRole, avatarStyle, avatarSeed, seatColor);
    if ('error' in result) { cb({ error: result.error }); return; }
    const media = mediaLibrary.find(m => m.id === result.room.mediaId);
    socket.data.roomId = result.room.id;
    socket.join(result.room.id);
    socket.to(result.room.id).emit('room:participant_join', { participant: result.user, participants: result.room.participants });
    cb({ room: result.room, user: result.user, media, userId: socket.data.userId });
    // Track watch history (fire-and-forget; only for DB-backed users, not guests)
    const isGuest = !socket.handshake.query.userId;
    if (!isGuest && !('error' in result)) {
      auth.recordWatch(socket.data.userId, result.room.mediaTitle, result.room.name).catch(() => {});
    }
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

  socket.on('room:transfer_leader', (d: { targetUserId: string }) => {
    const rid = socket.data.roomId;
    if (!rid || !isLeader()) return;
    const updated = rm.transferLeader(rid, socket.data.userId, d.targetUserId);
    if (!updated) return;
    io.to(rid).emit('room:participant_leave', { userId: '', participants: updated.participants, newLeaderId: updated.leaderId });
  });

  // ── Film queue ───────────────────────────────────────────────────────────────
  socket.on('room:queue_media', (d: { mediaId: string | null }, cb?: (r: unknown) => void) => {
    const rid = socket.data.roomId;
    if (!rid || !isLeader()) { cb?.({ error: 'Not leader' }); return; }
    let mediaId: string | null = null;
    let mediaTitle: string | null = null;
    let mediaPoster: string | null = null;
    if (d.mediaId) {
      const m = mediaLibrary.find(item => item.id === d.mediaId);
      if (!m || m.status !== 'ready') { cb?.({ error: 'Media not ready' }); return; }
      mediaId = m.id; mediaTitle = m.title; mediaPoster = m.poster;
    }
    const updated = rm.queueMedia(rid, mediaId, mediaTitle, mediaPoster);
    if (!updated) { cb?.({ error: 'Room not found' }); return; }
    io.to(rid).emit('room:settings_update', {
      queuedMediaId: updated.queuedMediaId,
      queuedMediaTitle: updated.queuedMediaTitle,
      queuedMediaPoster: updated.queuedMediaPoster,
    });
    cb?.({ success: true });
  });

  socket.on('room:play_next', (cb?: (r: unknown) => void) => {
    const rid = socket.data.roomId;
    if (!rid || !isLeader()) { cb?.({ error: 'Not leader' }); return; }
    const room = rm.getRoomById(rid);
    if (!room?.queuedMediaId) { cb?.({ error: 'No media queued' }); return; }
    const media = mediaLibrary.find(m => m.id === room.queuedMediaId);
    if (!media || media.status !== 'ready') { cb?.({ error: 'Queued media not ready' }); return; }
    const updated = rm.switchToQueuedMedia(rid, media.id, media.title, media.poster, media.duration);
    if (!updated) return;
    io.to(rid).emit('room:media_changed', { room: updated, media });
    cb?.({ success: true });
  });

  socket.on('disconnect', () => {
    console.log(`[-] ${socket.data.nickname} (${socket.id})`);
    const roomId = socket.data.roomId;
    const userId = socket.data.userId;
    if (!roomId) return;

    const room = rm.getRoomById(roomId);
    if (room && room.leaderId === userId) {
      // Leader disconnected — give 30s grace period before removing them.
      // If they reconnect (F5), the grace timer is cancelled in room:join.
      const graceKey = `${userId}:${roomId}`;
      if (!leaderGraceTimers.has(graceKey)) {
        console.log(`[leader-grace] ${socket.data.nickname} disconnected — 30s grace started`);
        const timer = setTimeout(() => {
          leaderGraceTimers.delete(graceKey);
          doLeave(roomId, userId, socket);
          console.log(`[leader-grace] ${socket.data.nickname} — grace expired, removed from room`);
        }, 30_000);
        leaderGraceTimers.set(graceKey, timer);
      }
    } else {
      doLeave(roomId, userId, socket);
    }
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

/**
 * On startup: fix any media items whose videoUrl points to a missing or
 * non-browser-playable file.  Handles two cases:
 *  1. Path is doubled (WebTorrent single-file quirk): try basename instead.
 *  2. File is MKV/AVI/etc: remux to MP4 and update the stored URL.
 */
async function repairMediaLibrary() {
  for (const item of mediaLibrary) {
    if (!item.videoUrl.startsWith('/media/')) continue;

    const relPath = item.videoUrl.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
    let filePath = path.join(dl.DOWNLOADS_DIR, relPath);
    let changed = false;

    if (!fs.existsSync(filePath)) {
      const flat = path.join(dl.DOWNLOADS_DIR, path.basename(relPath));
      if (fs.existsSync(flat)) {
        filePath = flat;
        changed = true;
      } else {
        console.warn(`[repair] file missing for "${item.title}": ${filePath}`);
        continue;
      }
    }

    try {
      const mp4 = await remuxToMp4(filePath);
      if (mp4 !== filePath) { filePath = mp4; changed = true; }
    } catch (e: any) {
      console.error(`[repair] remux failed for "${item.title}":`, e.message);
    }

    // Fix incompatible audio (AC3/DTS/TrueHD → AAC) in already-existing MP4 files
    if (path.extname(filePath).toLowerCase() === '.mp4') {
      try {
        if (await needsAudioFix(filePath)) {
          await fixAudioInPlace(filePath);
          changed = true;
        }
      } catch (e: any) {
        console.error(`[repair] audio fix failed for "${item.title}":`, e.message);
      }
    }

    if (!changed) continue;

    const newRel = path.relative(dl.DOWNLOADS_DIR, filePath);
    const newUrl = '/media/' + newRel.split('/').map(encodeURIComponent).join('/');
    const { duration, audio, subtitles } = await probeVideoFile(filePath);

    item.videoUrl = newUrl;
    item.duration = Math.round(duration);
    item.audio = audio;
    item.subtitles = subtitles;

    await db.mediaItem.update({
      where: { id: item.id },
      data: { videoUrl: newUrl, duration: Math.round(duration), audio: audio as any, subtitles: subtitles as any },
    }).catch((e: Error) => console.error('[repair] DB update failed:', e.message));

    console.log(`[repair] fixed "${item.title}" → ${newUrl}`);
  }
}

// ── Startup (async to wait for DB) ────────────────────────────────────────────
async function main() {
  // Load downloads from DB (resumes queued, marks interrupted as error)
  await dl.init();

  // Load media library from DB
  const dbMedia = await db.mediaItem.findMany({ orderBy: { createdAt: 'desc' } });
  mediaLibrary.push(...dbMedia.map(dbRowToMediaItem));
  console.log(`[db] ${dbMedia.length} media items, ${dl.list().length} downloads loaded`);

  const PORT = process.env.PORT || 3001;
  httpServer.listen(PORT, () => {
    console.log(`🎬 Noctiviem backend → http://localhost:${PORT}`);
    // Fix broken paths / remux legacy MKV items in background (non-blocking)
    repairMediaLibrary().catch(e => console.error('[repair] fatal:', e.message));
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
