# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20 AS builder
WORKDIR /app

# Copy workspace manifests and install all deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci

# Copy backend source + Prisma schema
COPY backend/ ./backend/

# Generate Prisma client types
RUN cd backend && npx prisma generate

# Compile TypeScript
RUN cd backend && npx tsc

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

# Prisma requires OpenSSL at runtime (not present in slim image)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy compiled JS and workspace node_modules (includes Prisma client)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist

# Prisma schema needed for db push / migrate deploy at runtime
COPY backend/prisma ./prisma

# Data directories (will be overridden by Docker volumes)
RUN mkdir -p downloads uploads

ENV NODE_ENV=production
EXPOSE 3001

# Push schema to DB (safe no-op if already in sync), then start server
CMD ["sh", "-c", "node_modules/.bin/prisma db push --schema=./prisma/schema.prisma && node dist/index.js"]
