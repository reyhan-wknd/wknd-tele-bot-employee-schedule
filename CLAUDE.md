# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Telegram bot that links Telegram user identities to Google accounts via OAuth 2.0, with attendance tracking and WFO (Work From Office) schedule management. The bot is a Telegram Mini App built with Express + Telegraf on the backend and plain HTML/JS on the frontend.

All times are in **WIB (Asia/Jakarta, UTC+7)**, and this does not depend on the host's timezone — every time calculation goes through `backend/src/lib/time.ts` (`wibClock`, `todayWIB`, `hourWIB`, `weekdayWIB`, `wibDayBounds`, `formatTimeWIB`, …). Use those helpers rather than `new Date()` arithmetic; the result must be identical on a UTC host and a WIB host.

## Development Commands

All backend commands must be run from the `backend/` directory:

```bash
cd backend

# Development (tsx watch, auto-reload)
npm run dev

# Tests
npm test

# Database
npm run db:migrate    # run pending migrations (prisma migrate dev)
npm run db:generate   # regenerate Prisma client after schema changes
```

Start the MySQL database via Docker before running the backend:
```bash
docker compose up -d   # MySQL on port 3309, DB: tele_sso, user: root/password
```

> **Do not use `npm run build && npm start` to run this app.** `tsc` compiles
> `src/generated/prisma/*.ts` into `dist/`, but does not copy the Prisma query engine
> binary (`libquery_engine-*.so.node`) that sits alongside it, so `dist/index.js` fails
> at runtime. Run through `tsx` instead — that is what both `npm run dev` and the
> production container do.

Cron jobs are **not** installed into the system crontab. They run in-process via
`node-cron` in `backend/src/scheduler.ts` (9 jobs, all pinned to `timezone: 'Asia/Jakarta'`).
Each one can still be invoked manually:

```bash
npx tsx src/cron/sync-schedules.ts
npx tsx src/cron/check-tokens.ts
npx tsx src/cron/reminder.ts checkin
npx tsx src/cron/reminder.ts checkout
npx tsx src/cron/reminder-wfo.ts tomorrow
npx tsx src/cron/reminder-wfo.ts weekly
```

## Architecture

### Request Flow

1. **Bot mode** is controlled by `BOT_MODE` env var — `polling` (dev) or `webhook` (prod). In webhook mode, the Express app registers the webhook callback path; the same Express server serves the Mini App frontend as static files from `../frontend/`.

2. **OAuth login flow**: Mini App (`frontend/index.html`) → `POST /auth/init` (validates Telegram `initData` via HMAC-SHA256, issues JWT state token) → Google OAuth → `GET /auth/google/callback` (exchanges code, verifies the ID token, enforces the email-domain gate, upserts user, sends Telegram confirmation, triggers schedule pairing).

3. **Schedule pairing**: identity comes entirely from the Google-verified email. `pairUserByEmail` (`services/schedule.ts`) looks for an employee whose email matches exactly and stores that NIK in `user_schedules`. There is no user-facing NIK entry or confirmation step — the user can never influence which employee record they are bound to. If no employee matches, the user is told to contact an admin and `/schedule` retries the pairing later.

### Hari Libur

Holidays are held in the `holidays` table and managed by hand through `/manage_holiday`,
because no automatic source is trustworthy enough on its own.

- **`year = 0` means "every year"**, any other value means that year only. NULL is
  deliberately *not* used for this: MySQL treats each NULL as distinct inside a unique
  index, so two recurring `08-17` rows would both slip past `@@unique([year, month, day])`.
- Most Indonesian public holidays move each year (Idul Fitri, Nyepi, Waisak, Imlek), and
  *cuti bersama* are decreed annually — those are stored as one-off rows. Only the five
  genuinely fixed dates are recurring.
- **Emptiness is never treated as a holiday signal.** An earlier design inferred holidays
  from a missing `schedules` row; that was wrong because `schedules` is the *WFO* roster —
  a working day where everyone is WFH looks identical to a public holiday, as does a week
  the upstream has not published yet.
- `services/holiday.ts` loads the whole table and matches in memory. The row count is tiny
  (a dozen or two per year), and it keeps the recurring rule expressed once in
  `lib/holiday.ts` instead of being restated as SQL.
- Reminders skip holidays; `/check_in` does not, but asks for confirmation via an inline
  button first. That button carries its date in `callback_data` and refuses to fire once
  the day has rolled over.

### Data Sources

- **MySQL** (via Prisma): users, attendances, schedules, user_schedules — local operational data
- **Supabase**: source of truth for WFO schedule data; synced nightly (20:00 WIB) via `cron/sync-schedules.ts` into the local `schedules` table. The Supabase API is accessed with the anon key via raw `fetch()` (not the Supabase client SDK). `lib/sync-guard.ts` aborts the sync if the fetched set is empty or collapses, so a bad upstream response cannot wipe the local table.

### Key Files

| File | Responsibility |
|------|---------------|
| `backend/src/index.ts` | Express server entry; mounts auth router, serves frontend static files, starts bot + scheduler |
| `backend/src/bot.ts` | All Telegraf commands and callback handlers; schedule display + attendance logic |
| `backend/src/scheduler.ts` | Registers all 9 cron jobs in-process with `node-cron` |
| `backend/src/routes/auth.ts` | `POST /auth/init` and `GET /auth/google/callback` OAuth endpoints |
| `backend/src/config.ts` | `ALLOWED_EMAIL_DOMAINS` / `ADMIN_TELEGRAM_IDS` parsing and the `isAllowedEmail` / `isAdmin` gates |
| `backend/src/lib/holiday.ts` | Holiday rules: date/command parsing, recurring-vs-one-off matching, the 365-day projection |
| `backend/src/services/holiday.ts` | Holiday table access; loads all rows and matches in memory |
| `backend/src/scripts/seed-holidays.ts` | Seeds holidays from Google's public Indonesian holiday ICS |
| `backend/src/lib/time.ts` | Every WIB time calculation; host-timezone independent |
| `backend/src/lib/crypto.ts` | AES-256-GCM encryption of OAuth tokens at rest |
| `backend/src/services/calendar.ts` | Leave detection — an event counts as leave only when `eventType === 'outOfOffice'`; titles are never inspected |
| `backend/src/services/schedule.ts` | Employee lookup by email and user↔employee pairing |
| `backend/src/services/supabase.ts` | Fetches WFO schedule data from Supabase REST API |
| `backend/src/cron/*.ts` | Job bodies; invoked by `scheduler.ts` in-process, and runnable standalone via `tsx` |
| `backend/prisma/schema.prisma` | DB schema: User, Attendance, Schedule, UserSchedule models |
| `frontend/index.html` | Telegram Mini App — initiates OAuth; calls `/auth/init` with `initData` |
| `frontend/success.html` | Post-login redirect page that auto-closes the Mini App |

### Prisma Generated Client

The Prisma client is generated to `backend/src/generated/prisma/` (non-standard output path, set in `schema.prisma`) using the `prisma-client` generator, which emits **TypeScript** plus a platform-specific query engine binary. Run `npm run db:generate` after any schema change. The generated directory is in `.dockerignore` — the image regenerates it so the engine matches the image platform, not the developer's machine.

### Security Notes

- Telegram `initData` is validated using HMAC-SHA256 (HMAC key = HMAC of `"WebAppData"` with bot token), and `auth_date` must be within 5 minutes.
- OAuth state is a short-lived JWT (5-minute expiry) signed with `JWT_SECRET`.
- Auth routes are rate limited (`AUTH_RATE_LIMIT`, default 10 req/min per IP).
- Only emails whose domain is in `ALLOWED_EMAIL_DOMAINS` may link. The check reads the email from the signature-verified ID token, not the `hd` URL parameter, and runs before the user is persisted so an outside account's tokens are never stored.
- The webhook path and Telegram `secret_token` are HMAC derivations of `BOT_TOKEN`, so the token never appears in logs and the path is stable across hosts.
- Google access/refresh tokens are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) before being written to the database.

## Environment Variables

Copy `backend/.env.example` to `backend/.env`. Required vars:

| Variable | Notes |
|----------|-------|
| `BOT_TOKEN` | From @BotFather |
| `BOT_MODE` | `polling` (dev) or `webhook` (prod) |
| `WEBHOOK_DOMAIN` | HTTPS domain (webhook mode only) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth2 credentials |
| `GOOGLE_REDIRECT_URI` | Must match Google Console; e.g. `https://domain/auth/google/callback` |
| `DATABASE_URL` | dev: `mysql://root:password@localhost:3309/tele_sso` — prod: host is the compose service name `mysql` |
| `PORT` | Default 3000 |
| `JWT_SECRET` | For OAuth state tokens |
| `FRONTEND_URL` | HTTPS URL where the Mini App is served (same as tunnel domain) |
| `SUPABASE_KEY` | Supabase anon key |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated; defaults to `weekendinc.com` |
| `TOKEN_ENCRYPTION_KEY` | **Required.** 32 bytes base64; the process refuses to start without it |
| `AUTH_RATE_LIMIT` | Optional; `/auth` requests per minute per IP (default 10) |
| `ADMIN_TELEGRAM_IDS` | Comma-separated Telegram IDs allowed to run `/manage_holiday`. Empty means nobody is admin, not everybody |

Google OAuth must include scopes `openid email profile https://www.googleapis.com/auth/calendar.events.readonly`, and only the **Google Calendar API** needs enabling in the project — OIDC needs no separate API because the ID token is verified locally.

The OAuth consent screen is configured as **User type: Internal** under the weekendinc.com Google Workspace organization. That means every account in the org can log in with no test-user list, no Google verification despite the sensitive Calendar scope, and no 7-day refresh-token expiry. Internal requires the GCP project to belong to the organization — making an office account an IAM Owner of a personal project is *not* sufficient.

## Deployment

Production runs on **nas-server** (Tailscale) under the `claudeagent` user, as a Docker Compose stack: MySQL + backend + a `cloudflared` sidecar, all `restart: unless-stopped`.

```bash
cd ~/apps/wknd-tele-bot
docker compose -f docker-compose.prod.yml up -d --build
```

| Path | Contents |
|------|----------|
| `~/apps/wknd-tele-bot/` | git clone of this repo |
| `~/apps/wknd-tele-bot/.env` | compose variables (ports, volume, MySQL password, cloudflared paths) |
| `~/.config/wknd-tele-bot/backend.env` | app secrets, **outside the repo**, referenced by `BACKEND_ENV_FILE` |
| `~/.cloudflared/<tunnel-id>.json` | tunnel credentials, mode 0600 |

Things that bite when changing this:

- **The Docker build context is the repo root, not `backend/`.** `package-lock.json` only exists at the root (`backend` is an npm workspace), and `index.ts` serves the frontend from `../../frontend`, so the image must mirror the repo layout as `/app/backend` + `/app/frontend`.
- **Editing `backend.env` alone changes nothing.** `env_file` values are baked in at container creation, so `docker compose restart` keeps the old values. Use `docker compose -f docker-compose.prod.yml up -d --force-recreate backend`.
- **The cloudflared container's `user:` must match the credential file's owner** (`CLOUDFLARED_USER`, `1002:1002` for claudeagent), otherwise it cannot read the 0600 file.
- The image is based on `node:22-slim` with `openssl`, because the `prisma-client` generator uses the glibc `debian-openssl-3.0.x` engine; Alpine would need the musl variant.
- Only one `cloudflared` connector should run per tunnel. Two connectors make Cloudflare split traffic between two backends, so webhook updates land half in each.
