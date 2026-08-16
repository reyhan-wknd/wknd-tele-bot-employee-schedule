# Image backend bot (Express + Telegraf + scheduler in-process).
#
# Build context-nya ROOT repo, bukan folder backend/ — dua alasan:
#   1. package-lock.json cuma ada di root; backend/ adalah npm workspace.
#   2. src/index.ts menyajikan frontend dari path.join(__dirname, '../../frontend'),
#      jadi layout repo harus dicerminkan di image: /app/backend/src dan /app/frontend.
#
# Build:  docker build -f backend/Dockerfile .
FROM node:22-slim

# Prisma butuh openssl untuk memuat query engine; image slim tidak membawanya.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency dulu supaya layer ini ter-cache selama lockfile tidak berubah.
# devDependencies IKUT dipasang: tsx, prisma, dan prisma/config semuanya dipakai saat runtime.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci

WORKDIR /app/backend

# Generate client Prisma di dalam image supaya engine-nya cocok dengan platform image ini,
# bukan warisan hasil generate di mesin developer (lihat .dockerignore).
# DATABASE_URL palsu hanya untuk memuaskan prisma.config.ts — generate tidak menyentuh database.
COPY backend/prisma ./prisma
COPY backend/prisma.config.ts ./
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY frontend /app/frontend

ENV NODE_ENV=production
EXPOSE 3000

# Dijalankan lewat tsx, bukan `npm start` (node dist/index.js): tsc mengompilasi
# src/generated/prisma/*.ts tapi tidak menyalin file engine .so.node ke dist/.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/index.ts"]
