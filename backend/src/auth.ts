import db from './db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'noctiviem_dev_secret_change_in_prod';

// ── Public shape returned to clients (no passwordHash) ───────────────────────

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  createdAt: number;
  settings: {
    nickname: string;
    avatarSeed: string;
    defaultQuality: string;
    defaultAudioLang: string;
    defaultSubsLang: string;
    maxConcurrentDownloads: number;
    autoSyncOnJoin: boolean;
  };
}

type DbUser = {
  id: string; username: string; email: string; passwordHash: string;
  nickname: string; avatarSeed: string; defaultQuality: string;
  defaultAudioLang: string; defaultSubsLang: string;
  maxConcurrentDownloads: number; autoSyncOnJoin: boolean; createdAt: Date;
};

function toPublic(u: DbUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    createdAt: u.createdAt.getTime(),
    settings: {
      nickname: u.nickname,
      avatarSeed: u.avatarSeed,
      defaultQuality: u.defaultQuality,
      defaultAudioLang: u.defaultAudioLang,
      defaultSubsLang: u.defaultSubsLang,
      maxConcurrentDownloads: u.maxConcurrentDownloads,
      autoSyncOnJoin: u.autoSyncOnJoin,
    },
  };
}

// ── Auth functions ────────────────────────────────────────────────────────────

export async function register(
  username: string,
  email: string,
  password: string,
): Promise<{ user: PublicUser; token: string } | { error: string }> {
  const emailLc = email.trim().toLowerCase();
  const usernameTr = username.trim();

  if (usernameTr.length < 2) return { error: 'Username must be at least 2 characters' };
  if (!emailLc.includes('@')) return { error: 'Invalid email address' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters' };

  if (await db.user.findUnique({ where: { email: emailLc } })) {
    return { error: 'Email already registered' };
  }
  if (await db.user.findFirst({ where: { username: { equals: usernameTr, mode: 'insensitive' } } })) {
    return { error: 'Username already taken' };
  }

  const user = await db.user.create({
    data: {
      id: uuidv4(),
      username: usernameTr,
      email: emailLc,
      passwordHash: await bcrypt.hash(password, 10),
      nickname: usernameTr,
      avatarSeed: uuidv4(),
    },
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return { user: toPublic(user), token };
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: PublicUser; token: string } | { error: string }> {
  const u = await db.user.findFirst({ where: { username: { equals: username.trim(), mode: 'insensitive' } } });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) {
    return { error: 'Invalid username or password' };
  }
  const token = jwt.sign({ userId: u.id }, JWT_SECRET, { expiresIn: '30d' });
  return { user: toPublic(u), token };
}

export function verifyToken(token: string): string | null {
  try {
    return (jwt.verify(token, JWT_SECRET) as { userId: string }).userId;
  } catch {
    return null;
  }
}

export async function getById(id: string): Promise<PublicUser | null> {
  const u = await db.user.findUnique({ where: { id } });
  return u ? toPublic(u) : null;
}

export async function updateSettings(
  userId: string,
  body: {
    email?: string;
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
): Promise<{ user: PublicUser } | { error: string }> {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) return { error: 'User not found' };

  const data: Record<string, unknown> = {};

  if (body.newPassword) {
    if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, u.passwordHash))) {
      return { error: 'Current password is incorrect' };
    }
    if (body.newPassword.length < 6) return { error: 'New password must be at least 6 characters' };
    data.passwordHash = await bcrypt.hash(body.newPassword, 10);
  }

  if (body.email !== undefined) {
    const emailLc = body.email.trim().toLowerCase();
    if (!emailLc.includes('@')) return { error: 'Invalid email address' };
    if (emailLc !== u.email) {
      if (await db.user.findUnique({ where: { email: emailLc } })) {
        return { error: 'Email already registered' };
      }
      data.email = emailLc;
    }
  }

  if (body.nickname !== undefined) data.nickname = body.nickname;
  if (body.avatarSeed !== undefined) data.avatarSeed = body.avatarSeed;
  if (body.defaultQuality !== undefined) data.defaultQuality = body.defaultQuality;
  if (body.defaultAudioLang !== undefined) data.defaultAudioLang = body.defaultAudioLang;
  if (body.defaultSubsLang !== undefined) data.defaultSubsLang = body.defaultSubsLang;
  if (body.maxConcurrentDownloads !== undefined) data.maxConcurrentDownloads = body.maxConcurrentDownloads;
  if (body.autoSyncOnJoin !== undefined) data.autoSyncOnJoin = body.autoSyncOnJoin;

  const updated = await db.user.update({ where: { id: userId }, data });
  return { user: toPublic(updated) };
}

export async function deleteAccount(userId: string): Promise<boolean> {
  try {
    await db.user.delete({ where: { id: userId } });
    return true;
  } catch {
    return false;
  }
}
