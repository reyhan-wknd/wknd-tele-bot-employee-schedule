import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { bot } from '../bot';
import { ALLOWED_EMAIL_DOMAINS, isAllowedEmail } from '../config';
import { pairUserByEmail } from '../services/schedule';

export const authRouter = Router();

const BOT_TOKEN = process.env.BOT_TOKEN!;
const JWT_SECRET = process.env.JWT_SECRET!;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);

// Rate limiting: 10 requests per minute per IP
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many requests, try again later' },
});

authRouter.use(authLimiter);

function validateInitData(initData: string): { valid: boolean; user?: { id: number } } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  params.delete('hash');
  const entries = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(entries).digest('hex');

  // timingSafeEqual melempar RangeError bila panjangnya berbeda, dan `hash` datang dari
  // input — tanpa cek ini, initData cacat menghasilkan 500, bukan 401.
  if (computedHash.length !== hash.length) return { valid: false };
  if (!crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash))) {
    return { valid: false };
  }

  // Check auth_date is not too old (5 minutes)
  const authDate = params.get('auth_date');
  if (authDate) {
    const age = Math.floor(Date.now() / 1000) - parseInt(authDate, 10);
    if (age > 300) return { valid: false };
  }

  const userStr = params.get('user');
  if (!userStr) return { valid: false };

  try {
    const user = JSON.parse(userStr);
    if (!user.id || typeof user.id !== 'number') return { valid: false };
    return { valid: true, user: { id: user.id } };
  } catch {
    return { valid: false };
  }
}

// POST /auth/init — validate initData, return Google OAuth URL
authRouter.post('/init', (req: Request, res: Response) => {
  const { initData } = req.body;
  if (!initData || typeof initData !== 'string') {
    res.status(400).json({ error: 'initData required' });
    return;
  }

  const result = validateInitData(initData);
  if (!result.valid || !result.user) {
    res.status(401).json({ error: 'Invalid initData' });
    return;
  }

  const state = jwt.sign({ telegramId: result.user.id }, JWT_SECRET, { expiresIn: '5m' });

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/calendar.events.readonly');
  googleAuthUrl.searchParams.set('access_type', 'offline');
  googleAuthUrl.searchParams.set('prompt', 'consent');
  googleAuthUrl.searchParams.set('state', state);

  // Filter pemilih akun Google. Google hanya menerima satu nilai, dan parameter ini
  // bisa diabaikan klien — gerbang sebenarnya ada di callback.
  if (ALLOWED_EMAIL_DOMAINS.length === 1) {
    googleAuthUrl.searchParams.set('hd', ALLOWED_EMAIL_DOMAINS[0]);
  }

  res.json({ url: googleAuthUrl.toString() });
});

// GET /auth/google/callback — exchange code for tokens, save user, notify via bot
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;

  // Handle user cancellation
  if (oauthError === 'access_denied') {
    res.redirect(`${FRONTEND_URL}/index.html?error=cancelled`);
    return;
  }

  if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).send('Missing code or state');
    return;
  }

  // Verify state token
  let telegramId: number;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { telegramId: number };
    telegramId = payload.telegramId;
  } catch {
    res.status(403).send('Invalid or expired state');
    return;
  }

  // Exchange code for tokens
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload()!;

    if (!payload.email_verified) {
      res.status(400).send('Email not verified by Google');
      return;
    }

    // Hanya akun perusahaan yang boleh ditautkan. Sumber kebenarannya adalah email di
    // ID token yang tanda tangannya sudah diverifikasi, bukan parameter `hd` di URL.
    // Gerbang ini berjalan sebelum upsert supaya token akun luar tidak pernah tersimpan.
    if (!payload.email || !isAllowedEmail(payload.email)) {
      await bot.telegram
        .sendMessage(
          telegramId,
          `❌ Verifikasi gagal. Gunakan akun Google perusahaan (@${ALLOWED_EMAIL_DOMAINS.join(', @')}).`
        )
        .catch((err) => console.error('Gagal mengirim notifikasi penolakan domain:', err));
      res.redirect(`${FRONTEND_URL}/index.html?error=domain`);
      return;
    }

    await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {
        googleEmail: payload.email!,
        googleSub: payload.sub!,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
      },
      create: {
        telegramId: BigInt(telegramId),
        googleEmail: payload.email!,
        googleSub: payload.sub!,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
      },
    });

    await bot.telegram.sendMessage(
      telegramId,
      `✅ Verifikasi Berhasil!\n\nHalo, ${payload.email}`
    );

    // Tautkan ke data karyawan lewat email yang barusan diverifikasi. Kegagalan di sini
    // tidak boleh menggagalkan login — user tinggal mengulang lewat /schedule.
    try {
      const employee = await pairUserByEmail(BigInt(telegramId), payload.email);

      if (employee) {
        await bot.telegram.sendMessage(
          telegramId,
          `📇 Terhubung dengan data karyawan:\n\n👤 ${employee.name}\n💼 ${employee.jobTitle}\n🆔 ${employee.employeeNik}\n\nKirim /schedule untuk melihat jadwal WFO kamu.`
        );
      } else {
        await bot.telegram.sendMessage(
          telegramId,
          `⚠️ Akun kamu sudah terverifikasi, tapi data karyawan dengan email ${payload.email} belum ditemukan.\n\nHubungi admin untuk melengkapi data kamu, lalu kirim /schedule lagi.`
        );
      }
    } catch (err) {
      console.error('Pairing karyawan gagal:', err);
      await bot.telegram
        .sendMessage(telegramId, '⚠️ Data jadwal sedang tidak bisa diakses. Kirim /schedule beberapa saat lagi.')
        .catch((sendErr) => console.error('Gagal mengirim notifikasi pairing:', sendErr));
    }

    res.redirect(`${FRONTEND_URL}/success.html`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed');
  }
});
