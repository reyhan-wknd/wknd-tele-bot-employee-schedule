# Telegram Bot Google SSO Identity Linker

Menghubungkan identitas Telegram user dengan akun Google melalui OAuth 2.0 menggunakan Telegram Mini App. Dilengkapi fitur absensi dan jadwal WFO.

## Tech Stack

- **Backend:** TypeScript, Express, Telegraf, Prisma
- **Frontend:** Plain HTML + Vanilla JS (Telegram Mini App)
- **Database:** MySQL
- **Tunnel:** Cloudflare Tunnel (named tunnel)
- **Data Source:** Supabase (jadwal WFO)
- **Deploy:** Docker Compose (backend + MySQL + sidecar cloudflared)

## Features

### Google SSO
- `/login` — verifikasi akun Google via Mini App
- `/logout` — hapus koneksi akun
- `/status` — cek status verifikasi + absensi hari ini

### Absensi
- `/check_in` — absen masuk (min. jam 08:00 WIB, hari kerja, bukan cuti)
- `/check_out` — absen pulang (min. jam 18:00 WIB, min. 8 jam setelah check-in)
- Deteksi cuti otomatis dari Google Calendar: event bertipe **Out of office** — judul tidak diperiksa
- Satu event Out of office membuat hari itu terhitung cuti penuh, berapa pun durasinya
- Reminder check-in (09:30, 09:50) dan check-out (18:00, 21:00, 23:00)

### Jadwal WFO
- `/schedule` — lihat jadwal WFO minggu ini + minggu depan (Minggu–Sabtu)
- Auto-pairing user dengan data employee lewat email terverifikasi Google
- Data di-sync dari Supabase setiap hari jam 20:00 WIB
- Reminder WFO besok (Senin-Kamis jam 21:00)
- Reminder jadwal minggu depan (Jumat jam 21:00)

### Token Management
- Access & refresh token disimpan terenkripsi (AES-256-GCM) di database
- Cek token setiap hari kerja jam 08:00 WIB memakai kolom masa berlaku, tanpa memanggil Google bila token masih hidup
- Auto-refresh jika expired, hapus akun & notify user jika refresh gagal

## Setup

### 1. Prerequisites

- Node.js 18+
- Docker (untuk MySQL)
- Telegram Bot Token (dari @BotFather)
- Google OAuth2 credentials (dari Google Cloud Console)
- Cloudflare account dengan domain terdaftar

### 2. Database (Docker)

```bash
docker compose up -d
```

MySQL akan running di port `3309` dengan credentials:
- User: `root`
- Password: `password`
- Database: `tele_sso`

### 3. Google Cloud Console

1. Buat project baru di [Google Cloud Console](https://console.cloud.google.com), **di bawah organisasi Google Workspace perusahaan** — bukan dari akun Gmail pribadi
2. Enable **Google Calendar API** (hanya itu; `openid email profile` tidak butuh API terpisah karena ID token diverifikasi lokal)
3. OAuth consent screen → **User type: Internal**
4. Tambahkan scope: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/calendar.events.readonly`
5. Buat OAuth 2.0 Client ID (Web application)
6. Tambahkan Authorized redirect URI: `https://your-domain.com/auth/google/callback`

Dengan **Internal**, semua akun di organisasi bisa login tanpa didaftarkan satu per satu,
tidak ada verifikasi Google meski scope Calendar tergolong sensitive, dan refresh token
tidak kedaluwarsa tiap 7 hari seperti pada status "Testing".

Internal hanya tersedia bila project-nya **milik organisasi**. Menjadikan akun kantor
sebagai IAM Owner di project pribadi tidak cukup — induk project-nya yang menentukan.

### 4. Telegram Bot

1. Buat bot via @BotFather
2. Bot akan menampilkan Mini App via inline keyboard saat `/login`

### 5. Cloudflare Tunnel

Sekali saja, untuk membuat tunnel dan DNS record-nya:

```bash
cloudflared tunnel login
cloudflared tunnel create <tunnel-name>
cloudflared tunnel route dns <tunnel-name> <subdomain.your-domain.com>
```

Di **produksi**, connector-nya berjalan sebagai container sidecar dalam compose stack —
confignya ada di `deploy/cloudflared.prod.yml` dan tidak perlu dijalankan manual
(lihat bagian Deploy Produksi di bawah).

Untuk menjalankan manual saat **development**, buat config di `~/.cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: <subdomain.your-domain.com>
    service: http://localhost:3000   # samakan dengan PORT backend
  - service: http_status:404
```

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

> Jangan menjalankan dua connector untuk satu tunnel. Cloudflare akan membagi trafik ke
> dua backend, sehingga update webhook masuk separuh-separuh ke masing-masing.

### 6. Environment Variables

```bash
cp backend/.env.example backend/.env
```

Isi variabel berikut:
| Variable | Keterangan |
|----------|-----------|
| `BOT_TOKEN` | Token dari @BotFather |
| `BOT_MODE` | `polling` (dev) atau `webhook` (prod) |
| `WEBHOOK_DOMAIN` | Domain HTTPS (untuk mode webhook) |
| `GOOGLE_CLIENT_ID` | Dari Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Dari Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://<domain>/auth/google/callback` |
| `DATABASE_URL` | `mysql://root:password@localhost:3309/tele_sso` |
| `PORT` | Port backend (default: 3000) |
| `JWT_SECRET` | Secret untuk sign state token |
| `FRONTEND_URL` | URL HTTPS domain (sama dengan tunnel) |
| `SUPABASE_KEY` | Supabase anon key untuk fetch jadwal |
| `ALLOWED_EMAIL_DOMAINS` | Domain email yang boleh login, pisahkan koma (default: `weekendinc.com`) |
| `TOKEN_ENCRYPTION_KEY` | Kunci enkripsi token OAuth di database, 32 byte base64 (wajib) |
| `AUTH_RATE_LIMIT` | Batas permintaan /auth per menit per IP (default: 10) |

### 7. Install & Run (development)

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run dev          # foreground, auto-reload
```

> Jangan pakai `npm run build && npm start`. `tsc` mengompilasi
> `src/generated/prisma/*.ts` ke `dist/`, tapi **tidak** ikut menyalin binary query
> engine Prisma (`libquery_engine-*.so.node`) di sebelahnya, jadi `dist/index.js` gagal
> saat runtime. Jalankan lewat `tsx` — itu yang dipakai `npm run dev` maupun container
> produksi.

Untuk deploy produksi, lihat bagian **Deploy Produksi** di bawah.

### 8. Frontend

Backend sudah serve folder `frontend/` sebagai static files, dan Mini App memanggil backend lewat `window.location.origin` — tidak ada URL yang perlu disesuaikan.

### 9. Cron Jobs

Semua cron job berjalan **otomatis di dalam proses backend** via `node-cron`
(`backend/src/scheduler.ts`), dengan `timezone: 'Asia/Jakarta'`. Tidak perlu memasang
crontab sama sekali.

Perhitungan waktu di dalam kode juga tidak bergantung pada zona waktu mesin — semuanya
lewat `src/lib/time.ts`, jadi hasilnya sama di host UTC maupun WIB.

Tiap job masih bisa dijalankan manual bila perlu, misalnya untuk memaksa sync:

```bash
cd backend
npx tsx src/cron/sync-schedules.ts
npx tsx src/cron/reminder.ts checkin
npx tsx src/cron/reminder-wfo.ts weekly
```

#### Daftar Job

| Waktu (WIB) | Hari | Fungsi |
|---|---|---|
| 08:00 | Senin-Jumat | Cek validitas Google token |
| 09:30 | Senin-Jumat | Reminder check-in (1) |
| 09:50 | Senin-Jumat | Reminder check-in (2) |
| 18:00 | Senin-Jumat | Reminder check-out (1) |
| 20:00 | Setiap hari | Sync jadwal dari Supabase |
| 21:00 | Senin-Jumat | Reminder check-out (2) |
| 21:00 | Senin-Kamis | Reminder WFO besok |
| 21:00 | Jumat | Reminder jadwal WFO minggu depan |
| 23:00 | Senin-Jumat | Reminder check-out (3) |

## Deploy Produksi

Produksi berjalan di **nas-server** sebagai satu Docker Compose stack: MySQL + backend +
sidecar `cloudflared`, semuanya `restart: unless-stopped`. Tahan reboot lewat docker
daemon, jadi tidak ada systemd unit maupun crontab yang perlu dipasang.

```bash
cd ~/apps/wknd-tele-bot
docker compose -f docker-compose.prod.yml up -d --build
```

| Lokasi | Isi |
|---|---|
| `~/apps/wknd-tele-bot/` | clone repo ini |
| `~/apps/wknd-tele-bot/.env` | variabel compose — port, nama volume, password MySQL, path cloudflared (contoh: `deploy/prod.compose.env.example`) |
| `~/.config/wknd-tele-bot/backend.env` | rahasia aplikasi, **di luar repo**, ditunjuk oleh `BACKEND_ENV_FILE` |
| `~/.cloudflared/<tunnel-id>.json` | kredensial tunnel, mode 0600 |

Backend hanya bind ke `127.0.0.1` untuk health check dan debug; trafik publik masuk lewat
sidecar cloudflared yang menghubungi backend dengan nama service compose, bukan localhost.
MySQL tidak membuka port host sama sekali.

### Hal yang mudah menjebak

- **Mengubah `backend.env` saja tidak berpengaruh.** Nilai `env_file` dibaca saat container
  dibuat, jadi `docker compose restart` tetap memakai nilai lama. Pakai:
  ```bash
  docker compose -f docker-compose.prod.yml up -d --force-recreate backend
  ```
- **Build context-nya root repo, bukan `backend/`.** `package-lock.json` cuma ada di root
  (`backend` adalah npm workspace), dan `index.ts` menyajikan frontend dari `../../frontend`,
  jadi image harus mencerminkan layout repo: `/app/backend` + `/app/frontend`.
- **`user:` container cloudflared harus sama dengan pemilik file kredensial**
  (`CLOUDFLARED_USER`), kalau tidak file 0600-nya tidak terbaca.
- Image memakai `node:22-slim` + `openssl` karena generator `prisma-client` memakai engine
  glibc `debian-openssl-3.0.x`; Alpine butuh varian musl.

### Migrasi database

`docker compose` menjalankan `prisma migrate deploy` otomatis setiap container backend
start, jadi migrasi tidak perlu dijalankan terpisah.

## Bot Modes

- **Polling** (default): Set `BOT_MODE=polling` — cocok untuk development
- **Webhook**: Set `BOT_MODE=webhook` dan `WEBHOOK_DOMAIN=https://your-domain.com` — untuk production

## Flow

### Login
1. User kirim `/login` ke bot
2. Bot tampilkan tombol "Verifikasi Akun" (Mini App)
3. Mini App terbuka, kirim initData ke backend untuk validasi
4. Backend return Google OAuth URL
5. User login Google, consent
6. Google redirect ke backend callback
7. Backend cek domain email — hanya `ALLOWED_EMAIL_DOMAINS` yang diterima
8. Backend simpan mapping telegram_id ↔ google_email
9. Bot kirim pesan konfirmasi + auto-pairing data karyawan
10. Mini App auto-close

### Schedule Pairing
1. Backend mencari karyawan di tabel `employees` Supabase dengan email yang sama persis
2. Ketemu → NIK-nya langsung disimpan, tanpa konfirmasi ke user
3. Tidak ketemu → user diminta menghubungi admin; `/schedule` akan mencoba lagi

Identitas ditentukan sepenuhnya oleh email yang tanda tangannya diverifikasi Google.
User tidak pernah memilih atau mengetik NIK, sehingga tidak ada NIK yang bisa dipaksakan
dari sisi klien.

## Project Structure

```
├── README.md
├── docker-compose.yml            # MySQL untuk development
├── docker-compose.prod.yml       # Stack produksi: MySQL + backend + cloudflared
├── .dockerignore
├── package.json
├── deploy/
│   ├── cloudflared.prod.yml      # Ingress tunnel -> service `backend`
│   └── prod.compose.env.example  # Contoh .env compose di mesin deploy
├── backend/
│   ├── .env.example
│   ├── Dockerfile                # Build context-nya ROOT repo, bukan backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── deploy/
│   │   └── wknd-tele-bot.service # Unit systemd — jalur non-Docker (opsional)
│   ├── scripts/
│   │   └── dump-db.sh            # Dump DB tanpa data tabel users
│   └── src/
│       ├── index.ts              # Express server entry
│       ├── bot.ts                # Telegraf bot + commands
│       ├── scheduler.ts          # node-cron job registration
│       ├── db.ts                 # Prisma client
│       ├── config.ts             # Domain email yang diizinkan
│       ├── lib/
│       │   ├── crypto.ts         # Enkripsi token OAuth
│       │   ├── schedule.ts       # Pengelompokan jadwal per tanggal
│       │   ├── sync-guard.ts     # Penjaga kewarasan hasil sync
│       │   ├── telegram.ts       # Klien Telegram + pengiriman massal
│       │   ├── time.ts           # Semua perhitungan waktu WIB
│       │   └── token.ts          # Masa berlaku access token
│       ├── routes/
│       │   └── auth.ts           # OAuth endpoints
│       ├── services/
│       │   ├── attendance.ts     # Aturan check-in/check-out
│       │   ├── calendar.ts       # Google Calendar cuti detection
│       │   ├── schedule.ts       # Schedule pairing logic
│       │   ├── supabase.ts       # Supabase data fetch
│       │   └── user.ts           # Hapus tautan akun + revoke token
│       └── cron/
│           ├── check-tokens.ts   # Token validity check
│           ├── reminder.ts       # Attendance reminders
│           ├── reminder-wfo.ts   # WFO reminders
│           └── sync-schedules.ts # Supabase → MySQL sync
└── frontend/
    ├── index.html                # Mini App (OAuth trigger)
    └── success.html              # Post-login success page
```
