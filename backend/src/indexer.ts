// ─── RuTracker indexer adapter ─────────────────────────────────────────────────
// Wraps nikityy/rutracker-api: lazy login (re-login on session expiry), search
// with seed-sorted results, and magnet resolution on demand. Candidate ranking
// (the "pick the right release" logic) lives here so the rest of the app just
// asks for sorted results.

// rutracker-api ships no types — load it untyped.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RutrackerApi = require('rutracker-api');

let client: any = null;
let loginPromise: Promise<void> | null = null;

function creds(): { username: string; password: string } | null {
  const username = process.env.RUTRACKER_USERNAME;
  const password = process.env.RUTRACKER_PASSWORD;
  return username && password ? { username, password } : null;
}

export function isConfigured(): boolean {
  return creds() !== null;
}

async function ensureLogin(): Promise<void> {
  const c = creds();
  if (!c) throw new Error('RuTracker не настроен (задайте RUTRACKER_USERNAME / RUTRACKER_PASSWORD)');
  if (!client) client = new RutrackerApi();
  if (!loginPromise) {
    loginPromise = client.login(c).catch((e: Error) => { loginPromise = null; throw e; });
  }
  await loginPromise;
}

/** Reset the cached session (used to recover from an expired/invalid login). */
function resetSession(): void {
  client = null;
  loginPromise = null;
}

export interface TrackerResult {
  trackerId: string;
  title: string;
  sizeBytes: number;
  seeders: number;
  leechers: number;
  quality: string;   // 2160p | 1080p | 720p | 480p | SD | CAM | ?
  category: string;
  url: string;
  score: number;     // higher = better auto-pick
}

const QUALITY_RANK: Record<string, number> = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, SD: 0, CAM: -2 };

function parseQuality(title: string): string {
  const t = title.toLowerCase();
  if (/\b(cam|ts|telesync|tc|telecine|scr|screener|workprint)\b/.test(t)) return 'CAM';
  if (/\b(2160p|4k|uhd)\b/.test(t)) return '2160p';
  if (/\b1080[pi]\b/.test(t)) return '1080p';
  if (/\b720[pi]\b/.test(t)) return '720p';
  if (/\b480[pi]\b/.test(t)) return '480p';
  return '?';
}

/** Rank a release for auto-pick: healthy seeders + target quality + sane size. */
function scoreResult(sizeBytes: number, seeders: number, quality: string, targetQuality: string): number {
  let score = 0;
  // Seeders — the single biggest factor (a release no one seeds is useless).
  score += Math.min(60, Math.sqrt(Math.max(0, seeders)) * 6);
  // Quality vs. target.
  const qr = QUALITY_RANK[quality] ?? 0;
  const tr = QUALITY_RANK[targetQuality] ?? 3;
  score += quality === targetQuality ? 40 : 40 - Math.abs(qr - tr) * 12;
  if (quality === 'CAM') score -= 80; // never silently pick a CAM
  // Size sanity (against fakes / wrong files).
  const gb = sizeBytes / 1e9;
  if (gb < 0.1) score -= 40;
  if (gb > 120) score -= 20;
  return Math.round(score);
}

export async function searchTracker(params: { query: string; year?: number; targetQuality?: string }): Promise<TrackerResult[]> {
  const q = `${params.query} ${params.year ?? ''}`.trim();
  const target = params.targetQuality ?? '1080p';

  const runSearch = async () => {
    await ensureLogin();
    return client.search({ query: q, sort: 'seeds', order: 'desc' });
  };

  let raw: any[];
  try {
    raw = await runSearch();
  } catch {
    resetSession();         // session likely expired — re-login once
    raw = await runSearch();
  }

  const out: TrackerResult[] = (raw ?? []).map((t: any) => {
    const quality   = parseQuality(t.title ?? '');
    const seeders   = Number(t.seeds) || 0;
    const sizeBytes = Number(t.size) || 0;
    return {
      trackerId: String(t.id),
      title: String(t.title ?? ''),
      sizeBytes,
      seeders,
      leechers: Number(t.leeches) || 0,
      quality,
      category: String(t.category ?? ''),
      url: String(t.url ?? ''),
      score: scoreResult(sizeBytes, seeders, quality, target),
    };
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}

export async function getMagnet(trackerId: string): Promise<string> {
  try {
    await ensureLogin();
    return await client.getMagnetLink(trackerId);
  } catch {
    resetSession();
    await ensureLogin();
    return await client.getMagnetLink(trackerId);
  }
}
