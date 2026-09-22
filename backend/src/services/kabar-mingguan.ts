import { prisma } from '../db';
import type { Catatan, JadwalHari, StatusKabar } from '../lib/jadwal-mingguan';
import { dateOnly, isoDateOf } from '../lib/time';

interface BarisCatatan {
  telegramId: bigint;
  status: string;
  snapshot: string;
  notifiedOn: Date;
}

/**
 * Baris yang tidak bisa dibaca dianggap tidak ada: akibatnya orang itu menerima jadwal
 * lengkap sekali lagi, yang jauh lebih aman daripada seluruh pengecekan ikut gagal.
 */
function keCatatan(baris: BarisCatatan): Catatan | null {
  try {
    const snapshot = JSON.parse(baris.snapshot) as JadwalHari[];
    if (!Array.isArray(snapshot)) throw new Error('snapshot bukan array');

    return { status: baris.status as StatusKabar, snapshot, notifiedOn: isoDateOf(baris.notifiedOn) };
  } catch (err) {
    console.warn(`Catatan kabar mingguan ${baris.telegramId} tidak terbaca, diabaikan:`, err);
    return null;
  }
}

/** Catatan tiap orang untuk pekan yang dimulai `senin`, dikunci dengan telegramId (string). */
export async function bacaCatatan(senin: Date, telegramIds: readonly bigint[]): Promise<Map<string, Catatan>> {
  const baris = await prisma.weeklyScheduleNotice.findMany({
    where: { weekStart: senin, telegramId: { in: [...telegramIds] } },
  });

  const peta = new Map<string, Catatan>();
  for (const b of baris) {
    const catatan = keCatatan(b);
    if (catatan) peta.set(b.telegramId.toString(), catatan);
  }
  return peta;
}

export async function simpanCatatan(telegramId: bigint, senin: Date, catatan: Catatan): Promise<void> {
  const isi = {
    status: catatan.status,
    snapshot: JSON.stringify(catatan.snapshot),
    notifiedOn: dateOnly(catatan.notifiedOn),
  };

  await prisma.weeklyScheduleNotice.upsert({
    where: { telegramId_weekStart: { telegramId, weekStart: senin } },
    create: { telegramId, weekStart: senin, ...isi },
    update: isi,
  });
}
