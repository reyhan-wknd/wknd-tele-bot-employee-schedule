import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';
import { wibDayBounds } from '../lib/time';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

/**
 * Dicocokkan dengan batas kata, bukan substring. Kata `off` sendirian sengaja tidak ada:
 * dulu ia membuat "Ke office pagi", "Coffee chat", dan "Kickoff project" terbaca sebagai cuti.
 */
const LEAVE_TITLE_PATTERN = /\b(cuti|izin|leave|day[\s-]?off|off[\s-]?day|pto|ooo)\b/i;

export interface CalendarEventLike {
  eventType?: string | null;
  summary?: string | null;
}

/** Event dianggap cuti bila tipenya outOfOffice, atau judulnya menyebut cuti secara utuh. */
export function isLeaveEvent(event: CalendarEventLike): boolean {
  if (event.eventType === 'outOfOffice') return true;
  return LEAVE_TITLE_PATTERN.test(event.summary ?? '');
}

function createOAuth2Client(accessToken: string, refreshToken: string | null): OAuth2Client {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return client;
}

export async function isUserOnLeave(telegramId: bigint, instant: Date = new Date()): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user || !user.accessToken) return false;

  const client = createOAuth2Client(user.accessToken, user.refreshToken);

  // Refresh token if needed
  // Listener event tidak punya pemanggil yang menunggu, jadi errornya harus ditangkap
  // di sini — kalau tidak, kegagalan tulis ke DB menjadi unhandled rejection.
  client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;

    prisma.user
      .update({ where: { telegramId }, data: { accessToken: tokens.access_token } })
      .catch((err) => console.error(`Gagal menyimpan access token baru untuk ${telegramId}:`, err));
  });

  const calendar = google.calendar({ version: 'v3', auth: client });

  // Batas hari dihitung dalam WIB, bukan zona waktu mesin — kalau tidak, jendelanya
  // bergeser dan cuti besok ikut terbaca sebagai cuti hari ini.
  const { start, end } = wibDayBounds(instant);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
    });

    return (res.data.items ?? []).some(isLeaveEvent);
  } catch (err) {
    console.error('Google Calendar error:', err);
    return false;
  }
}
