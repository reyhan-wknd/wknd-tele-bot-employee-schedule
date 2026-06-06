import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { prisma } from '../db';

const bot = new Telegraf(process.env.BOT_TOKEN!);

export async function checkTokens() {
  console.log(`[${new Date().toISOString()}] Checking tokens...`);

  const users = await prisma.user.findMany({
    where: { accessToken: { not: null } },
  });

  for (const user of users) {
    try {
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${user.accessToken}`);
      if (res.status !== 200) {
        // Try refresh
        const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            refresh_token: user.refreshToken || '',
            grant_type: 'refresh_token',
          }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json() as { access_token: string };
          await prisma.user.update({
            where: { telegramId: user.telegramId },
            data: { accessToken: data.access_token },
          });
        } else {
          // Refresh failed — delete user and notify
          await prisma.user.delete({ where: { telegramId: user.telegramId } });
          await bot.telegram.sendMessage(
            Number(user.telegramId),
            '⚠️ Akses Google kamu sudah expired. Silakan /login ulang.'
          ).catch((err) => console.error(`Failed to notify ${user.telegramId}:`, err.message));
        }
      }
    } catch (err) {
      console.error(`Token check failed for ${user.telegramId}:`, err);
    }
  }

  console.log(`[${new Date().toISOString()}] Token check complete.`);
}
