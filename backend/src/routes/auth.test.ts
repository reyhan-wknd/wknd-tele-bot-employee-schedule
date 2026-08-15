import crypto from 'crypto';
import express from 'express';
import type { Server } from 'http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const BOT_TOKEN = '123:token-uji';

// --- tiruan dependensi eksternal -------------------------------------------------

/** Payload ID token yang dikembalikan Google; diubah per skenario. */
let payloadGoogle: Record<string, unknown> = {};
let tokenGoogle: Record<string, unknown> = {};

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    async getToken() {
      return { tokens: tokenGoogle };
    }
    setCredentials() {}
    async verifyIdToken() {
      return { getPayload: () => payloadGoogle };
    }
  },
}));

const prismaTiruan = {
  user: { upsert: vi.fn(), findFirst: vi.fn() },
};
vi.mock('../db', () => ({ prisma: prismaTiruan }));

const kirimPesan = vi.fn();
vi.mock('../bot', () => ({ bot: { telegram: { sendMessage: kirimPesan } } }));

const pairUserByEmail = vi.fn();
vi.mock('../services/schedule', () => ({ pairUserByEmail }));

const unlinkUser = vi.fn();
vi.mock('../services/user', () => ({ unlinkUser }));

// --- server uji ------------------------------------------------------------------

let server: Server;
let alamat: string;
let jwt: typeof import('jsonwebtoken');

beforeAll(async () => {
  vi.stubEnv('BOT_TOKEN', BOT_TOKEN);
  vi.stubEnv('JWT_SECRET', 'rahasia-uji');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id-uji');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret-uji');
  vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://contoh.test/auth/google/callback');
  vi.stubEnv('FRONTEND_URL', 'https://contoh.test');
  vi.stubEnv('ALLOWED_EMAIL_DOMAINS', 'weekendinc.com');
  vi.stubEnv('AUTH_RATE_LIMIT', '1000'); // rate limit tidak boleh mengganggu urutan tes
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', crypto.randomBytes(32).toString('base64'));

  const { authRouter } = await import('./auth');
  jwt = await import('jsonwebtoken');

  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  alamat = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  payloadGoogle = { email: 'reyhan.ramadhan@weekendinc.com', email_verified: true, sub: 'sub-123' };
  tokenGoogle = { id_token: 'id-token', access_token: 'access', refresh_token: 'refresh' };
  kirimPesan.mockResolvedValue(undefined);
  prismaTiruan.user.findFirst.mockResolvedValue(null);
  prismaTiruan.user.upsert.mockResolvedValue({});
  pairUserByEmail.mockResolvedValue({ employeeNik: '21225', name: 'Reyhan', jobTitle: 'Backend' });
});

afterEach(() => vi.clearAllMocks());

function initDataSah(telegramId = 839050319, authDate = Math.floor(Date.now() / 1000)): string {
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    user: JSON.stringify({ id: telegramId }),
  };
  const dcs = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  fields.hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return new URLSearchParams(fields).toString();
}

const panggilCallback = (query: string) =>
  fetch(`${alamat}/auth/google/callback?${query}`, { redirect: 'manual' });

const stateSah = (telegramId = 839050319) =>
  jwt.sign({ telegramId }, 'rahasia-uji', { expiresIn: '5m' });

// --- POST /auth/init -------------------------------------------------------------

describe('POST /auth/init', () => {
  const init = (body: unknown) =>
    fetch(`${alamat}/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('initData sah menghasilkan URL Google yang terfilter domain', async () => {
    const res = await init({ initData: initDataSah() });
    expect(res.status).toBe(200);

    const url = new URL(((await res.json()) as { url: string }).url);
    expect(url.searchParams.get('hd')).toBe('weekendinc.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://contoh.test/auth/google/callback');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  test('hash palsu ditolak', async () => {
    const rusak = initDataSah().replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
    expect((await init({ initData: rusak })).status).toBe(401);
  });

  test('hash dengan panjang tidak wajar tetap 401, bukan 500', async () => {
    const res = await init({ initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=abc' });
    expect(res.status).toBe(401);
  });

  test('initData kedaluwarsa ditolak', async () => {
    const lawas = initDataSah(839050319, Math.floor(Date.now() / 1000) - 600);
    expect((await init({ initData: lawas })).status).toBe(401);
  });

  test('body tanpa initData ditolak', async () => {
    expect((await init({})).status).toBe(400);
  });
});

// --- GET /auth/google/callback ---------------------------------------------------

describe('GET /auth/google/callback', () => {
  test('akun perusahaan tersimpan lalu dipasangkan', async () => {
    const res = await panggilCallback(`code=kode&state=${stateSah()}`);

    expect(res.headers.get('location')).toBe('https://contoh.test/success.html');
    expect(prismaTiruan.user.upsert).toHaveBeenCalledOnce();
    expect(pairUserByEmail).toHaveBeenCalledWith(839050319n, 'reyhan.ramadhan@weekendinc.com');
  });

  test('token disimpan dalam bentuk terenkripsi, bukan apa adanya', async () => {
    await panggilCallback(`code=kode&state=${stateSah()}`);

    const data = prismaTiruan.user.upsert.mock.calls[0][0].create;
    expect(data.accessToken).not.toBe('access');
    expect(data.refreshToken).not.toBe('refresh');
    expect(data.accessToken.startsWith('v1:')).toBe(true);
    expect(data.refreshToken.startsWith('v1:')).toBe(true);
  });

  test('masa berlaku token ikut disimpan supaya cron tidak perlu memanggil Google', async () => {
    tokenGoogle = { ...tokenGoogle, expiry_date: 1_800_000_000_000 };

    await panggilCallback(`code=kode&state=${stateSah()}`);

    expect(prismaTiruan.user.upsert.mock.calls[0][0].create.tokenExpiry).toEqual(new Date(1_800_000_000_000));
  });

  test('akun di luar domain ditolak sebelum apa pun tersimpan', async () => {
    payloadGoogle = { email: 'orang@gmail.com', email_verified: true, sub: 'sub-luar' };

    const res = await panggilCallback(`code=kode&state=${stateSah()}`);

    expect(res.headers.get('location')).toContain('error=domain');
    expect(prismaTiruan.user.upsert).not.toHaveBeenCalled();
    expect(pairUserByEmail).not.toHaveBeenCalled();
    expect(kirimPesan).toHaveBeenCalledOnce(); // user diberi tahu alasannya
  });

  test('email yang belum diverifikasi Google ditolak', async () => {
    payloadGoogle = { email: 'reyhan.ramadhan@weekendinc.com', email_verified: false, sub: 's' };

    expect((await panggilCallback(`code=kode&state=${stateSah()}`)).status).toBe(400);
    expect(prismaTiruan.user.upsert).not.toHaveBeenCalled();
  });

  test('tautan lama di Telegram lain dipindahkan, bukan menabrak unique constraint', async () => {
    prismaTiruan.user.findFirst.mockResolvedValue({ telegramId: 111n });

    await panggilCallback(`code=kode&state=${stateSah(222)}`);

    expect(unlinkUser).toHaveBeenCalledWith(111n);
    expect(prismaTiruan.user.upsert).toHaveBeenCalledOnce();
  });

  test('pairing yang gagal tidak menggagalkan login', async () => {
    pairUserByEmail.mockRejectedValue(new Error('supabase mati'));

    const res = await panggilCallback(`code=kode&state=${stateSah()}`);

    expect(res.headers.get('location')).toBe('https://contoh.test/success.html');
    expect(prismaTiruan.user.upsert).toHaveBeenCalledOnce();
  });

  test('state palsu ditolak', async () => {
    const res = await panggilCallback('code=kode&state=bukan-jwt');

    expect(res.status).toBe(403);
    expect(prismaTiruan.user.upsert).not.toHaveBeenCalled();
  });

  test('pembatalan dari Google diarahkan dengan alasan', async () => {
    const res = await panggilCallback('error=access_denied');

    expect(res.headers.get('location')).toContain('error=cancelled');
  });

  test('tanpa code ditolak', async () => {
    expect((await panggilCallback(`state=${stateSah()}`)).status).toBe(400);
  });
});
