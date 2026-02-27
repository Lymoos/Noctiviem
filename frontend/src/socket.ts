import { io, Socket } from 'socket.io-client';

let userId = localStorage.getItem('noctiviem_userId');
let nickname = localStorage.getItem('noctiviem_nickname');

if (!userId) {
  userId = crypto.randomUUID();
  localStorage.setItem('noctiviem_userId', userId);
}

if (!nickname) {
  nickname = `Viewer_${userId.slice(0, 4).toUpperCase()}`;
  localStorage.setItem('noctiviem_nickname', nickname);
}

export const socket: Socket = io('/', {
  query: { userId, nickname },
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

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  socket.disconnect();
}
