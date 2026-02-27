# 🎬 Noctiviem

> *Night + View* — A private synchronized cinema experience.

A closed online cinema platform with real-time playback sync, a virtual cinema hall with seats, and absolute Leader control.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · TypeScript · Vite · TailwindCSS |
| Real-time | Socket.io (client + server) |
| Backend | Node.js · Express · TypeScript |
| State | Zustand |
| Icons | Lucide React |

## Quick Start

```bash
# Install all dependencies (workspaces)
npm install

# Run backend + frontend concurrently
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## Features

### Dashboard
- Media library grid with film cards (poster, duration, tracks info, status badges)
- "Downloaded" section for processing files
- Active halls list
- Connect Source modal (Jellyfin, Plex, SMB, WebDAV, S3)

### Cinema Hall
- **Leader**: Creates a hall, gets absolute control
- **Viewers**: Join via invite link/code
- 24 cinema seats (3 rows × 8) with avatars
- Chat bubbles appear above seats when messages are sent
- Floating emoji reactions rise from seats
- 👏 clap triggers a wave light effect across all seats
- Whisper system (click on a seat → private message)

### Video Player
- Full custom HTML5 player
- Film grain overlay + cinema vignette
- Screen glow effect
- Leader-only controls: Play/Pause/Seek/Audio/Subtitles/Quality
- Reaction markers on the timeline
- Auto-hide controls

### Sync Engine
- Leader-authoritative state
- Heartbeat every 3s
- < 0.5s drift: micro-correction
- > 1.5s drift: hard seek
- New viewer gets snapshot on join

### Leader Controls
- Play / Pause / Seek
- Audio track selection (synced to all)
- Subtitle selection (synced to all)
- Quality selection
- Enable/disable chat
- Enable/disable reactions
- Lock room (no new viewers)
- Kick viewers
- Delete chat messages

### Privacy
- Invite codes with unique IDs
- Closed rooms (no public listing)
- Room lock

## Project Structure

```
Noctiviem/
├── backend/
│   └── src/
│       ├── index.ts       ← Express + Socket.io server
│       ├── roomManager.ts ← Room state management
│       ├── data.ts        ← Mock media library
│       └── types.ts
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.tsx
        │   ├── Room.tsx
        │   └── Join.tsx
        ├── components/
        │   ├── VideoPlayer.tsx
        │   ├── CinemaHall.tsx
        │   ├── Chat.tsx
        │   ├── LeaderPanel.tsx
        │   ├── CreateRoomModal.tsx
        │   ├── MediaCard.tsx
        │   ├── RoomCard.tsx
        │   └── Navbar.tsx
        ├── store.ts   ← Zustand global state
        ├── socket.ts  ← Socket.io client
        └── index.css  ← Cinematic dark theme
```
