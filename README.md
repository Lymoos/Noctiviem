# Noctiviem

> *Night + View* — Private synchronized cinema platform.

A self-hosted watch-party service. Upload torrents, watch films together in a virtual cinema hall with real-time sync, seat-based chat, and full Leader control.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 · TypeScript · Vite · TailwindCSS · Zustand |
| Real-time | Socket.IO (client + server) |
| Backend | Node.js · Express · TypeScript |
| Database | PostgreSQL (via Prisma ORM) |
| Media | WebTorrent · ffmpeg (remux + probe) |
| Auth | JWT (30-day tokens) · bcryptjs |
| Deployment | Docker Compose |

---

## Quick Start

### Development

```bash
npm install          # installs workspaces (root + backend + frontend)
npm run dev          # backend :3001 + frontend :5173 concurrently
```

Requires: Node 18+, PostgreSQL running locally, ffmpeg in PATH.

Set `DATABASE_URL` in your environment or `backend/.env`:
```
DATABASE_URL=postgresql://user:pass@localhost:5432/noctiviem
```

### Production (Docker)

```bash
cp .env.example .env      # fill in secrets
docker compose up -d
```

Default URL: `http://localhost:80`

#### Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | `change_me_please` | JWT signing secret |
| `POSTGRES_PASSWORD` | `noctiviem_dev` | Postgres password |
| `FRONTEND_PORT` | `80` | Host port for the frontend |
| `DOWNLOADS_DIR` | `/data/downloads` | Where torrent files are saved |
| `UPLOADS_DIR` | `/data/uploads` | Where `.torrent` files are stored |
| `MAX_CONCURRENT_DL` | `2` | Max simultaneous active downloads |
| `ADMIN_USERNAMES` | `lymoos` | Comma-separated admin usernames |

---

## Features

### Authentication
- Register / Login with username + password
- JWT tokens stored in localStorage (30-day expiry)
- Protected routes via `AuthGuard`
- Account deletion

### Dashboard
- **Media library grid** — film cards with poster, duration, audio/subtitle track counts, status badge
- **Download progress cards** — while a torrent downloads, its card appears in the grid with an Epic Games-style grayscale-to-color reveal animation tied to download progress
- **Active halls** — rooms currently running, clickable to join
- **Storage indicator** — color-coded disk usage (green < 20 GB / yellow < 50 GB / red ≥ 50 GB)
- Language toggle (RU / EN)

### Torrent Downloads
- Upload a `.torrent` file → preview file list → select which files to download
- Max `MAX_CONCURRENT_DL` downloads run in parallel; rest are queued
- **Queue reordering** — drag-and-drop in the Downloads panel to change priority
- On completion: video is auto-remuxed to MP4 via ffmpeg (stream copy, lossless), probed for audio/subtitle tracks, and added to the media library
- Download and `.torrent` files are cleaned up on removal

### Cinema Hall
- Up to 24 seats (3 rows × 8)
- **Leader** creates the hall and has full playback control
- **Viewers** join via invite link or code
- Seat avatars, real-time presence
- **Chat bubbles** appear above the seat of the sender
- **Floating emoji reactions** rise from seats
- Clap reaction triggers a wave light effect across all seats
- **Whisper** — click a seat to send a private message
- **Profile modal** — click a seat avatar to view user profile, add/remove friend, transfer leadership

### Leader System
- Leader is authoritative for all playback state
- **F5 / reconnect grace** — leader has 30 seconds to reconnect before the room loses its leader state
- **Transfer leadership** — leader can hand off control to any viewer via their profile modal
- Leader controls: Play · Pause · Seek · Audio track · Subtitles · Quality
- Settings: enable/disable chat · enable/disable reactions · lock room · kick viewers · delete messages

### Sync Engine
- Leader heartbeat every 3 seconds
- Drift < 0.5s → micro-correction (rate adjust)
- Drift > 1.5s → hard seek
- New viewer gets a full playback snapshot on join

### Video Player
- Custom HTML5 player with cinema aesthetics (film grain, vignette, screen glow)
- Reaction markers on the timeline
- Multi-audio track and subtitle track support (from ffprobe)
- Auto-hiding controls

### User Profiles
- Public profile page: avatar, nickname, member since, watch history, friends list
- **Privacy toggle** — hide watch history and friends from other users
- Friend system (add / remove)
- Watch history tracked per room session

### Admin Panel (`/admin`)
- Accessible only to accounts listed in `ADMIN_USERNAMES`
- Visible as "Admin Panel" link in the profile dropdown
- **File browser** — lists all files in `DOWNLOADS_DIR` recursively with sizes
- Flags files as **In library** (linked to a media entry) or **Orphaned** (on disk but not in media library)
- Filter by: All / Orphaned / In library
- **Delete any file** permanently from the filesystem; automatically removes the linked media entry and DB record if applicable
- Storage stats: total / in library / orphaned with sizes

### Storage Management
- Deleting a media item from the library also deletes the video file from disk
- Removing a download cleans up partial files and `.torrent` files
- `GET /api/storage/stats` — returns bytes used in downloads and uploads directories
- Files live in Docker volumes (`downloads_data`, `uploads_data`) — deletion immediately frees host disk space

---

## API Reference

All endpoints (except `/api/auth/register`, `/api/auth/login`, `/api/rooms/invite/:code`) require:
```
Authorization: Bearer <token>
```

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login, returns token |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/settings` | Update settings / password |
| DELETE | `/api/auth/account` | Delete account |

### Media
| Method | Path | Description |
|---|---|---|
| GET | `/api/media` | Full media library |
| GET | `/api/media/:id` | Single item |
| DELETE | `/api/media/:id` | Remove from library + delete file |
| POST | `/api/media/:id/redownload` | Re-queue torrent, delete old file |

### Downloads
| Method | Path | Description |
|---|---|---|
| GET | `/api/downloads` | List all downloads (sorted by queue order) |
| POST | `/api/downloads/preview` | Parse `.torrent`, return file list |
| POST | `/api/downloads/confirm` | Start download for selected files |
| DELETE | `/api/downloads/:id` | Cancel + remove download |
| PATCH | `/api/downloads/reorder` | Reorder queue `{ ids: string[] }` |

### Storage
| Method | Path | Description |
|---|---|---|
| GET | `/api/storage/stats` | Disk usage in bytes |

### Users
| Method | Path | Description |
|---|---|---|
| GET | `/api/users/:id/profile` | User profile (respects privacy) |
| POST | `/api/users/:id/friend` | Add friend |
| DELETE | `/api/users/:id/friend` | Remove friend |

### Admin (requires admin account)
| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/files` | List all files in DOWNLOADS_DIR with orphan flags |
| DELETE | `/api/admin/files` | Delete file by path `{ filePath: string }` |

### Rooms
| Method | Path | Description |
|---|---|---|
| GET | `/api/rooms/invite/:code` | Room preview for invite link (public) |

---

## Socket.IO Events

### Client → Server
| Event | Description |
|---|---|
| `room:create` | Create a new hall |
| `room:join` | Join an existing hall |
| `room:leave` | Leave hall |
| `room:play/pause/seek` | Leader playback control |
| `room:audio/subs/quality` | Leader track/quality selection |
| `room:heartbeat` | Leader sync pulse |
| `room:message` | Send chat message |
| `room:reaction` | Send emoji reaction |
| `room:settings` | Update hall settings |
| `room:kick` | Kick a viewer |
| `room:delete_message` | Delete a chat message |
| `room:whisper` | Private message to a seat |
| `room:transfer_leader` | Transfer leadership |

### Server → Client
| Event | Description |
|---|---|
| `room:sync` | Playback state snapshot |
| `room:heartbeat` | Leader heartbeat relay |
| `room:participant_join/leave` | Participant list update |
| `room:message` | New chat message |
| `room:reaction` | Emoji reaction |
| `room:settings_updated` | Settings changed |
| `room:kicked` | You were kicked |
| `room:message_deleted` | Message removed |
| `room:whisper` | Incoming whisper |
| `media:updated` | Media library changed |
| `downloads:update` | Download list changed |

---

## Project Structure

```
Noctiviem/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── prisma/
│   │   └── schema.prisma          ← DB models (User, MediaItem, Download, WatchHistory, Friendship)
│   └── src/
│       ├── index.ts               ← Express app, all HTTP routes, Socket.IO handlers
│       ├── auth.ts                ← Register, login, JWT, profiles, friends, watch history
│       ├── downloads.ts           ← WebTorrent queue, concurrency control, reordering
│       ├── roomManager.ts         ← In-memory room state, leader logic
│       ├── db.ts                  ← Prisma client singleton
│       └── types.ts               ← Shared backend types
└── frontend/
    └── src/
        ├── pages/
        │   ├── Dashboard.tsx      ← Media library + download cards + halls
        │   ├── Room.tsx           ← Cinema hall page
        │   ├── Join.tsx           ← Invite link landing
        │   ├── Settings.tsx       ← Account settings
        │   ├── Login.tsx
        │   ├── Register.tsx
        │   └── AdminPanel.tsx     ← Filesystem browser (admin only)
        ├── components/
        │   ├── VideoPlayer.tsx    ← Custom HTML5 player
        │   ├── CinemaHall.tsx     ← Seat grid, avatars, reactions
        │   ├── Chat.tsx           ← Chat sidebar
        │   ├── LeaderPanel.tsx    ← Leader controls sidebar
        │   ├── MediaCard.tsx      ← Library film card
        │   ├── DownloadingCard.tsx← In-progress download card (grayscale→color reveal)
        │   ├── DownloadsPanel.tsx ← Downloads panel with drag-and-drop queue
        │   ├── ProfileModal.tsx   ← User profile overlay
        │   ├── ImportModal.tsx    ← Torrent upload + file selection
        │   ├── CreateRoomModal.tsx
        │   ├── RoomCard.tsx
        │   ├── Navbar.tsx
        │   └── AuthGuard.tsx
        ├── store.ts               ← Zustand global state + fetch helpers
        ├── socket.ts              ← Socket.IO client singleton
        ├── types.ts               ← Shared frontend types
        ├── i18n.ts                ← RU/EN translations
        └── index.css              ← Cinematic dark theme (CSS variables + utilities)
```

---

## Database Schema

```
User              — accounts, settings, privacy flag
WatchHistory      — per-user watch log (title, room, timestamp)
Friendship        — bidirectional friend links
MediaItem         — media library entries (audio/subtitle tracks, videoUrl, status)
Download          — torrent queue (progress, files, sortOrder, mediaIds)
```

Schema is applied via `prisma db push` on container start (no migration files needed).
