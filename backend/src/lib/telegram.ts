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
