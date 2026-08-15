# Deploy ke Mesin Baru

## Prerequisites

- Node.js 18+
- Docker
- `cloudflared` binary

## Steps

### 1. Clone & Install

```bash
git clone git@github.com:reyhan-wknd/wknd-tele-bot-employee-schedule.git
cd wknd-tele-bot-employee-schedule/backend
npm install
```

### 2. MySQL (Docker)

```bash
cd wknd-tele-bot-employee-schedule
docker compose up -d
```

### 3. Import Database

Di mesin **lama**, buat dump lalu kirim langsung ke mesin baru — jangan pernah menaruhnya di dalam folder repo:

```bash
backend/scripts/dump-db.sh                       # hasil: ~/backups/wknd-tele-bot/tele_sso-<tanggal>.sql
scp ~/backups/wknd-tele-bot/tele_sso-*.sql <mesin-baru>:~/backups/wknd-tele-bot/
```

Di mesin **baru**:

```bash
mysql -h 127.0.0.1 -P 3309 -u root -ppassword tele_sso < ~/backups/wknd-tele-bot/tele_sso-<tanggal>.sql
```

Dump sengaja tidak memuat data tabel `users` (di situ tersimpan access & refresh token Google) —
hanya strukturnya. Setelah backend hidup, tiap orang cukup `/login` sekali; data absensi dan
pairing jadwal lama tetap nyambung lewat `telegram_id`.

### 4. Environment

```bash
cp backend/.env.example backend/.env
# Isi semua credentials
```

### 5. Prisma

```bash
cd backend
npx prisma generate
```

### 6. Cloudflare Tunnel

Copy file berikut dari mesin lama:
- `~/.cloudflared/cert.pem`
- `~/.cloudflared/472d3a03-d2e7-41f1-8662-7e9df72179bb.json`
- `~/.cloudflared/config-wknd.yml`

Jalankan:
```bash
cloudflared tunnel --config ~/.cloudflared/config-wknd.yml run
```

### 7. Start Backend

```bash
cd backend
nohup npx tsx src/index.ts > nohup.out 2>&1 &
```

### 8. Install Cron

```bash
mkdir -p backend/logs
crontab backend/crontab.txt
```

## File yang Perlu Dipindahkan (Tidak di Repo)

Semuanya rahasia: kirim langsung antar mesin dengan `scp`, jangan lewat folder repo.

| File | Keterangan |
|------|-----------|
| `~/backups/wknd-tele-bot/tele_sso-*.sql` | Database dump (tanpa data tabel `users`), dibuat oleh `backend/scripts/dump-db.sh` |
| `backend/.env` | Credentials |
| `~/.cloudflared/cert.pem` | Cloudflare origin cert |
| `~/.cloudflared/472d3a03-*.json` | Tunnel credentials |
| `~/.cloudflared/config-wknd.yml` | Tunnel config |
