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

/**
 * Tabel sungguhan di Telegram dikirim lewat `sendRichMessage`, bukan `parse_mode`.
 *
 * Dua hal yang mudah menjebak, keduanya sudah diuji ke API sungguhan:
 *   - `<table>` pada parse_mode HTML ditolak ("Unsupported start tag"). Tabel memang
 *     bukan bagian dari sintaks pesan biasa.
 *   - `sendMessage` yang diberi `rich_message` menjawab ok=true tapi membuangnya diam-diam.
 *     Balikannya tidak memuat `rich_message`, jadi ok=true bukan bukti apa pun.
 */
export interface SelTabel {
  text: string;
  is_header?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
}

export interface BlokTabel {
  type: 'table';
  cells: SelTabel[][];
  caption?: string;
  is_bordered?: boolean;
}

/**
 * Telegraf 4.16.3 belum mengenal `sendRichMessage`, dan `callApi` bertipe
 * `M extends keyof Telegram` sehingga nama method baru tidak lolos typecheck.
 *
 * Cast-nya sengaja dikurung di satu tempat ini saja. Transportnya tetap lewat Telegraf
 * supaya agen IPv4 di atas dan penanganan errornya tidak ikut hilang — memanggil `fetch`
 * mentah akan melepas agen itu, padahal ia dipasang justru karena panggilan Telegram
 * pernah menggantung di host dual-stack.
 */
export async function kirimTabel(bot: Telegraf, chatId: bigint | number, blok: BlokTabel): Promise<void> {
  const kirim = bot.telegram.callApi as unknown as (
    metode: string,
    payload: Record<string, unknown>
  ) => Promise<unknown>;

  await kirim.call(bot.telegram, 'sendRichMessage', {
    chat_id: Number(chatId),
    rich_message: { blocks: [blok] },
  });
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
