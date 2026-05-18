import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { bot } from '../bot';
import { findEmployeesByName, extractNameFromEmail } from '../services/schedule';

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

    // Auto-trigger schedule pairing flow
    const nameFromEmail = extractNameFromEmail(payload.email!);
    const matches = await findEmployeesByName(nameFromEmail);

    if (matches.length === 1) {
      await bot.telegram.sendMessage(telegramId, `Apakah ini kamu?\n\n👤 ${matches[0].name}\n💼 ${matches[0].jobTitle}\n🆔 ${matches[0].employeeNik}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ya, itu saya', callback_data: `pair:${matches[0].employeeNik}` }],
            [{ text: '❌ Bukan saya', callback_data: 'pair:not_me' }],
          ],
        },
      });
    } else if (matches.length > 1) {
      const buttons = matches.map((m) => [
        { text: `${m.name} (${m.jobTitle})`, callback_data: `pair:${m.employeeNik}` },
      ]);
      buttons.push([{ text: '❌ Tidak ada yang cocok', callback_data: 'pair:not_me' }]);
      await bot.telegram.sendMessage(telegramId, `Ditemukan ${matches.length} nama yang mirip. Pilih yang sesuai:`, {
        reply_markup: { inline_keyboard: buttons },
      });
    } else {
      await bot.telegram.sendMessage(telegramId, `❌ Nama "${nameFromEmail}" tidak ditemukan di jadwal.\n\nApakah kamu ingin mencari berdasarkan NIK?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Cari via NIK', callback_data: 'pair:ask_nik' }],
            [{ text: '❌ Tidak', callback_data: 'pair:disable' }],
          ],
        },
      });
    }

    res.redirect(`${FRONTEND_URL}/success.html`);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed');
  }
});
