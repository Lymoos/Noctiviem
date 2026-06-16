import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import db from './db';

const execFileAsync = promisify(execFile);

/**
 * Run ffmpeg via spawn with reliable progress tracking.
 * - Always passes -y so it never blocks waiting for "overwrite?" input
 * - Uses -progress pipe:1 -nostats → structured out_time_ms=N on stdout
 * - stderr is inherited (goes straight to server console for debugging)
 * - onProgress(secs) is called with the current encoded position in seconds
 */
function ffmpegSpawn(
  args: string[],
  { timeout = 3 * 60 * 60 * 1000, onProgress }: { timeout?: number; onProgress?: (secs: number) => void } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',                   // never prompt for overwrite — prevents hangs on stale tmp files
      '-progress', 'pipe:1',  // write progress key=value pairs to stdout
      '-nostats',             // suppress noisy stderr progress lines (errors still show)
      ...args,
    ], {
      stdio: ['ignore', 'pipe', 'inherit'], // stderr → server console so we see errors
    });

    let stdoutBuf = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${Math.round(timeout / 60000)} min`));
    }, timeout);

    // Must always drain stdout — if we don't read it, the pipe fills and ffmpeg blocks
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      if (!onProgress) return;
      // -progress outputs lines like:  out_time_ms=12345678
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m) onProgress(parseInt(m[1]) / 1_000_000);
      }
    });

    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code} (signal: ${signal})`));
    });

    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// Audio codecs natively supported by all major browsers inside MP4/WebM
const BROWSER_SAFE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);

// ─── HLS on-demand ────────────────────────────────────────────────────────────
// Instead of copying the entire file to a new MP4 (can take 1.5h for 25GB),
// we generate 10-second MPEG-TS segments on-demand using ffmpeg stream copy.
// Files become available immediately after download — no waiting for conversion.
const HLS_SEG_SECS = 10;
// How many segments ahead to pre-warm per request. Bounded + non-cascading.
const HLS_PREWARM = 2;
// Hard cap on simultaneously running segment ffmpeg processes. Prevents a
// Leader scrubbing the timeline (or many clients) from spawning an unbounded
// number of encoders and pinning the box.
const HLS_MAX_CONCURRENT = 4;

// Promise cache: key = `${mediaId}:${segIdx}:a${audioIdx}` → Buffer promise.
// Concurrent requests for the same segment (watch-party clients in sync) share
// one ffmpeg invocation. Entries expire 2 minutes after generation.
const hlsSegCache = new Map<string, Promise<Buffer>>();

// Simple concurrency gate for segment encoders.
let hlsRunning = 0;
const hlsWaitQueue: (() => void)[] = [];
function acquireHlsSlot(): Promise<void> {
  if (hlsRunning < HLS_MAX_CONCURRENT) { hlsRunning++; return Promise.resolve(); }
  return new Promise<void>(res => hlsWaitQueue.push(res)).then(() => { hlsRunning++; });
}
function releaseHlsSlot(): void {
  hlsRunning = Math.max(0, hlsRunning - 1);
  hlsWaitQueue.shift()?.();
}

/**
 * Generate (or return the cached promise for) a single MPEG-TS segment.
 * `audioIdx` selects which audio stream is muxed in (0-based among audio
 * streams) so multi-language tracks are switchable: the player reloads the
 * playlist with a different ?a=N when the Leader changes the audio track.
 *
 * This NEVER triggers pre-warm — getHlsSegment() is the only warmer and it
 * calls this directly, so warming can't cascade across the whole file (the old
 * bug spawned one ffmpeg per remaining segment on a single request).
 */
function generateHlsSegment(filePath: string, mediaId: string, idx: number, hasAudio: boolean, audioIdx: number): Promise<Buffer> {
  const key = `${mediaId}:${idx}:a${audioIdx}`;
  const cached = hlsSegCache.get(key);
  if (cached) return cached;

  const startTime = idx * HLS_SEG_SECS;

  const p = acquireHlsSlot().then(() => new Promise<Buffer>((resolve, reject) => {
    // `0:a:N?` — optional map, so a bad index doesn't fail the whole segment.
    const audioArgs = hasAudio
      ? ['-map', `0:a:${audioIdx}?`, '-c:a', 'aac', '-b:a', '192k', '-ac', '2']
      : [];
    const proc = spawn('ffmpeg', [
      '-ss', String(startTime),
      '-i', filePath,
      '-t', String(HLS_SEG_SECS),
      '-map', '0:v:0',
      ...audioArgs,
      '-c:v', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-reset_timestamps', '1',
      '-max_muxing_queue_size', '1024',
      '-f', 'mpegts',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'inherit'] });

    const chunks: Buffer[] = [];
    proc.stdout!.on('data', (c: Buffer) => chunks.push(c));
    proc.on('close', code => {
      releaseHlsSlot();
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg segment ${idx} exited ${code}`));
    });
    proc.on('error', err => { releaseHlsSlot(); reject(err); });
  }));

  p.then(() => setTimeout(() => hlsSegCache.delete(key), 180_000))
   .catch(() => hlsSegCache.delete(key));

  hlsSegCache.set(key, p);
  return p;
}

function getHlsSegment(filePath: string, mediaId: string, idx: number, hasAudio = true, totalSegs?: number, audioIdx = 0): Promise<Buffer> {
  const seg = generateHlsSegment(filePath, mediaId, idx, hasAudio, audioIdx);
  // Pre-warm a *bounded* number of upcoming segments so the player doesn't
  // stall at boundaries. Calls generateHlsSegment directly → never cascades.
  for (let ahead = 1; ahead <= HLS_PREWARM; ahead++) {
    const nextIdx = idx + ahead;
    if (totalSegs !== undefined && nextIdx >= totalSegs) break;
    generateHlsSegment(filePath, mediaId, nextIdx, hasAudio, audioIdx).catch(() => {});
  }
  return seg;
}

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
async function fixAudioInPlace(mp4Path: string, onProgress?: (secs: number) => void): Promise<void> {
  const tmpPath = mp4Path + '.__fix.mp4';
  try {
    console.log(`[audio-fix] transcoding audio in ${path.basename(mp4Path)} → aac`);
    const audioArgs = await buildAudioArgs(mp4Path);
    await ffmpegSpawn([
      '-i', mp4Path,
      '-map', '0:v:0',          // first video stream only
      '-map', '0:a',
      '-c:v', 'copy',
      ...audioArgs,             // copy safe codecs, transcode incompatible ones to AAC
      '-map_metadata', '0',
      '-map_metadata:s', '0:s',
      // NOTE: no -movflags +faststart — on 40GB+ files that requires a full
      // second read+write pass (3× I/O), which can add 30+ minutes on slow disks.
      // Range requests (Accept-Ranges: bytes) handle moov-at-end just fine.
      tmpPath,
    ], { timeout: 3 * 60 * 60 * 1000, onProgress });
    fs.renameSync(tmpPath, mp4Path);
    console.log(`[audio-fix] done ${path.basename(mp4Path)}`);
  } catch (e) {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    throw e;
  }
}

/**
 * Build per-stream audio codec args for ffmpeg.
 * Streams already in a browser-safe codec are copied; others are transcoded to AAC.
 * This avoids re-encoding audio that is already compatible, which on large files
 * (40GB+) can save many minutes of CPU + I/O time.
 */
async function buildAudioArgs(inputPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      inputPath,
    ], { timeout: 15000 });
    const codecs = stdout.trim().split('\n').filter(Boolean).map(l => l.trim());
    if (codecs.length === 0) return ['-c:a', 'aac', '-b:a', '192k'];
    const args: string[] = [];
    let anyTranscode = false;
    for (let i = 0; i < codecs.length; i++) {
      if (BROWSER_SAFE_AUDIO.has(codecs[i])) {
        args.push(`-c:a:${i}`, 'copy');
      } else {
        args.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, '192k');
        anyTranscode = true;
      }
    }
    console.log(`[remux] audio streams: [${codecs.join(', ')}] — ${anyTranscode ? 'some need transcode' : 'all copy'}`);
    return args;
  } catch {
    return ['-c:a', 'aac', '-b:a', '192k']; // safe fallback
  }
}

/** Returns the primary video codec name ('hevc', 'h264', etc.) from ffprobe. */
async function getVideoCodec(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', filePath,
    ], { timeout: 15000 });
    return stdout.trim().toLowerCase();
  } catch { return ''; }
}

/**
 * Remux a video file to MP4.
 * - Copies video stream (no re-encode)
 * - Copies audio streams already in browser-safe codecs (AAC/MP3/Opus/Vorbis)
 * - Transcodes only non-compatible audio streams to AAC
 * - Maps every audio stream so multilingual tracks are preserved
 * - Adds -tag:v hvc1 for HEVC so Chrome plays it without hardware-decoder quirks
 * Returns the .mp4 path; if input is already .mp4/.webm, returns it unchanged.
 */
async function remuxToMp4(inputPath: string, onProgress?: (secs: number) => void): Promise<string> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.mp4' || ext === '.webm') return inputPath;
  const outputPath = inputPath.slice(0, -ext.length) + '.mp4';
  if (fs.existsSync(outputPath)) return outputPath;
  console.log(`[remux] ${path.basename(inputPath)} → mp4`);
  const [audioArgs, videoCodec] = await Promise.all([buildAudioArgs(inputPath), getVideoCodec(inputPath)]);
  const isHevc = videoCodec === 'hevc';
  await ffmpegSpawn([
    '-i', inputPath,
    '-map', '0:v:0',          // first video stream only (avoids DV dual-layer duration issues)
    '-map', '0:a',            // all audio streams
    '-c:v', 'copy',           // copy video — no re-encode
    ...(isHevc ? ['-tag:v', 'hvc1'] : []),  // Chrome requires hvc1 tag for HEVC in MP4
    ...audioArgs,             // per-stream: copy if already browser-safe, else → aac
    '-map_metadata', '0',
    '-map_metadata:s', '0:s',
    // No +faststart: on 40GB+ files that's 3× disk I/O. Range requests handle moov-at-end.
    outputPath,
  ], { timeout: 3 * 60 * 60 * 1000, onProgress });
  console.log(`[remux] done → ${path.basename(outputPath)}`);
  try {
    await fs.promises.unlink(inputPath);
    console.log(`[remux] deleted original ${path.basename(inputPath)}`);
  } catch (e: any) {
    console.warn(`[remux] could not delete original: ${e.message}`);
  }
  return outputPath;
}


// ─── Background MP4 conversion ────────────────────────────────────────────────
// Converts HLS-served files to proper MP4 with +faststart for native browser
// seeking. Runs in background after download completes so the file is
// immediately watchable via HLS, then switches to MP4 when done.

const BACKGROUND_REMUX_SIZE_LIMIT = 8 * 1024 * 1024 * 1024; // 8 GB

async function backgroundRemux(mediaId: string, inputPath: string, title: string): Promise<void> {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.mp4' || ext === '.webm') return; // already compatible
  const outputPath = inputPath.slice(0, -ext.length) + '.mp4';
  if (fs.existsSync(outputPath)) return;

  const fileSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
  if (fileSize === 0 || fileSize > BACKGROUND_REMUX_SIZE_LIMIT) {
    console.log(`[bg-remux] skipping "${title}" — size ${(fileSize / 1e9).toFixed(1)} GB exceeds limit`);
    return;
  }

  console.log(`[bg-remux] starting "${title}" (${(fileSize / 1e9).toFixed(1)} GB) → mp4`);

  // Mark item as converting so the frontend can show a progress bar
  const markConverting = (pct?: number) => {
    const it = mediaLibrary.find(m => m.id === mediaId);
    if (!it) return;
    (it as any).converting = true;
    if (pct !== undefined) (it as any).convertingProgress = pct;
  };
  const clearConverting = () => {
    const it = mediaLibrary.find(m => m.id === mediaId);
    if (!it) return;
    delete (it as any).converting;
    delete (it as any).convertingProgress;
  };

  markConverting(0);
  io.emit('media:updated', mediaLibrary);

  // Throttle progress events (emit at most once per 3 s)
  let lastProgressEmit = 0;
  const onProgress = (secs: number) => {
    const it = mediaLibrary.find(m => m.id === mediaId);
    if (!it) return;
    const pct = Math.min(99, Math.round((secs / (it.duration || 1)) * 100));
    (it as any).convertingProgress = pct;
    const now = Date.now();
    if (now - lastProgressEmit > 3000) {
      lastProgressEmit = now;
      io.emit('media:updated', mediaLibrary);
    }
  };

  try {
    const [audioArgs, videoCodec] = await Promise.all([buildAudioArgs(inputPath), getVideoCodec(inputPath)]);
    const isHevc = videoCodec === 'hevc';

    await ffmpegSpawn([
      '-i', inputPath,
      '-map', '0:v:0',
      '-map', '0:a',
      '-c:v', 'copy',
      ...(isHevc ? ['-tag:v', 'hvc1'] : []),
      ...audioArgs,
      '-map_metadata', '0',
      '-movflags', '+faststart',  // moov atom at beginning → instant browser seeking
      outputPath,
    ], { timeout: 4 * 60 * 60 * 1000, onProgress });

    clearConverting();
    console.log(`[bg-remux] done "${title}" → mp4 — switching media item`);

    // Switch media item to MP4
    const relPath = path.relative(dl.DOWNLOADS_DIR, outputPath);
    const mp4Url  = '/media/' + relPath.split(path.sep).map(encodeURIComponent).join('/');

    const item = mediaLibrary.find(m => m.id === mediaId);
    if (item) {
      item.videoUrl = mp4Url;
      // Clear HLS segment cache for this item so stale segments are not served
      for (const k of Array.from(hlsSegCache.keys())) {
        if (k.startsWith(mediaId + ':')) hlsSegCache.delete(k);
      }
    }
    await db.mediaItem.update({
      where:  { id: mediaId },
      data:   { videoUrl: mp4Url },
    }).catch((e: Error) => console.warn('[bg-remux] DB update failed:', e.message));

    io.emit('media:updated', mediaLibrary);
    console.log(`[bg-remux] "${title}" switched to MP4`);

    // Delete original after brief grace period (lets any active HLS sessions finish)
    setTimeout(async () => {
      try {
        if (fs.existsSync(inputPath)) {
          await fs.promises.unlink(inputPath);
          console.log(`[bg-remux] deleted original ${path.basename(inputPath)}`);
        }
      } catch (e: any) {
        console.warn('[bg-remux] could not delete original:', e.message);
      }
    }, 60_000);

  } catch (e: any) {
    clearConverting();
    io.emit('media:updated', mediaLibrary);
    console.error(`[bg-remux] failed for "${title}":`, e.message);
    // Clean up partial output
    if (fs.existsSync(outputPath)) fs.promises.unlink(outputPath).catch(() => {});
  }
}

// ─── TMDB metadata ────────────────────────────────────────────────────────────
const TMDB_GENRES: Record<number, string> = {
  28: 'Экшн', 12: 'Приключения', 16: 'Анимация', 35: 'Комедия', 80: 'Криминал',
  99: 'Документальный', 18: 'Драма', 10751: 'Семейный', 14: 'Фэнтези',
  36: 'Исторический', 27: 'Ужасы', 9648: 'Детектив', 10749: 'Мелодрама',
  878: 'Фантастика', 53: 'Триллер', 10752: 'Военный', 37: 'Вестерн',
};

/** Extract a clean title and optional year from a raw torrent filename. */
// Common scene-release tokens that follow the title — used to trim noise so
// TMDB search hits the real movie even when there's no year in the name.
const RELEASE_TOKENS = /\b(1080p|2160p|720p|480p|4k|uhd|bluray|blu-ray|bdrip|brrip|webrip|web-?dl|web|hdrip|dvdrip|hdtv|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|eac3|dts|dd[p]?5\.?1|atmos|remux|proper|repack|hdr|hdr10|dv|10bit|imax|amzn|nf)\b/i;

function parseTitleAndYear(filename: string): { title: string; year?: number } {
  let base = filename.replace(/\.[^.]+$/, '');     // strip extension
  base = base.replace(/[._]+/g, ' ');              // dots/underscores → spaces
  const yearMatch = base.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
  let titlePart = yearMatch ? base.slice(0, yearMatch.index) : base;
  // No year? Cut at the first release token (resolution/source/codec/…).
  if (!yearMatch) {
    const tok = titlePart.match(RELEASE_TOKENS);
    if (tok && (tok.index ?? 0) > 0) titlePart = titlePart.slice(0, tok.index);
  }
  const title = titlePart.replace(/[\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  return { title, year };
}

interface TmdbMeta {
  title: string; year: number; poster: string; thumbnail: string;
  genre: string; description: string;
}

/** Query TMDB for movie metadata. Returns null if TMDB_API_KEY not set or request fails. */
async function fetchTmdbMetadata(rawFilename: string): Promise<TmdbMeta | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  const { title, year } = parseTitleAndYear(rawFilename);
  if (!title) return null;

  const trySearch = async (lang: string): Promise<TmdbMeta | null> => {
    try {
      const params = new URLSearchParams({ api_key: apiKey, query: title, language: lang });
      if (year) params.set('year', String(year));
      const res = await fetch(
        `https://api.themoviedb.org/3/search/movie?${params}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) return null;
      const data = await res.json() as { results?: any[] };
      const m = data.results?.[0];
      if (!m) return null;
      const releaseYear = m.release_date ? parseInt(m.release_date.slice(0, 4)) : (year ?? new Date().getFullYear());
      const genre = (m.genre_ids as number[] ?? []).slice(0, 2)
        .map((id: number) => TMDB_GENRES[id]).filter(Boolean).join(', ') || 'Фильм';
      return {
        title:       m.title       || title,
        year:        releaseYear,
        poster:      m.poster_path   ? `https://image.tmdb.org/t/p/w500${m.poster_path}`    : '',
        thumbnail:   m.backdrop_path ? `https://image.tmdb.org/t/p/w1280${m.backdrop_path}` : '',
        genre,
        description: m.overview || '',
      };
    } catch { return null; }
  };

  // Try Russian first (poster/title in RU), fall back to English for description if empty
  const ru = await trySearch('ru-RU');
  if (ru?.description) return ru;
  const en = await trySearch('en-US');
  return en ?? ru;
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
          // Try title, then handler_name (MP4 preserves title here), then fallback
          const title = s.tags?.title ?? s.tags?.handler_name;
          const label = title
            ? title
            : lang !== 'und'
              ? `${lang.toUpperCase()} ${i + 1}`
              : `Track ${i + 1}`;
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

// ─── Subtitle extraction (embedded + external → WebVTT) ────────────────────────
// Browsers render WebVTT via <track>. Each text-based subtitle stream is
// extracted once, stored next to the video, and served via /media. Bitmap subs
// (PGS/VobSub) can't become text and are skipped.
const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'stl']);
const SUB_FILE_EXTS   = new Set(['.srt', '.vtt', '.ass', '.ssa']);

interface SubEntry { id: string; label: string; lang: string; src?: string }

function mediaUrlFor(absPath: string): string {
  const rel = path.relative(dl.DOWNLOADS_DIR, absPath);
  return '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/');
}

function guessLangFromName(name: string): string {
  const n = name.toLowerCase();
  if (/(\b|_)(rus|russian|ru)(\b|_)/.test(n)) return 'rus';
  if (/(\b|_)(eng|english|en)(\b|_)/.test(n)) return 'eng';
  if (/(\b|_)(spa|spanish|es)(\b|_)/.test(n)) return 'spa';
  if (/(\b|_)(fre|fra|french|fr)(\b|_)/.test(n)) return 'fre';
  if (/(\b|_)(ger|deu|german|de)(\b|_)/.test(n)) return 'ger';
  if (/(\b|_)(ukr|ukrainian|uk)(\b|_)/.test(n)) return 'ukr';
  return 'und';
}

/** Extract embedded text subtitle streams to sibling .vtt files (ids `sub_<i>`). */
async function extractEmbeddedSubtitles(filePath: string): Promise<SubEntry[]> {
  let streams: any[] = [];
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-select_streams', 's',
      '-show_entries', 'stream=codec_name:stream_tags=language,title',
      '-of', 'json', filePath,
    ], { timeout: 30000 });
    streams = JSON.parse(stdout).streams ?? [];
  } catch { return []; }

  const dir  = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const out: SubEntry[] = [];

  for (let i = 0; i < streams.length; i++) {
    const codec = (streams[i].codec_name ?? '').toLowerCase();
    if (!TEXT_SUB_CODECS.has(codec)) continue; // skip bitmap subs
    const lang  = streams[i].tags?.language ?? 'und';
    const title = streams[i].tags?.title;
    const vttPath = path.join(dir, `${base}.s${i}.${lang}.vtt`);
    try {
      if (!fs.existsSync(vttPath)) {
        await ffmpegSpawn(['-i', filePath, '-map', `0:s:${i}`, '-c:s', 'webvtt', vttPath], { timeout: 30 * 60 * 1000 });
      }
      out.push({
        id: `sub_${i}`,
        label: title ?? (lang !== 'und' ? lang.toUpperCase() : `Sub ${i + 1}`),
        lang,
        src: mediaUrlFor(vttPath),
      });
    } catch (e: any) {
      console.warn(`[subs] extract stream ${i} failed: ${e.message}`);
    }
  }
  return out;
}

/** Convert external subtitle files shipped in the torrent into served .vtt. */
async function convertExternalSubtitles(subFiles: string[]): Promise<SubEntry[]> {
  const out: SubEntry[] = [];
  for (let i = 0; i < subFiles.length; i++) {
    const f = subFiles[i];
    if (!fs.existsSync(f)) continue;
    const ext  = path.extname(f).toLowerCase();
    const lang = guessLangFromName(path.basename(f));
    try {
      let vttPath = f;
      if (ext !== '.vtt') {
        vttPath = f.slice(0, -ext.length) + '.vtt';
        if (!fs.existsSync(vttPath)) {
          await ffmpegSpawn(['-i', f, '-c:s', 'webvtt', vttPath], { timeout: 5 * 60 * 1000 });
        }
      }
      out.push({
        id: `ext_${i}`,
        label: lang !== 'und' ? lang.toUpperCase() : (path.basename(f, ext).slice(0, 20) || `Sub ${i + 1}`),
        lang,
        src: mediaUrlFor(vttPath),
      });
    } catch (e: any) {
      console.warn(`[subs] external convert failed for ${path.basename(f)}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Background: fill in WebVTT sources for a media item's subtitles (embedded +
 * external) and broadcast the update. Safe to call repeatedly — already-present
 * .vtt files are reused.
 */
async function attachSubtitles(mediaId: string, filePath: string, externalSubFiles: string[]): Promise<void> {
  const item = mediaLibrary.find(m => m.id === mediaId);
  if (!item) return;
  const [embedded, external] = await Promise.all([
    extractEmbeddedSubtitles(filePath).catch(() => [] as SubEntry[]),
    convertExternalSubtitles(externalSubFiles).catch(() => [] as SubEntry[]),
  ]);
  if (embedded.length === 0 && external.length === 0) return;

  const byId = new Map(embedded.map(e => [e.id, e]));
  const merged: SubEntry[] = item.subtitles.map(s => byId.get(s.id) ?? s);
  for (const e of embedded) if (!merged.some(m => m.id === e.id)) merged.push(e);
  for (const e of external) merged.push(e);

  item.subtitles = merged as MediaItem['subtitles'];
  await db.mediaItem.update({ where: { id: mediaId }, data: { subtitles: merged as any } })
    .catch((e: Error) => console.warn('[subs] DB update failed:', e.message));
  io.emit('media:updated', mediaLibrary);
  console.log(`[subs] "${item.title}" — ${embedded.length} embedded + ${external.length} external tracks`);
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

    // Probe duration/streams — reads only file headers, completes in ~1-2 seconds
    // even for 40GB files (no full file read needed).
    let duration = 0;
    let audio: MediaItem['audio'] = [{ id: 0, label: 'Track 1', lang: 'und' }];
    let subtitles: MediaItem['subtitles'] = [{ id: 'off', label: 'Off', lang: 'off' }];
    try {
      const info = await probeVideoFile(filePath);
      duration = Math.round(info.duration);
      audio    = info.audio;
      subtitles = info.subtitles;
    } catch (e: any) {
      console.error('[probe] failed:', e.message);
    }

    const tempId  = uuidv4();
    const relPath = path.relative(dl.DOWNLOADS_DIR, filePath);
    const ext     = path.extname(filePath).toLowerCase();

    // Serve directly only if it's an MP4 with browser-safe audio AND a
    // browser-safe video codec. HEVC/x265 inside MP4 needs the `hvc1` tag to
    // play in Chrome, which a raw download won't have → stream via HLS instead
    // (MPEG-TS doesn't need the tag, and background remux later produces a
    // proper tagged MP4). Everything else also streams via HLS on-demand.
    const [audioNeedsFix, vcodec] = await Promise.all([
      needsAudioFix(filePath).catch(() => true),
      getVideoCodec(filePath).catch(() => ''),
    ]);
    const isDirectMp4 = ext === '.mp4' && !audioNeedsFix && vcodec !== 'hevc' && vcodec !== 'h265';
    const videoUrl = isDirectMp4
      ? '/media/' + relPath.split('/').map(encodeURIComponent).join('/')
      : `/hls-mkv/${tempId}/index.m3u8?p=${encodeURIComponent(relPath)}`;

    console.log(`[media] "${title}" → ${isDirectMp4 ? 'direct MP4' : 'HLS on-demand'}`);

    // Fetch metadata from TMDB (uses filename → clean title → TMDB search)
    const tmdb = await fetchTmdbMetadata(f.name);
    const finalTitle       = tmdb?.title       ?? title;
    const finalYear        = tmdb?.year        ?? new Date().getFullYear();
    const finalGenre       = tmdb?.genre       ?? 'Фильм';
    const finalDescription = tmdb?.description ?? '';
    const finalPoster      = tmdb?.poster      || `https://picsum.photos/seed/${item.id}/400/600`;
    const finalThumbnail   = tmdb?.thumbnail   || `https://picsum.photos/seed/${item.id}/800/450`;
    if (tmdb) console.log(`[tmdb] matched "${f.name}" → "${finalTitle}" (${finalYear})`);

    // Start background MP4 conversion (non-blocking) — file immediately watchable via HLS,
    // switches to faststart MP4 when done for native browser seeking
    setImmediate(() => {
      backgroundRemux(tempId, filePath, finalTitle).catch(console.error);
    });

    const newItem: MediaItem = {
      id: tempId,
      title: finalTitle,
      poster: finalPoster,
      thumbnail: finalThumbnail,
      duration, year: finalYear,
      genre: finalGenre, description: finalDescription,
      audio, subtitles,
      qualities: ['Auto'], status: 'ready', videoUrl,
    };
    mediaLibrary.push(newItem);
    item.mediaIds.push(tempId);

    // Extract subtitles (embedded streams + external .srt/.ass from the torrent)
    // in the background and attach them as WebVTT <track>s when ready.
    const externalSubFiles = item.files
      .filter(sf => SUB_FILE_EXTS.has(path.extname(sf.name).toLowerCase()))
      .map(sf => {
        let p = path.join(dl.DOWNLOADS_DIR, sf.path);
        if (!fs.existsSync(p)) {
          const flat = path.join(dl.DOWNLOADS_DIR, sf.name);
          if (fs.existsSync(flat)) p = flat;
        }
        return p;
      })
      .filter(p => fs.existsSync(p));
    setImmediate(() => { attachSubtitles(tempId, filePath, externalSubFiles).catch(console.error); });

    await db.mediaItem.create({
      data: {
        id: tempId, title: finalTitle, poster: finalPoster,
        thumbnail: finalThumbnail, duration, year: finalYear,
        genre: finalGenre, description: finalDescription,
        audio: audio as any, subtitles: subtitles as any,
        qualities: newItem.qualities as any, status: 'ready',
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
      '.vtt': 'text/vtt; charset=utf-8',
    };
    if (mimeMap[ext]) res.setHeader('Content-Type', mimeMap[ext]);
    // Allow seeking via range requests
    res.setHeader('Accept-Ranges', 'bytes');
  },
}));

// ── HLS manifest ─────────────────────────────────────────────────────────────
// videoUrl format for HLS items: /hls-mkv/:id/index.m3u8?p=encodedRelPath
// The relative path is URL-encoded inside ?p= so it survives server restarts.
app.get('/hls-mkv/:id/index.m3u8', (req: Request, res: Response) => {
  const { id } = req.params;
  const encodedRel = req.query.p as string;
  if (!encodedRel) { res.status(400).end(); return; }

  const item = mediaLibrary.find(m => m.id === id);
  if (!item) { res.status(404).end(); return; }

  const duration = item.duration || 0;
  const numSegs  = Math.ceil(duration / HLS_SEG_SECS) || 1;
  // Audio track index (0-based among audio streams). The player requests the
  // manifest with ?a=N when the Leader switches audio; segments inherit it.
  const audioIdx = Math.max(0, parseInt((req.query.a as string) ?? '0') || 0);
  const pParam   = `p=${encodeURIComponent(encodedRel)}&a=${audioIdx}`;

  const lines: string[] = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${HLS_SEG_SECS}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (let i = 0; i < numSegs; i++) {
    const segLen = duration > 0
      ? Math.min(HLS_SEG_SECS, duration - i * HLS_SEG_SECS)
      : HLS_SEG_SECS;
    lines.push(`#EXTINF:${segLen.toFixed(6)},`);
    lines.push(`/hls-mkv/${id}/seg/${i}.ts?${pParam}`);
  }
  lines.push('#EXT-X-ENDLIST');

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(lines.join('\n'));
});

// ── HLS segment ───────────────────────────────────────────────────────────────
app.get('/hls-mkv/:id/seg/:idx.ts', async (req: Request, res: Response) => {
  const { id } = req.params;
  const idx = parseInt(req.params.idx);
  const encodedRel = req.query.p as string;
  if (isNaN(idx) || !encodedRel) { res.status(400).end(); return; }

  const relPath  = decodeURIComponent(encodedRel);
  const filePath = path.join(dl.DOWNLOADS_DIR, relPath);
  // Prevent path traversal
  if (!filePath.startsWith(dl.DOWNLOADS_DIR)) { res.status(403).end(); return; }
  if (!fs.existsSync(filePath)) { res.status(404).end(); return; }

  try {
    const mediaItem = mediaLibrary.find(m => m.id === id);
    const hasAudio  = !mediaItem || mediaItem.audio.length > 0;
    const totalSegs = mediaItem?.duration ? Math.ceil(mediaItem.duration / HLS_SEG_SECS) : undefined;
    const audioIdx  = Math.max(0, parseInt((req.query.a as string) ?? '0') || 0);
    const data = await getHlsSegment(filePath, id, idx, hasAudio, totalSegs, audioIdx);
    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(data);
  } catch (e: any) {
    console.error(`[hls-seg] ${id}:${idx} — ${e.message}`);
    if (!res.headersSent) res.status(500).end();
  }
});

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
// Reconnect grace timers: key = `${userId}:${roomId}`, value = timer
const leaderGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const participantGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    // Cancel any pending reconnect grace timer for this user (leader or participant)
    const graceKey = `${socket.data.userId}:${data.roomId}`;
    if (leaderGraceTimers.has(graceKey)) {
      clearTimeout(leaderGraceTimers.get(graceKey)!);
      leaderGraceTimers.delete(graceKey);
      console.log(`[leader-grace] ${socket.data.nickname} reconnected — grace cancelled`);
    }
    if (participantGraceTimers.has(graceKey)) {
      clearTimeout(participantGraceTimers.get(graceKey)!);
      participantGraceTimers.delete(graceKey);
      console.log(`[participant-grace] ${socket.data.nickname} reconnected — grace cancelled`);
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
    const sender = room.participants.find(p => p.id === socket.data.userId);
    const msg = rm.addMessage(rid, { userId: socket.data.userId, nickname: socket.data.nickname, text: d.text.substring(0, 500).trim(), avatar: sender?.avatar });
    if (msg) { io.to(rid).emit('room:message', msg); cb?.({ success: true }); }
  });

  socket.on('room:whisper', (d: { targetUserId: string; text: string }) => {
    const rid = socket.data.roomId; if (!rid) return;
    const room = rm.getRoomById(rid); if (!room) return;
    const target = room.participants.find(p => p.id === d.targetUserId); if (!target) return;
    const sender = room.participants.find(p => p.id === socket.data.userId);
    const msg = rm.addMessage(rid, { userId: socket.data.userId, nickname: socket.data.nickname, text: d.text.substring(0, 500).trim(), avatar: sender?.avatar, isWhisper: true, whisperTo: target.nickname, whisperToId: d.targetUserId });
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
    const graceKey = `${userId}:${roomId}`;
    if (room && room.leaderId === userId) {
      // Leader disconnected — give 30s grace period before removing them.
      if (!leaderGraceTimers.has(graceKey)) {
        console.log(`[leader-grace] ${socket.data.nickname} disconnected — 30s grace started`);
        const timer = setTimeout(() => {
          leaderGraceTimers.delete(graceKey);
          doLeave(roomId, userId, socket);
          console.log(`[leader-grace] ${socket.data.nickname} — grace expired, removed from room`);
        }, 30_000);
        leaderGraceTimers.set(graceKey, timer);
      }
    } else if (room) {
      // Non-leader participant — give 15s grace period so F5 restores their seat.
      if (!participantGraceTimers.has(graceKey)) {
        console.log(`[participant-grace] ${socket.data.nickname} disconnected — 15s grace started`);
        const timer = setTimeout(() => {
          participantGraceTimers.delete(graceKey);
          doLeave(roomId, userId, socket);
          console.log(`[participant-grace] ${socket.data.nickname} — grace expired, removed from room`);
        }, 15_000);
        participantGraceTimers.set(graceKey, timer);
      }
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

    // HEVC (x265) in MP4 without the hvc1 tag won't play in Chrome.
    // Switch these entries to HLS on-demand: MPEG-TS segments don't need hvc1,
    // and ffmpeg re-encodes audio per-segment so any remaining AC3 is also fixed.
    if (path.extname(filePath).toLowerCase() === '.mp4') {
      try {
        const codec = await getVideoCodec(filePath);
        if (codec === 'hevc') {
          const relPath = path.relative(dl.DOWNLOADS_DIR, filePath);
          const hlsUrl = `/hls-mkv/${item.id}/index.m3u8?p=${encodeURIComponent(relPath)}`;
          item.videoUrl = hlsUrl;
          const { duration, audio, subtitles } = await probeVideoFile(filePath);
          item.duration = Math.round(duration);
          item.audio = audio;
          item.subtitles = subtitles;
          await db.mediaItem.update({
            where: { id: item.id },
            data: { videoUrl: hlsUrl, duration: Math.round(duration), audio: audio as any, subtitles: subtitles as any },
          }).catch((e: Error) => console.error('[repair] DB update failed:', e.message));
          console.log(`[repair] HEVC MP4 switched to HLS: "${item.title}"`);
          continue;
        }
      } catch (e: any) {
        console.error(`[repair] HEVC check failed for "${item.title}":`, e.message);
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

/** Resolve the on-disk video file for a media item (handles /media + /hls-mkv). */
function resolveItemFilePath(item: MediaItem): string | null {
  let rel: string | null = null;
  if (item.videoUrl.startsWith('/media/')) {
    rel = item.videoUrl.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
  } else if (item.videoUrl.startsWith('/hls-mkv/')) {
    const q = item.videoUrl.split('?')[1] ?? '';
    const p = new URLSearchParams(q).get('p');
    if (p) rel = decodeURIComponent(p);
  }
  if (!rel) return null;
  let abs = path.join(dl.DOWNLOADS_DIR, rel);
  if (!fs.existsSync(abs)) {
    const flat = path.join(dl.DOWNLOADS_DIR, path.basename(rel));
    if (!fs.existsSync(flat)) return null;
    abs = flat;
  }
  return abs;
}

/**
 * On startup: backfill WebVTT subtitle sources for media items that have
 * subtitle streams detected but no served .vtt yet (i.e. downloaded before
 * subtitle extraction existed). Skips items whose tracks already have a src.
 */
async function backfillSubtitles() {
  for (const item of mediaLibrary) {
    const needs = item.subtitles.some(s => s.id !== 'off' && !s.src);
    if (!needs) continue;
    const file = resolveItemFilePath(item);
    if (!file) continue;
    await attachSubtitles(item.id, file, []).catch(e => console.warn('[subs] backfill failed:', e.message));
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
    // Fix broken paths / remux legacy MKV items in background (non-blocking),
    // then backfill subtitle tracks for items that don't have them yet.
    repairMediaLibrary()
      .then(() => backfillSubtitles())
      .catch(e => console.error('[repair] fatal:', e.message));
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
