import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';
import { wibDayBounds } from '../lib/time';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const CUTI_KEYWORDS = ['cuti', 'leave', 'off', 'day off', 'day-off'];

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

    const events = res.data.items || [];

    return events.some((event) => {
      // Check event type outOfOffice
      if (event.eventType === 'outOfOffice') return true;

      // Check keywords in title
      const title = (event.summary || '').toLowerCase();
      return CUTI_KEYWORDS.some((kw) => title.includes(kw));
    });
  } catch (err) {
    console.error('Google Calendar error:', err);
    return false;
  }
}
