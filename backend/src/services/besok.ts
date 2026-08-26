import { prisma } from '../db';
import { addDays, instanWIB, isoDateOf, todayWIB } from '../lib/time';
import { ringkasBesok } from '../lib/besok';
import { isUserOnLeave, type UserToken } from './calendar';
import { labelLibur } from './holiday';
import { getUserPairing } from './schedule';

/** Project WFO orang ini pada satu tanggal. Kosong juga bila ia belum terpasang ke data karyawan. */
async function proyekWFO(telegramId: bigint, tanggal: Date): Promise<string[]> {
  const pairing = await getUserPairing(telegramId);
  if (!pairing) return [];

  const jadwal = await prisma.schedule.findMany({
    where: { employeeNik: pairing.employeeNik, date: tanggal },
    orderBy: { projectName: 'asc' },
  });

  return jadwal.map((s) => s.projectName);
}

/**
 * Keadaan besok untuk ditempelkan pada pesan check-out; null berarti tidak ada yang
 * perlu disebut.
 *
 * Kegagalannya tidak dilempar. Absensinya sudah tercatat saat ini dipanggil, jadi
 * kalender atau tabel jadwal yang sedang bermasalah tidak boleh membuat pesan
 * "Check-out berhasil" berubah menjadi pesan error.
 */
export async function infoBesok(user: UserToken): Promise<string | null> {
  const besok = addDays(todayWIB(), 1);

  try {
    // Tengah hari WIB besok: instant mana pun di dalam hari itu sama saja bagi
    // `isUserOnLeave`, dan tengah hari jauh dari kedua ujung batas hari.
    const [cuti, libur, projects] = await Promise.all([
      isUserOnLeave(user, instanWIB(isoDateOf(besok), 12, 0)),
      labelLibur(besok),
      proyekWFO(user.telegramId, besok),
    ]);

    return ringkasBesok({ tanggal: besok, cuti, libur, projects });
  } catch (err) {
    console.error(`Gagal menyusun info besok untuk ${user.telegramId}:`, err);
    return null;
  }
}
