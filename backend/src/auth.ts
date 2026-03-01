import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'noctiviem_dev_secret_change_in_prod';
const DATA_DIR = path.join(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface StoredUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  settings: UserSettings;
}

export interface UserSettings {
  nickname: string;
  avatarSeed: string;
  defaultQuality: string;
  defaultAudioLang: string;
  defaultSubsLang: string;
  maxConcurrentDownloads: number;
  autoSyncOnJoin: boolean;
}

export type PublicUser = Omit<StoredUser, 'passwordHash'>;

// ── Persistence ──────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function load(): StoredUser[] {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(users: StoredUser[]) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let users: StoredUser[] = load();

// ── Auth functions ───────────────────────────────────────────────────────────

export function register(
  username: string,
  email: string,
  password: string,
): { user: PublicUser; token: string } | { error: string } {
  const emailLc = email.trim().toLowerCase();
  const usernameTr = username.trim();

  if (!usernameTr || usernameTr.length < 2) return { error: 'Username must be at least 2 characters' };
  if (!emailLc.includes('@')) return { error: 'Invalid email address' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters' };

  if (users.find(u => u.email === emailLc)) return { error: 'Email already registered' };
  if (users.find(u => u.username.toLowerCase() === usernameTr.toLowerCase())) {
    return { error: 'Username already taken' };
  }

  const user: StoredUser = {
    id: uuidv4(),
    username: usernameTr,
    email: emailLc,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: Date.now(),
    settings: {
      nickname: usernameTr,
      avatarSeed: uuidv4(),
      defaultQuality: 'Auto',
      defaultAudioLang: 'any',
      defaultSubsLang: 'off',
      maxConcurrentDownloads: 2,
      autoSyncOnJoin: true,
    },
  };

  users.push(user);
  save(users);

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  const { passwordHash: _, ...pub } = user;
  return { user: pub, token };
}

export function login(
  email: string,
  password: string,
): { user: PublicUser; token: string } | { error: string } {
  const u = users.find(u => u.email === email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.passwordHash)) {
    return { error: 'Invalid email or password' };
  }
  const token = jwt.sign({ userId: u.id }, JWT_SECRET, { expiresIn: '30d' });
  const { passwordHash: _, ...pub } = u;
  return { user: pub, token };
}

export function verifyToken(token: string): string | null {
  try {
    return (jwt.verify(token, JWT_SECRET) as { userId: string }).userId;
  } catch {
    return null;
  }
}

export function getById(id: string): PublicUser | null {
  const u = users.find(u => u.id === id);
  if (!u) return null;
  const { passwordHash: _, ...pub } = u;
  return pub;
}

export function updateSettings(
  userId: string,
  body: {
    username?: string;
    nickname?: string;
    avatarSeed?: string;
    defaultQuality?: string;
    defaultAudioLang?: string;
    defaultSubsLang?: string;
    maxConcurrentDownloads?: number;
    autoSyncOnJoin?: boolean;
    currentPassword?: string;
    newPassword?: string;
  },
): { user: PublicUser } | { error: string } {
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { error: 'User not found' };
  const u = users[idx];

  if (body.newPassword) {
    if (!body.currentPassword || !bcrypt.compareSync(body.currentPassword, u.passwordHash)) {
      return { error: 'Current password is incorrect' };
    }
    if (body.newPassword.length < 6) return { error: 'New password must be at least 6 characters' };
    u.passwordHash = bcrypt.hashSync(body.newPassword, 10);
  }

  if (body.username && body.username !== u.username) {
    if (users.find(x => x.username.toLowerCase() === body.username!.toLowerCase() && x.id !== userId)) {
      return { error: 'Username already taken' };
    }
    u.username = body.username.trim();
  }

  const s = u.settings;
  if (body.nickname !== undefined) s.nickname = body.nickname;
  if (body.avatarSeed !== undefined) s.avatarSeed = body.avatarSeed;
  if (body.defaultQuality !== undefined) s.defaultQuality = body.defaultQuality;
  if (body.defaultAudioLang !== undefined) s.defaultAudioLang = body.defaultAudioLang;
  if (body.defaultSubsLang !== undefined) s.defaultSubsLang = body.defaultSubsLang;
  if (body.maxConcurrentDownloads !== undefined) s.maxConcurrentDownloads = body.maxConcurrentDownloads;
  if (body.autoSyncOnJoin !== undefined) s.autoSyncOnJoin = body.autoSyncOnJoin;

  save(users);
  const { passwordHash: _, ...pub } = u;
  return { user: pub };
}

export function deleteAccount(userId: string): boolean {
  const before = users.length;
  users = users.filter(u => u.id !== userId);
  save(users);
  return users.length < before;
}
