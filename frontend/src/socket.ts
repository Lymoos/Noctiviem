import { io, Socket } from 'socket.io-client';
import { randomUUID } from './utils';

let userId = localStorage.getItem('noctiviem_userId');
let nickname = localStorage.getItem('noctiviem_nickname');

if (!userId) {
  userId = randomUUID();
  localStorage.setItem('noctiviem_userId', userId);
}

if (!nickname) {
  nickname = `Viewer_${userId.slice(0, 4).toUpperCase()}`;
  localStorage.setItem('noctiviem_nickname', nickname);
}

const token = localStorage.getItem('noctiviem_token') ?? '';

export const socket: Socket = io('/', {
  query: { userId, nickname, token },
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

export function getLocalUserId(): string {
  return userId!;
}

export function getLocalNickname(): string {
  return nickname!;
}

export function setLocalNickname(n: string) {
  nickname = n;
  localStorage.setItem('noctiviem_nickname', n);
}

/**
 * Re-read identity from localStorage and apply it to the socket handshake.
 * The query is only sent on connect, so if we're already connected we cycle the
 * connection. Call this after login/register/logout/nickname changes — otherwise
 * the socket keeps the stale guest id/token captured at page load and profile,
 * watch-history and friends-only checks all use the wrong user.
 */
export function updateSocketAuth() {
  userId = localStorage.getItem('noctiviem_userId') || userId;
  nickname = localStorage.getItem('noctiviem_nickname') || nickname;
  const freshToken = localStorage.getItem('noctiviem_token') ?? '';
  socket.io.opts.query = { userId, nickname, token: freshToken };
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}
