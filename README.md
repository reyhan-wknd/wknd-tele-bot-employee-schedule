# Telegram Bot Google SSO Identity Linker

Menghubungkan identitas Telegram user dengan akun Google melalui OAuth 2.0 menggunakan Telegram Mini App. Dilengkapi fitur absensi dan jadwal WFO.

## Tech Stack

- **Backend:** TypeScript, Express, Telegraf, Prisma
- **Frontend:** Plain HTML + Vanilla JS (Telegram Mini App)
- **Database:** MySQL
- **Tunnel:** Cloudflare Tunnel (named tunnel)
- **Data Source:** Supabase (jadwal WFO)

## Features

### Google SSO
- `/login` — verifikasi akun Google via Mini App
- `/logout` — hapus koneksi akun
- `/status` — cek status verifikasi + absensi hari ini

### Absensi
- `/check_in` — absen masuk (min. jam 08:00 WIB, hari kerja, bukan cuti)
- `/check_out` — absen pulang (min. jam 18:00 WIB, min. 8 jam setelah check-in)
- Deteksi cuti otomatis dari Google Calendar (event outOfOffice / keyword)
- Reminder check-in (09:30, 09:50) dan check-out (18:00, 21:00, 23:00)

### Jadwal WFO
- `/schedule` — lihat jadwal WFO minggu ini + minggu depan (Minggu–Sabtu)
- Auto-pairing user dengan data employee (via nama email atau NIK)
- Data di-sync dari Supabase setiap hari jam 20:00 WIB
- Reminder WFO besok (Senin-Kamis jam 21:00)
- Reminder jadwal minggu depan (Jumat jam 21:00)

### Token Management
- Cek validitas Google token setiap hari kerja jam 08:00 WIB
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

1. Buat project baru di [Google Cloud Console](https://console.cloud.google.com)
2. Enable "Google Identity" API
3. Buat OAuth 2.0 Client ID (Web application)
4. Tambahkan Authorized redirect URI: `https://your-domain.com/auth/google/callback`
5. Tambahkan scope: `openid`, `email`, `profile`, `calendar.events.readonly`
6. Tambahkan test user di OAuth consent screen (selama app masih "Testing")

### 4. Telegram Bot

1. Buat bot via @BotFather
2. Bot akan menampilkan Mini App via inline keyboard saat `/login`

### 5. Cloudflare Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create <tunnel-name>
cloudflared tunnel route dns <tunnel-name> <subdomain.your-domain.com>
```

Buat config di `~/.cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_ID>
credentials-file: ~/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: <subdomain.your-domain.com>
    service: http://localhost:3000
  - service: http_status:404
```

Jalankan tunnel:
```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

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

### 7. Install & Run

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
```

Development (foreground, auto-reload):
```bash
npm run dev
```

Background (dikelola systemd, auto-restart):
```bash
systemctl --user start wknd-tele-bot
```

### 8. Frontend

Backend sudah serve folder `frontend/` sebagai static files. Pastikan `BACKEND_URL` di `frontend/index.html` sesuai dengan domain tunnel.

### 9. Cron Jobs

Semua cron job berjalan **otomatis di dalam proses backend** via `node-cron` (dikelola `backend/src/scheduler.ts`). Tidak perlu setup crontab manual.

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
7. Backend simpan mapping telegram_id ↔ google_email
8. Bot kirim pesan konfirmasi + auto-trigger schedule pairing
9. Mini App auto-close

### Schedule Pairing
1. Sistem baca nama dari email, cari di table schedules
2. Jika ditemukan 1 → konfirmasi via button
3. Jika ditemukan > 1 → pilih via button
4. Jika tidak ditemukan → fallback cari via NIK
5. Setelah paired, otomatis tampilkan jadwal WFO

## Project Structure

```
├── README.md
├── docker-compose.yml
├── package.json
├── backend/
│   ├── .env.example
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── index.ts              # Express server entry
│       ├── bot.ts                # Telegraf bot + commands
│       ├── scheduler.ts          # node-cron job registration
│       ├── db.ts                 # Prisma client
│       ├── routes/
│       │   └── auth.ts           # OAuth endpoints
│       ├── services/
│       │   ├── calendar.ts       # Google Calendar cuti detection
│       │   ├── schedule.ts       # Schedule pairing logic
│       │   └── supabase.ts       # Supabase data fetch
│       └── cron/
│           ├── check-tokens.ts   # Token validity check
│           ├── reminder.ts       # Attendance reminders
│           ├── reminder-wfo.ts   # WFO reminders
│           └── sync-schedules.ts # Supabase → MySQL sync
└── frontend/
    ├── index.html                # Mini App (OAuth trigger)
    └── success.html              # Post-login success page
```
