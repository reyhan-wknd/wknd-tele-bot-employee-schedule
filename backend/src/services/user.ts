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
  await prisma.$transaction([
    prisma.userSchedule.deleteMany({ where: { telegramId } }),
    prisma.user.delete({ where: { telegramId } }),
  ]);
}
