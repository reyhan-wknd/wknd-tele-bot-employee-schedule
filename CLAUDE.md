# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Telegram bot that links Telegram user identities to Google accounts via OAuth 2.0, with attendance tracking and WFO (Work From Office) schedule management. The bot is a Telegram Mini App built with Express + Telegraf on the backend and plain HTML/JS on the frontend.

All times are in **WIB (Asia/Jakarta, UTC+7)**. This is enforced throughout the codebase — always use `nowWIB()` / `todayDateWIB()` helpers in `bot.ts` when dealing with time-sensitive logic.

## Development Commands

All backend commands must be run from the `backend/` directory:

```bash
cd backend

# Development (tsx watch, auto-reload)
npm run dev

# Production (requires build first)
npm run build && npm start

# Background run (no watch)
nohup npx tsx src/index.ts > nohup.out 2>&1 &

# Database
npm run db:migrate    # run pending migrations (prisma migrate dev)
npm run db:generate   # regenerate Prisma client after schema changes
```

Start the MySQL database via Docker before running the backend:
```bash
docker compose up -d   # MySQL on port 3309, DB: tele_sso, user: root/password
```

Run cron scripts manually (from `backend/`):
```bash
npx tsx src/cron/sync-schedules.ts
npx tsx src/cron/check-tokens.ts
npx tsx src/cron/reminder.ts checkin
npx tsx src/cron/reminder.ts checkout
npx tsx src/cron/reminder-wfo.ts tomorrow
npx tsx src/cron/reminder-wfo.ts weekly
```

Install cron jobs (update path in `crontab.txt` first):
```bash
mkdir -p backend/logs
crontab -e   # paste contents of backend/crontab.txt
```

## Architecture

### Request Flow

1. **Bot mode** is controlled by `BOT_MODE` env var — `polling` (dev) or `webhook` (prod). In webhook mode, the Express app registers the webhook callback path; the same Express server serves the Mini App frontend as static files from `../frontend/`.

2. **OAuth login flow**: Mini App (`frontend/index.html`) → `POST /auth/init` (validates Telegram `initData` via HMAC-SHA256, issues JWT state token) → Google OAuth → `GET /auth/google/callback` (exchanges code, upserts user, sends Telegram confirmation, triggers schedule pairing).

3. **Schedule pairing**: After login, the system extracts the user's name from their Google email (`extractNameFromEmail`), searches the local `schedules` table, and sends inline keyboard buttons for the user to confirm their employee record. This links `telegram_id` → `employee_nik` in `user_schedules`.

### Data Sources

- **MySQL** (via Prisma): users, attendances, schedules, user_schedules — local operational data
- **Supabase**: source of truth for WFO schedule data; synced nightly via `cron/sync-schedules.ts` into the local `schedules` table. The Supabase API is accessed with the anon key via raw `fetch()` (not the Supabase client SDK).

### Key Files

| File | Responsibility |
|------|---------------|
| `backend/src/index.ts` | Express server entry; mounts auth router, serves frontend static files, starts bot |
| `backend/src/bot.ts` | All Telegraf commands and callback handlers; schedule display + attendance logic |
| `backend/src/routes/auth.ts` | `POST /auth/init` and `GET /auth/google/callback` OAuth endpoints |
| `backend/src/services/calendar.ts` | Google Calendar leave detection (outOfOffice event type + keyword matching) |
| `backend/src/services/schedule.ts` | Employee name lookup, NIK lookup, user↔employee pairing |
| `backend/src/services/supabase.ts` | Fetches WFO schedule data from Supabase REST API |
| `backend/src/cron/*.ts` | Standalone scripts run by system cron (not by the Express process) |
| `backend/prisma/schema.prisma` | DB schema: User, Attendance, Schedule, UserSchedule models |
| `frontend/index.html` | Telegram Mini App — initiates OAuth; calls `/auth/init` with `initData` |
| `frontend/success.html` | Post-login redirect page that auto-closes the Mini App |

### Prisma Generated Client

The Prisma client is generated to `backend/src/generated/prisma/` (non-standard output path, set in `schema.prisma`). Run `npm run db:generate` after any schema change.

### State Management in Bot

`awaitingNik` is an in-memory `Set<number>` in `bot.ts` tracking users mid-NIK-entry flow. This is ephemeral and resets on process restart — expected behavior.

### Security Notes

- Telegram `initData` is validated using HMAC-SHA256 (HMAC key = HMAC of `"WebAppData"` with bot token), and `auth_date` must be within 5 minutes.
- OAuth state is a short-lived JWT (5-minute expiry) signed with `JWT_SECRET`.
- Auth routes have rate limiting: 10 req/min per IP.

## Environment Variables

Copy `backend/.env.example` to `backend/.env`. Required vars:

| Variable | Notes |
|----------|-------|
| `BOT_TOKEN` | From @BotFather |
| `BOT_MODE` | `polling` (dev) or `webhook` (prod) |
| `WEBHOOK_DOMAIN` | HTTPS domain (webhook mode only) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth2 credentials |
| `GOOGLE_REDIRECT_URI` | Must match Google Console; e.g. `https://domain/auth/google/callback` |
| `DATABASE_URL` | `mysql://root:password@localhost:3309/tele_sso` |
| `PORT` | Default 3000 |
| `JWT_SECRET` | For OAuth state tokens |
| `FRONTEND_URL` | HTTPS URL where the Mini App is served (same as tunnel domain) |
| `SUPABASE_KEY` | Supabase anon key |

Google OAuth must include scopes: `openid email profile https://www.googleapis.com/auth/calendar.events.readonly`. The app must be in "Testing" mode with test users added during development.
