import 'dotenv/config';
import { prisma } from '../db';
import { createBot } from '../lib/telegram';
import { decryptToken, encryptToken } from '../lib/crypto';
import { tokenMasihBerlaku } from '../lib/token';
import { unlinkUser } from '../services/user';

const bot = createBot(process.env.BOT_TOKEN!);

async function checkTokens() {
  const users = await prisma.user.findMany({ where: { refreshToken: { not: null } } });
  const hasil = { lewati: 0, disegarkan: 0, dihapus: 0, gagalSementara: 0 };

  for (const user of users) {
    // Masa berlaku dibaca dari database, jadi tidak perlu memanggil endpoint tokeninfo
    // Google untuk setiap user seperti dulu — selama tokennya masih hidup, lewati saja.
    if (tokenMasihBerlaku(user.tokenExpiry)) {
      hasil.lewati++;
      continue;
    }

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: decryptToken(user.refreshToken) ?? '',
          grant_type: 'refresh_token',
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { access_token: string; expires_in?: number };
        await prisma.user.update({
          where: { telegramId: user.telegramId },
          data: {
            accessToken: encryptToken(data.access_token),
            tokenExpiry: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
          },
        });
        hasil.disegarkan++;
        continue;
      }

      // Hanya invalid_grant yang berarti izinnya benar-benar dicabut. 429, 5xx, atau
      // gangguan jaringan tidak boleh menghapus akun beserta pairing-nya.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error !== 'invalid_grant') {
        hasil.gagalSementara++;
        console.error(
          `Refresh token ${user.telegramId} gagal sementara (HTTP ${res.status}, ${body.error ?? 'tanpa kode'}), akun dipertahankan`
        );
        continue;
      }

      await unlinkUser(user.telegramId);
      hasil.dihapus++;
      await bot.telegram
        .sendMessage(Number(user.telegramId), '⚠️ Akses Google kamu sudah dicabut. Silakan /login ulang.')
        .catch((err) => console.error(`Failed to notify ${user.telegramId}:`, err.message));
    } catch (err) {
      hasil.gagalSementara++;
      console.error(`Token check failed for ${user.telegramId}:`, err);
    }
  }

  console.log(
    `Cek token: ${users.length} user, ${hasil.lewati} masih berlaku, ${hasil.disegarkan} disegarkan, ${hasil.gagalSementara} gagal sementara, ${hasil.dihapus} dihapus`
  );
}

async function main() {
  await checkTokens();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
