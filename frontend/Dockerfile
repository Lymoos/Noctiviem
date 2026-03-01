# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests and install
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci

# Copy frontend source and build
COPY frontend/ ./frontend/
RUN npm run build --workspace=frontend

# ── Production stage (nginx) ──────────────────────────────────────────────────
FROM nginx:stable-alpine
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
