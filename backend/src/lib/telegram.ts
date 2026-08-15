import https from 'https';
import { Telegraf } from 'telegraf';

/**
 * `api.telegram.org` punya alamat IPv4 dan IPv6. Di mesin yang punya alamat IPv6 tapi
 * tanpa rute keluar, sebagian panggilan menggantung sampai ETIMEDOUT — dan karena
 * pemilihan alamat berganti-ganti, kegagalannya terasa acak. Agen ini mengunci semua
 * panggilan API Telegram ke IPv4, yang selalu tersedia.
 */
export const telegramAgent = new https.Agent({ family: 4, keepAlive: true });

export function createBot(token: string): Telegraf {
  return new Telegraf(token, { telegram: { agent: telegramAgent } });
}

/** Telegram membatasi sekitar 30 pesan/detik; 60 ms memberi jarak aman. */
const JEDA_KIRIM_MS = 60;

export interface PesanMassal {
  telegramId: bigint;
  text: string;
}

export interface HasilKirim {
  terkirim: number;
  diblokir: number;
  gagal: number;
}

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** User yang memblokir bot atau menghapus chatnya — bukan error yang perlu diulang. */
export function diblokirUser(err: unknown): boolean {
  const kode = (err as { response?: { error_code?: number } })?.response?.error_code;
  return kode === 403;
}

/** Detik tunggu yang diminta Telegram saat kena rate limit (429). */
export function retryAfter(err: unknown): number | null {
  const res = (err as { response?: { error_code?: number; parameters?: { retry_after?: number } } })?.response;
  if (res?.error_code !== 429) return null;
  return res.parameters?.retry_after ?? 1;
}

/**
 * Kirim pesan ke banyak penerima dengan jeda, sekali ulang bila kena rate limit, dan
 * ringkasan hasil supaya eksekusi cron meninggalkan jejak yang bisa diaudit.
 */
export async function kirimMassal(bot: Telegraf, pesan: readonly PesanMassal[]): Promise<HasilKirim> {
  const hasil: HasilKirim = { terkirim: 0, diblokir: 0, gagal: 0 };

  for (const [index, p] of pesan.entries()) {
    if (index > 0) await tidur(JEDA_KIRIM_MS);

    try {
      await bot.telegram.sendMessage(Number(p.telegramId), p.text);
      hasil.terkirim++;
    } catch (err) {
      const tunggu = retryAfter(err);
      if (tunggu !== null) {
        await tidur(tunggu * 1000);
        try {
          await bot.telegram.sendMessage(Number(p.telegramId), p.text);
          hasil.terkirim++;
          continue;
        } catch (err2) {
          err = err2;
        }
      }

      if (diblokirUser(err)) {
        hasil.diblokir++;
        console.warn(`${p.telegramId} memblokir bot, dilewati`);
      } else {
        hasil.gagal++;
        console.error(`Gagal mengirim ke ${p.telegramId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return hasil;
}
