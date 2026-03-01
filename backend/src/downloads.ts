import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import db from './db';

// Storage paths — override via env vars in Docker or .env
export const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR ?? path.join(process.cwd(), 'backend', 'downloads');
export const UPLOADS_DIR   = process.env.UPLOADS_DIR   ?? path.join(process.cwd(), 'backend', 'uploads');

for (const d of [DOWNLOADS_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.ts', '.wmv']);

export interface DownloadFile {
  name: string;
  size: number;
  progress: number;
  isVideo: boolean;
}

export interface DownloadItem {
  id: string;
  name: string;
  torrentPath: string;
  infoHash: string;
  status: 'queued' | 'metadata' | 'downloading' | 'completed' | 'error' | 'paused';
  progress: number;       // 0–1
  downloaded: number;     // bytes
  total: number;          // bytes
  downloadSpeed: number;  // bytes/sec
  uploadSpeed: number;
  numPeers: number;
  eta: number;            // seconds, -1 = unknown
  files: DownloadFile[];
  error?: string;
  createdAt: number;
  completedAt?: number;
  mediaIds: string[];
}

const downloads = new Map<string, DownloadItem>();
let broadcastFn: ((items: DownloadItem[]) => void) | null = null;

// ── webtorrent client (lazy-loaded) ──────────────────────────────────────────

let wtClient: any = null;

function getWTClient(): any {
  if (!wtClient) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WT = require('webtorrent');
      wtClient = new WT({ maxConns: 55 });
      wtClient.on('error', (err: Error) => console.error('[webtorrent]', err.message));
    } catch (e: any) {
      console.error('[webtorrent] Failed to initialize:', e.message);
    }
  }
  return wtClient;
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function saveToDb(item: DownloadItem): Promise<void> {
  await db.download.upsert({
    where: { id: item.id },
    update: {
      name: item.name,
      infoHash: item.infoHash,
      status: item.status,
      progress: item.progress,
      downloaded: item.downloaded,
      total: item.total,
      downloadSpeed: item.downloadSpeed,
      uploadSpeed: item.uploadSpeed,
      numPeers: item.numPeers,
      eta: item.eta,
      files: item.files as any,
      error: item.error ?? null,
      mediaIds: item.mediaIds as any,
      completedAt: item.completedAt ? new Date(item.completedAt) : null,
    },
    create: {
      id: item.id,
      name: item.name,
      torrentPath: item.torrentPath,
      infoHash: item.infoHash,
      status: item.status,
      progress: item.progress,
      downloaded: item.downloaded,
      total: item.total,
      downloadSpeed: item.downloadSpeed,
      uploadSpeed: item.uploadSpeed,
      numPeers: item.numPeers,
      eta: item.eta,
      files: item.files as any,
      error: item.error ?? null,
      mediaIds: item.mediaIds as any,
      createdAt: new Date(item.createdAt),
      completedAt: item.completedAt ? new Date(item.completedAt) : null,
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function setBroadcast(fn: (items: DownloadItem[]) => void) {
  broadcastFn = fn;
}

export function list(): DownloadItem[] {
  return Array.from(downloads.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function get(id: string): DownloadItem | undefined {
  return downloads.get(id);
}

/** Load persisted downloads from DB on server startup */
export async function init(): Promise<void> {
  const rows = await db.download.findMany({ orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    const wasActive = row.status === 'downloading' || row.status === 'metadata';
    const item: DownloadItem = {
      id: row.id,
      name: row.name,
      torrentPath: row.torrentPath,
      infoHash: row.infoHash,
      status: wasActive ? 'error' : (row.status as DownloadItem['status']),
      error: wasActive ? 'Server was restarted' : (row.error ?? undefined),
      progress: row.progress,
      downloaded: row.downloaded,
      total: row.total,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      eta: -1,
      files: (row.files as DownloadFile[]) ?? [],
      createdAt: row.createdAt.getTime(),
      completedAt: row.completedAt?.getTime(),
      mediaIds: (row.mediaIds as string[]) ?? [],
    };
    downloads.set(item.id, item);
    // Restart anything that was queued before restart
    if (row.status === 'queued') startDownload(item.id);
  }
}

export async function add(torrentFilePath: string, displayName: string): Promise<DownloadItem> {
  const id = uuidv4();
  const item: DownloadItem = {
    id,
    name: displayName.replace(/\.torrent$/i, '').trim() || 'Unknown',
    torrentPath: torrentFilePath,
    infoHash: '',
    status: 'queued',
    progress: 0,
    downloaded: 0,
    total: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    numPeers: 0,
    eta: -1,
    files: [],
    createdAt: Date.now(),
    mediaIds: [],
  };
  downloads.set(id, item);
  await saveToDb(item);
  broadcastFn?.(list());
  startDownload(id);
  return item;
}

export async function remove(id: string): Promise<boolean> {
  const item = downloads.get(id);
  if (!item) return false;
  try {
    const client = getWTClient();
    if (client && item.infoHash) {
      const t = client.get(item.infoHash);
      if (t) t.destroy();
    }
  } catch {}
  downloads.delete(id);
  await db.download.delete({ where: { id } }).catch(() => {});
  return true;
}

// ── Download logic ────────────────────────────────────────────────────────────

function startDownload(id: string) {
  const item = downloads.get(id);
  if (!item) return;

  const client = getWTClient();
  if (!client) {
    item.status = 'error';
    item.error = 'WebTorrent failed to initialize. Check server logs.';
    saveToDb(item).catch(() => {});
    broadcastFn?.(list());
    return;
  }

  item.status = 'metadata';
  broadcastFn?.(list());

  try {
    const torrent = client.add(item.torrentPath, { path: DOWNLOADS_DIR });

    torrent.on('infoHash', () => {
      item.infoHash = torrent.infoHash;
    });

    torrent.on('metadata', () => {
      item.status = 'downloading';
      item.name = torrent.name || item.name;
      item.total = torrent.length || 0;
      item.files = torrent.files.map((f: any) => ({
        name: f.name,
        size: f.length,
        progress: 0,
        isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
      }));
      saveToDb(item).catch(() => {});
      broadcastFn?.(list());
    });

    // Progress tick every 1.2s
    const tick = setInterval(() => {
      const d = downloads.get(id);
      if (!d || d.status !== 'downloading') { clearInterval(tick); return; }
      d.progress = torrent.progress ?? 0;
      d.downloaded = torrent.downloaded ?? 0;
      d.total = torrent.length ?? d.total;
      d.downloadSpeed = torrent.downloadSpeed ?? 0;
      d.uploadSpeed = torrent.uploadSpeed ?? 0;
      d.numPeers = torrent.numPeers ?? 0;
      d.eta = torrent.timeRemaining > 0 ? Math.floor(torrent.timeRemaining / 1000) : -1;
      if (torrent.files) {
        d.files = torrent.files.map((f: any) => ({
          name: f.name, size: f.length,
          progress: f.progress ?? 0,
          isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
        }));
      }
      saveToDb(d).catch(() => {});
      broadcastFn?.(list());
    }, 1200);

    torrent.on('done', () => {
      clearInterval(tick);
      const d = downloads.get(id);
      if (!d) return;
      d.status = 'completed';
      d.progress = 1;
      d.downloadSpeed = 0;
      d.uploadSpeed = 0;
      d.eta = 0;
      d.completedAt = Date.now();
      if (torrent.files) {
        d.files = torrent.files.map((f: any) => ({
          name: f.name, size: f.length, progress: 1,
          isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
        }));
      }
      saveToDb(d).catch(() => {});
      broadcastFn?.(list());
      onCompletedFn?.(d);
    });

    torrent.on('error', (err: Error) => {
      clearInterval(tick);
      const d = downloads.get(id);
      if (!d) return;
      d.status = 'error';
      d.error = err.message;
      saveToDb(d).catch(() => {});
      broadcastFn?.(list());
    });

  } catch (err: any) {
    item.status = 'error';
    item.error = err.message ?? 'Unknown error';
    saveToDb(item).catch(() => {});
    broadcastFn?.(list());
  }
}

let onCompletedFn: ((item: DownloadItem) => void) | null = null;
export function setOnCompleted(fn: (item: DownloadItem) => void) {
  onCompletedFn = fn;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
