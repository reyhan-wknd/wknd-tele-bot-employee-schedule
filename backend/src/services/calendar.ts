import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';

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

export async function isUserOnLeave(telegramId: bigint, date: Date): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user || !user.accessToken) return false;

  const client = createOAuth2Client(user.accessToken, user.refreshToken);

  // Refresh token if needed
  client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.user.update({
        where: { telegramId },
        data: { accessToken: tokens.access_token },
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: client });

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
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
