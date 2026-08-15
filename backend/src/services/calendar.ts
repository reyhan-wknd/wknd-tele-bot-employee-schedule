import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db';
import { wibDayBounds } from '../lib/time';
import { decryptToken, encryptToken } from '../lib/crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

export interface CalendarEventLike {
  eventType?: string | null;
}

/**
 * Cuti ditentukan semata-mata oleh tipe event "Out of office" bawaan Google Calendar.
 *
 * Judul sengaja tidak ikut diperiksa: mencocokkan kata pernah membuat "Ke office pagi"
 * dan "Coffee chat" terbaca sebagai cuti, sementara tipe event adalah penanda eksplisit
 * yang memang dibuat Google untuk maksud ini.
 */
export function isLeaveEvent(event: CalendarEventLike): boolean {
  return event.eventType === 'outOfOffice';
}

function createOAuth2Client(accessToken: string, refreshToken: string | null): OAuth2Client {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return client;
}

export interface UserToken {
  telegramId: bigint;
  accessToken: string | null;
  refreshToken: string | null;
}

/** Menerima baris user langsung: pemanggilnya selalu sudah memegangnya. */
export async function isUserOnLeave(user: UserToken, instant: Date = new Date()): Promise<boolean> {
  if (!user.accessToken) return false;
  const telegramId = user.telegramId;

  const client = createOAuth2Client(decryptToken(user.accessToken)!, decryptToken(user.refreshToken));

  // Refresh token if needed
  // Listener event tidak punya pemanggil yang menunggu, jadi errornya harus ditangkap
  // di sini — kalau tidak, kegagalan tulis ke DB menjadi unhandled rejection.
  client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;

    prisma.user
      .update({
        where: { telegramId },
        data: {
          accessToken: encryptToken(tokens.access_token),
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      })
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
    // Kegagalan konfigurasi (API belum diaktifkan, izin dicabut) dulu ikut diserap jadi
    // "tidak cuti" tanpa jejak yang jelas — fiturnya mati diam-diam. Fail-open tetap
    // dipertahankan supaya check-in tidak terblokir, tetapi sebabnya harus terbaca.
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    const alasan = (err as { errors?: { reason?: string }[] }).errors?.[0]?.reason;

    if (status === 403 && alasan === 'accessNotConfigured') {
      console.error(
        'DETEKSI CUTI TIDAK AKTIF: Google Calendar API belum diaktifkan untuk project ini. ' +
          'Selama itu, semua orang dianggap tidak cuti. Aktifkan API-nya di Google Cloud Console.'
      );
    } else if (status === 401 || status === 403) {
      console.error(`Deteksi cuti gagal karena izin (HTTP ${status}, ${alasan ?? 'tanpa alasan'}):`, err);
    } else {
      console.error('Google Calendar error:', err);
    }

    return false;
  }
}
