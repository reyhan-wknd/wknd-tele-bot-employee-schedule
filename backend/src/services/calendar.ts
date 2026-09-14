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

/**
 * Batas tunggu satu pemeriksaan cuti, dari awal sampai jawaban — termasuk refresh token.
 *
 * Tanpa batas ini, koneksi ke Google yang menggantung ditunggu sampai timeout OS lalu
 * diulang dua kali oleh gaxios: 4–7 menit per panggilan. Itu terjadi 14 September 2026,
 * saat rute ISP ke sebagian IP www.googleapis.com putus. Webhook tidak menjawab, Telegram
 * mengirim ulang update yang sama tiap menit, dan reminder memakai data absensi yang basi.
 * Deteksi cuti memang fail-open, jadi lebih baik cepat menyerah daripada menahan bot.
 */
export const BATAS_TUNGGU_KALENDER_MS = 5_000;

class KalenderTerlambat extends Error {
  constructor() {
    super(`Google Calendar tidak menjawab dalam ${BATAS_TUNGGU_KALENDER_MS} ms`);
  }
}

async function denganBatasWaktu<T>(janji: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const habis = new Promise<never>((_, tolak) => {
    timer = setTimeout(() => tolak(new KalenderTerlambat()), BATAS_TUNGGU_KALENDER_MS);
  });

  try {
    return await Promise.race([janji, habis]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keterangan singkat bila error-nya gangguan jaringan — tak ada jawaban HTTP sama sekali,
 * hanya kode seperti ETIMEDOUT. Null untuk error yang punya jawaban (401, 403, 5xx).
 */
function gangguanJaringan(err: unknown): string | null {
  if (err instanceof KalenderTerlambat) return err.message;

  const { response, code } = err as { response?: unknown; code?: unknown };
  return !response && typeof code === 'string' ? code : null;
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
    const res = await denganBatasWaktu(
      calendar.events.list(
        {
          calendarId: 'primary',
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: true,
        },
        // Batas di atas hanya melepaskan pemanggil. Ini yang menutup soketnya dan menahan
        // gaxios mengulang di belakang, supaya permintaan yang ditinggal tidak menumpuk.
        { timeout: BATAS_TUNGGU_KALENDER_MS, retryConfig: { retry: 0, noResponseRetries: 0 } }
      )
    );

    return (res.data.items ?? []).some(isLeaveEvent);
  } catch (err) {
    // Gangguan jaringan cukup satu baris: stack gaxios lengkap pernah memenuhi log
    // puluhan baris per panggilan, tiap menit, sampai error lain tidak terbaca.
    const jaringan = gangguanJaringan(err);
    if (jaringan) {
      console.error(`Deteksi cuti ${telegramId} dilewati, dianggap tidak cuti: ${jaringan}`);
      return false;
    }

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
