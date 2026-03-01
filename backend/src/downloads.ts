import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

export const DOWNLOADS_DIR = path.join(__dirname, '../../downloads');
export const MEDIA_DIR = path.join(__dirname, '../../media');

for (const d of [DOWNLOADS_DIR, MEDIA_DIR]) {
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
  progress: number;          // 0–1
  downloaded: number;        // bytes
  total: number;             // bytes
  downloadSpeed: number;     // bytes/sec
  uploadSpeed: number;
  numPeers: number;
  eta: number;               // seconds, -1 = unknown
  files: DownloadFile[];
  error?: string;
  createdAt: number;
  completedAt?: number;
  mediaIds: string[];        // IDs added to library on completion
}

const downloads = new Map<string, DownloadItem>();
let broadcastFn: ((items: DownloadItem[]) => void) | null = null;

// webtorrent client (lazy-loaded once)
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

export function setBroadcast(fn: (items: DownloadItem[]) => void) {
  broadcastFn = fn;
}

function emit() {
  broadcastFn?.(list());
}

export function list(): DownloadItem[] {
  return Array.from(downloads.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function get(id: string): DownloadItem | undefined {
  return downloads.get(id);
}

export function add(torrentFilePath: string, displayName: string): DownloadItem {
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
  emit();
  startDownload(id);
  return item;
}

export function remove(id: string): boolean {
  const item = downloads.get(id);
  if (!item) return false;
  // Try to remove from webtorrent if active
  try {
    const client = getWTClient();
    if (client && item.infoHash) {
      const t = client.get(item.infoHash);
      if (t) t.destroy();
    }
  } catch {}
  return downloads.delete(id);
}

// ── Actual download logic ─────────────────────────────────────────────────────

function startDownload(id: string) {
  const item = downloads.get(id);
  if (!item) return;

  const client = getWTClient();
  if (!client) {
    item.status = 'error';
    item.error = 'WebTorrent failed to initialize. Check server logs.';
    emit();
    return;
  }

  item.status = 'metadata';
  emit();

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
      emit();
    });

    // Progress tick
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
          name: f.name,
          size: f.length,
          progress: f.progress ?? 0,
          isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
        }));
      }
      emit();
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
          name: f.name,
          size: f.length,
          progress: 1,
          isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
        }));
      }
      emit();
      // Notify media library to re-scan
      onCompletedFn?.(d);
    });

    torrent.on('error', (err: Error) => {
      clearInterval(tick);
      const d = downloads.get(id);
      if (!d) return;
      d.status = 'error';
      d.error = err.message;
      emit();
    });

  } catch (err: any) {
    item.status = 'error';
    item.error = err.message ?? 'Unknown error';
    emit();
  }
}

// Callback for when a download completes → called by index.ts to add to library
let onCompletedFn: ((item: DownloadItem) => void) | null = null;
export function setOnCompleted(fn: (item: DownloadItem) => void) {
  onCompletedFn = fn;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
