import { prisma } from '../db';

/**
 * Hapus tautan akun beserta data turunannya.
 *
 * Foreign key sudah dilepas di migrasi 20260514184129, jadi menghapus baris `users`
 * saja meninggalkan pairing yatim — dan reminder WFO tetap terkirim ke orang yang
 * sudah logout. Keduanya harus dihapus bersama dalam satu transaksi.
 *
 * Absensi sengaja dipertahankan: itu catatan kehadiran, bukan data tautan akun, dan
 * tetap nyambung lewat telegram_id bila user login lagi.
 */
export async function unlinkUser(telegramId: bigint): Promise<void> {
  const user = await prisma.user.findUnique({ where: { telegramId } });

  await prisma.$transaction([
    prisma.userSchedule.deleteMany({ where: { telegramId } }),
    prisma.user.delete({ where: { telegramId } }),
  ]);

  // Menghapus baris tidak mencabut izinnya di sisi Google — tanpa ini, aplikasi tetap
  // tercantum di halaman izin akun user meski tautannya sudah dihapus.
  await revokeGoogleToken(user?.refreshToken ?? user?.accessToken ?? null);
}

async function revokeGoogleToken(token: string | null): Promise<void> {
  if (!token) return;

  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!res.ok) console.warn(`Revoke token Google gagal: HTTP ${res.status}`);
  } catch (err) {
    console.warn('Revoke token Google gagal:', err instanceof Error ? err.message : err);
  }
}
