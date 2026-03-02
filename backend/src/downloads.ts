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
  path: string;   // relative path from DOWNLOADS_DIR (use this for filesystem access)
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
  sortOrder: number;      // lower = higher priority in queue
}

// Max simultaneous WebTorrent downloads (env: MAX_CONCURRENT_DL, default 2)
const MAX_CONCURRENT_DL = Math.max(1, parseInt(process.env.MAX_CONCURRENT_DL ?? '2', 10));

const downloads = new Map<string, DownloadItem>();
let broadcastFn: ((items: DownloadItem[]) => void) | null = null;

// Count currently active (metadata + downloading) downloads
function activeCount(): number {
  let n = 0;
  for (const d of downloads.values()) {
    if (d.status === 'downloading' || d.status === 'metadata') n++;
  }
  return n;
}

// Next sortOrder value: max existing + 1
function nextSortOrder(): number {
  let max = -1;
  for (const d of downloads.values()) if (d.sortOrder > max) max = d.sortOrder;
  return max + 1;
}

// Start the next queued download if a slot is free
function tryStartNext(): void {
  if (activeCount() >= MAX_CONCURRENT_DL) return;
  const next = Array.from(downloads.values())
    .filter(d => d.status === 'queued')
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (next) startDownload(next.id).catch(e => console.error('[dl:next]', e));
}

// ── webtorrent client (lazy async ESM load) ──────────────────────────────────
// webtorrent 2.x is ESM-only. TypeScript compiles `import()` to `require()` in
// CJS output mode, which fails for ESM packages. `new Function` prevents TS
// from transforming the expression, so Node.js uses its native ESM loader.

const _importESM = new Function('id', 'return import(id)') as (id: string) => Promise<any>;

let wtClient: any = null;
let wtInitPromise: Promise<any | null> | null = null;

async function getWTClient(): Promise<any | null> {
  if (wtClient) return wtClient;
  if (wtInitPromise) return wtInitPromise;
  wtInitPromise = (async () => {
    try {
      const mod = await _importESM('webtorrent');
      const WT = mod.default ?? mod;
      wtClient = new WT({ maxConns: 55 });
      wtClient.on('error', (err: Error) => console.error('[webtorrent]', err.message));
      return wtClient;
    } catch (e: any) {
      console.error('[webtorrent] Failed to initialize:', e.message);
      wtInitPromise = null; // allow retry on next call
      return null;
    }
  })();
  return wtInitPromise;
}

// ── DB persistence ────────────────────────────────────────────────────────────

async function saveToDb(item: DownloadItem): Promise<void> {
  // Prisma Float rejects Infinity/NaN — clamp eta to -1 in those cases
  const safeEta = Number.isFinite(item.eta) ? item.eta : -1;
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
      eta: safeEta,
      files: item.files as any,
      error: item.error ?? null,
      mediaIds: item.mediaIds as any,
      sortOrder: item.sortOrder,
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
      eta: safeEta,
      files: item.files as any,
      error: item.error ?? null,
      mediaIds: item.mediaIds as any,
      sortOrder: item.sortOrder,
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
  return Array.from(downloads.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Reassign sortOrder by the provided ID array (index = new order position). */
export function reorder(ids: string[]): void {
  ids.forEach((id, idx) => {
    const d = downloads.get(id);
    if (d) d.sortOrder = idx;
  });
  // Persist updated sortOrders asynchronously
  for (const id of ids) {
    const d = downloads.get(id);
    if (d) saveToDb(d).catch(() => {});
  }
  broadcastFn?.(list());
}

export function get(id: string): DownloadItem | undefined {
  return downloads.get(id);
}

/** Load persisted downloads from DB on server startup */
export async function init(): Promise<void> {
  const rows = await db.download.findMany({ orderBy: { sortOrder: 'asc' } });
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
      files: (row.files as unknown as DownloadFile[]) ?? [],
      createdAt: row.createdAt.getTime(),
      completedAt: row.completedAt?.getTime(),
      mediaIds: (row.mediaIds as string[]) ?? [],
      sortOrder: (row as any).sortOrder ?? row.createdAt.getTime(),
    };
    downloads.set(item.id, item);
  }
  // Restart queued downloads respecting concurrent limit (in priority order)
  const queued = Array.from(downloads.values())
    .filter(d => d.status === 'queued')
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const d of queued) {
    if (activeCount() < MAX_CONCURRENT_DL) {
      startDownload(d.id).catch(e => console.error('[dl:init]', e));
    } else {
      break;
    }
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
    sortOrder: nextSortOrder(),
  };
  downloads.set(id, item);
  await saveToDb(item);
  broadcastFn?.(list());
  // Only start immediately if under the concurrent download limit
  if (activeCount() < MAX_CONCURRENT_DL) {
    startDownload(id).catch(e => console.error('[dl:add]', e));
  }
  return item;
}

export async function remove(id: string, deleteFiles = false): Promise<boolean> {
  const item = downloads.get(id);
  if (!item) return false;

  // Stop the WebTorrent instance
  try {
    const client = await getWTClient();
    if (client && item.infoHash) {
      const t = client.get(item.infoHash);
      if (t) t.destroy();
    }
  } catch {}

  // Delete partial files for active/queued downloads (incomplete = useless bytes).
  // For completed ones only delete if caller explicitly requests it.
  const shouldDeleteFiles = deleteFiles || (item.status !== 'completed' && item.status !== 'error');
  if (shouldDeleteFiles && item.files.length > 0) {
    for (const f of item.files) {
      if (!f.path) continue;
      const filePath = path.join(DOWNLOADS_DIR, f.path);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); }
        catch (e: any) { console.warn('[dl:remove] could not delete file:', e.message); }
      }
    }
  }

  // Clean up the .torrent file from the uploads dir unless another download uses it
  if (item.torrentPath && fs.existsSync(item.torrentPath)) {
    const sharedByOther = Array.from(downloads.values()).some(
      d => d.id !== id && d.torrentPath === item.torrentPath,
    );
    if (!sharedByOther) {
      try { fs.unlinkSync(item.torrentPath); }
      catch {}
    }
  }

  downloads.delete(id);
  await db.download.delete({ where: { id } }).catch(() => {});
  tryStartNext();
  return true;
}

// ── Download logic ────────────────────────────────────────────────────────────

async function startDownload(id: string) {
  const item = downloads.get(id);
  if (!item) return;

  const client = await getWTClient();
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
        path: f.path,
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
          name: f.name, path: f.path, size: f.length,
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
          name: f.name, path: f.path, size: f.length, progress: 1,
          isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
        }));
      }
      saveToDb(d).catch(() => {});
      broadcastFn?.(list());
      onCompletedFn?.(d);
      tryStartNext();
    });

    torrent.on('error', (err: Error) => {
      clearInterval(tick);
      const d = downloads.get(id);
      if (!d) return;
      d.status = 'error';
      d.error = err.message;
      saveToDb(d).catch(() => {});
      broadcastFn?.(list());
      tryStartNext();
    });

  } catch (err: any) {
    item.status = 'error';
    item.error = err.message ?? 'Unknown error';
    saveToDb(item).catch(() => {});
    broadcastFn?.(list());
    tryStartNext();
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

// ── Torrent preview (parse files without downloading) ─────────────────────────

const AUDIO_EXTS = new Set(['.mp3', '.aac', '.ac3', '.dts', '.flac', '.ogg', '.wav', '.m4a', '.eac3', '.truehd', '.mka', '.opus']);
const SUB_EXTS   = new Set(['.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup', '.pgs']);

export interface TorrentFilePreview {
  index: number;
  name: string;
  path: string;
  size: number;
  isVideo: boolean;
  isAudio: boolean;
  isSub: boolean;
}

// Pending preview sessions: previewId -> { torrent, item, files }
const pendingPreviews = new Map<string, { torrent: any; item: DownloadItem; files: TorrentFilePreview[] }>();

/** Add a torrent, parse its file list, pause all files — return preview without starting download */
export async function preview(
  torrentFilePath: string,
  displayName: string,
): Promise<{ previewId: string; files: TorrentFilePreview[] }> {
  const client = await getWTClient();
  if (!client) throw new Error('WebTorrent not available');

  const previewId = uuidv4();
  const id = uuidv4();

  const item: DownloadItem = {
    id,
    name: displayName.replace(/\.torrent$/i, '').trim() || 'Unknown',
    torrentPath: torrentFilePath,
    infoHash: '',
    status: 'metadata',
    progress: 0, downloaded: 0, total: 0,
    downloadSpeed: 0, uploadSpeed: 0, numPeers: 0, eta: -1,
    files: [], createdAt: Date.now(), mediaIds: [],
    sortOrder: 0,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const p = pendingPreviews.get(previewId);
      if (p) { try { p.torrent.destroy() } catch {} pendingPreviews.delete(previewId); }
      reject(new Error('Timeout reading torrent metadata'));
    }, 20000);

    let handled = false;
    let torrent: any;

    const handleMetadata = () => {
      if (handled) return;
      handled = true;
      clearTimeout(timer);

      // Deselect all files — prevent any downloading
      if (torrent.files) {
        torrent.files.forEach((f: any) => { try { f.deselect() } catch {} });
      }

      const files: TorrentFilePreview[] = (torrent.files ?? []).map((f: any, idx: number) => {
        const ext = path.extname(f.name).toLowerCase();
        return {
          index: idx,
          name: f.name,
          path: f.path,
          size: f.length ?? 0,
          isVideo: VIDEO_EXTS.has(ext),
          isAudio: AUDIO_EXTS.has(ext),
          isSub: SUB_EXTS.has(ext),
        };
      });

      item.name    = torrent.name || item.name;
      item.total   = torrent.length || 0;
      item.infoHash = torrent.infoHash || '';
      item.files   = files.map(f => ({ name: f.name, path: f.path, size: f.size, progress: 0, isVideo: f.isVideo }));

      pendingPreviews.set(previewId, { torrent, item, files });

      // Auto-expire after 30 min
      setTimeout(() => {
        const p = pendingPreviews.get(previewId);
        if (p) { try { p.torrent.destroy() } catch {} pendingPreviews.delete(previewId); }
      }, 30 * 60 * 1000);

      resolve({ previewId, files });
    };

    try {
      torrent = client.add(torrentFilePath, { path: DOWNLOADS_DIR });
    } catch (e: any) {
      clearTimeout(timer);
      reject(e);
      return;
    }

    torrent.on('infoHash', () => { item.infoHash = torrent.infoHash; });
    torrent.on('metadata', handleMetadata);
    torrent.on('ready',    handleMetadata);
    torrent.on('error', (err: Error) => {
      if (!handled) { handled = true; clearTimeout(timer); reject(err); }
    });
  });
}

/** Start downloading selected files from a previously previewed torrent */
export async function confirmDownload(
  previewId: string,
  selectedIndices: number[],
): Promise<DownloadItem> {
  const pending = pendingPreviews.get(previewId);
  if (!pending) throw new Error('Preview session not found or expired');
  if (selectedIndices.length === 0) throw new Error('Select at least one file');
  pendingPreviews.delete(previewId);

  const { torrent, item } = pending;

  // Re-select chosen files
  if (torrent.files) {
    torrent.files.forEach((f: any, idx: number) => {
      try {
        if (selectedIndices.includes(idx)) f.select();
        // rest stay deselected
      } catch {}
    });
  }

  item.status = 'downloading';
  item.sortOrder = nextSortOrder();
  downloads.set(item.id, item);
  await saveToDb(item);
  broadcastFn?.(list());

  // Progress tick
  const tick = setInterval(() => {
    const d = downloads.get(item.id);
    if (!d || d.status !== 'downloading') { clearInterval(tick); return; }
    d.progress      = torrent.progress ?? 0;
    d.downloaded    = torrent.downloaded ?? 0;
    d.total         = torrent.length ?? d.total;
    d.downloadSpeed = torrent.downloadSpeed ?? 0;
    d.uploadSpeed   = torrent.uploadSpeed ?? 0;
    d.numPeers      = torrent.numPeers ?? 0;
    d.eta           = torrent.timeRemaining > 0 ? Math.floor(torrent.timeRemaining / 1000) : -1;
    if (torrent.files) {
      d.files = torrent.files.map((f: any, idx: number) => ({
        name: f.name, path: f.path, size: f.length,
        progress: selectedIndices.includes(idx) ? (f.progress ?? 0) : -1,
        isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
      }));
    }
    saveToDb(d).catch(() => {});
    broadcastFn?.(list());
  }, 1200);

  torrent.on('done', () => {
    clearInterval(tick);
    const d = downloads.get(item.id);
    if (!d) return;
    d.status = 'completed'; d.progress = 1;
    d.downloadSpeed = 0; d.uploadSpeed = 0; d.eta = 0;
    d.completedAt = Date.now();
    if (torrent.files) {
      d.files = torrent.files.map((f: any, idx: number) => ({
        name: f.name, path: f.path, size: f.length,
        progress: selectedIndices.includes(idx) ? 1 : -1,
        isVideo: VIDEO_EXTS.has(path.extname(f.name).toLowerCase()),
      }));
    }
    saveToDb(d).catch(() => {});
    broadcastFn?.(list());
    onCompletedFn?.(d);
    tryStartNext();
  });

  torrent.on('error', (err: Error) => {
    clearInterval(tick);
    const d = downloads.get(item.id);
    if (!d) return;
    d.status = 'error'; d.error = err.message;
    saveToDb(d).catch(() => {});
    broadcastFn?.(list());
    tryStartNext();
  });

  return item;
}
