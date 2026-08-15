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
| `ALLOWED_EMAIL_DOMAINS` | Domain email yang boleh login, pisahkan koma (default: `weekendinc.com`) |
| `TOKEN_ENCRYPTION_KEY` | Kunci enkripsi token OAuth di database, 32 byte base64 (wajib) |
| `AUTH_RATE_LIMIT` | Batas permintaan /auth per menit per IP (default: 10) |

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

Background (tanpa watch):
```bash
nohup npx tsx src/index.ts > nohup.out 2>&1 &
```

### 8. Frontend

Backend sudah serve folder `frontend/` sebagai static files, dan Mini App memanggil backend lewat `window.location.origin` — tidak ada URL yang perlu disesuaikan.

### 9. Cron Jobs

```bash
crontab backend/crontab.txt
```

Pastikan folder `backend/logs/` sudah dibuat:
```bash
mkdir -p backend/logs
```

Jam di `crontab.txt` ditulis dalam WIB dan dikunci lewat `CRON_TZ=Asia/Jakarta`, jadi
jadwalnya sama saja apakah mesin deploy berjalan di UTC atau WIB. Kode aplikasinya
sendiri juga tidak bergantung pada TZ host — semua perhitungan waktu lewat
`src/lib/time.ts`.

#### Daftar Cron Jobs

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
├── docker-compose.yml
├── package.json
├── backend/
│   ├── .env.example
│   ├── crontab.txt
│   ├── prisma/
│   │   └── schema.prisma
│   ├── deploy/
│   │   └── wknd-tele-bot.service # Unit systemd (Restart=always)
│   ├── scripts/
│   │   └── dump-db.sh            # Dump DB tanpa data tabel users
│   └── src/
│       ├── index.ts              # Express server entry
│       ├── bot.ts                # Telegraf bot + commands
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
