# Telegram Bot Google SSO Identity Linker

Menghubungkan identitas Telegram user dengan akun Google melalui OAuth 2.0 menggunakan Telegram Mini App. Dilengkapi fitur absensi dan jadwal WFO.

## Tech Stack

- **Backend:** TypeScript, Express, Telegraf, Prisma
- **Frontend:** Plain HTML + Vanilla JS (Telegram Mini App)
- **Database:** MySQL

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
- `/schedule` — lihat jadwal WFO minggu ini + minggu depan
- Auto-pairing user dengan data employee (via nama email atau NIK)
- Data di-sync dari Supabase setiap hari jam 20:00 WIB
- Reminder WFO besok (Senin-Kamis jam 21:00)
- Reminder jadwal minggu depan (Jumat jam 21:00)

## Setup

### 1. Prerequisites

- Node.js 18+
- MySQL database
- Telegram Bot Token (dari @BotFather)
- Google OAuth2 credentials (dari Google Cloud Console)

### 2. Google Cloud Console

1. Buat project baru di [Google Cloud Console](https://console.cloud.google.com)
2. Enable "Google Identity" API
3. Buat OAuth 2.0 Client ID (Web application)
4. Tambahkan Authorized redirect URI: `https://your-domain.com/auth/google/callback`
5. Tambahkan scope: `openid`, `email`, `profile`, `calendar.events.readonly`

### 3. Telegram Bot

1. Buat bot via @BotFather
2. Set Web App URL via @BotFather → `/setmenubutton` atau langsung via inline keyboard

### 4. Environment Variables

```bash
cp backend/.env.example backend/.env
# Edit backend/.env dengan credentials Anda
```

### 5. Install & Run

```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
```

### 6. Frontend

Host folder `frontend/` di static file server atau biarkan backend serve static files.

Ganti `BACKEND_URL` di `frontend/index.html` dengan URL backend/tunnel Anda.

### 7. Cron Jobs

```bash
crontab -e
# Paste isi dari backend/crontab.txt
```

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
8. Bot kirim pesan konfirmasi, Mini App auto-close

### Schedule Pairing
1. User kirim `/schedule`
2. Sistem baca nama dari email, cari di table schedules
3. Jika ditemukan → konfirmasi via button
4. Jika tidak → fallback cari via NIK
5. Setelah paired, tampilkan jadwal WFO
