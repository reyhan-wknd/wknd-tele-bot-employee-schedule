import 'dotenv/config';
import { prisma } from '../db';
import { createBot, kirimMassal, type PesanMassal } from '../lib/telegram';
import { addDays, dateOnly, formatDateOnly, isoDateOf, todayWIB } from '../lib/time';
import { formatProjects, groupSchedulesByDate } from '../lib/schedule';
import {
  hariCek,
  pekanDepan,
  snapshotJadwal,
  tentukanKabar,
  type Alasan,
  type Catatan,
  type HariCek,
  type Keputusan,
} from '../lib/jadwal-mingguan';
import { labelLibur } from '../services/holiday';
import { bacaCatatan, simpanCatatan } from '../services/kabar-mingguan';
import { fetchSchedules, type ScheduleRecord } from '../services/supabase';
import { syncSchedules } from './sync-schedules';

const bot = createBot(process.env.BOT_TOKEN!);

/**
 * Pairing milik user yang sudah logout tidak boleh ikut dikirimi reminder. Sejak
 * `unlinkUser` dipakai, baris yatim tidak lagi tercipta — filter ini menutup sisa
 * baris lama yang terlanjur ada.
 */
async function pairingUserAktif() {
  const [userSchedules, users] = await Promise.all([
    prisma.userSchedule.findMany(),
    prisma.user.findMany({ select: { telegramId: true } }),
  ]);

  const aktif = new Set(users.map((u) => u.telegramId.toString()));
  return userSchedules.filter((us) => aktif.has(us.telegramId.toString()));
}

export async function remindTomorrow() {
  const tomorrowDate = addDays(todayWIB(), 1);

  // Biasanya hari libur memang tidak punya baris jadwal sehingga tidak ada yang dikirimi,
  // tapi gerbang ini membuatnya pasti — sekaligus menjelaskan alasannya di log.
  const libur = await labelLibur(tomorrowDate);
  if (libur) {
    console.log(`Reminder WFO besok: besok libur (${libur}), dilewati`);
    return;
  }

  const userSchedules = await pairingUserAktif();

  const jadwal = await prisma.schedule.findMany({
    where: { employeeNik: { in: userSchedules.map((us) => us.employeeNik) }, date: tomorrowDate },
    orderBy: { projectName: 'asc' },
  });

  const pesan: PesanMassal[] = [];
  for (const us of userSchedules) {
    const miliknya = jadwal.filter((s) => s.employeeNik === us.employeeNik);
    if (miliknya.length === 0) continue;

    const projects = formatProjects(groupSchedulesByDate(miliknya)[0]);
    pesan.push({
      telegramId: us.telegramId,
      text: `📢 Reminder: Besok (${formatDateOnly(tomorrowDate)}) adalah jadwal WFO kamu.\n\n📁 Project: ${projects}`,
    });
  }

  const hasil = await kirimMassal(bot, pesan);
  console.log(`Reminder WFO besok: ${userSchedules.length} pairing diperiksa, ${hasil.terkirim} terkirim, ${hasil.diblokir} memblokir bot, ${hasil.gagal} gagal`);
}

/**
 * Kabar jadwal WFO pekan depan — Jumat, Sabtu, dan Minggu pukul 21:00. Aturan kabarnya
 * ada di `lib/jadwal-mingguan.ts`; di sini hanya pengambilan data, pengiriman, dan catatan.
 */
export async function cekJadwalMingguDepan() {
  const today = todayWIB();
  const hari = hariCek(today);
  if (!hari) {
    console.log('Cek jadwal minggu depan hanya berjalan Jumat–Minggu, dilewati');
    return;
  }

  // Roster bisa terbit di antara sync 20:00 dan sekarang (Sabtu 12 September 2026 pukul
  // 20:11). Sync dulu, supaya /schedule menampilkan hal yang sama dengan kabar ini.
  await syncSchedules();

  const { senin, jumat } = pekanDepan(today);

  // Keputusan diambil dari Supabase langsung, bukan tabel lokal: fetch yang berhasil tapi
  // kosong berarti "belum terbit", sedangkan fetch yang gagal berarti "tidak tahu" — dan
  // tabel lokal tidak bisa membedakan keduanya. Menebak di sini berbahaya terutama pada
  // hari Minggu, ketika "belum terbit" berujung kabar "tidak ada WFO".
  let roster: ScheduleRecord[];
  try {
    roster = await fetchSchedules({ start: isoDateOf(senin), end: isoDateOf(jumat) });
  } catch (err) {
    console.error('Cek jadwal minggu depan: roster tidak bisa diambil dari Supabase, dilewati:', err);
    return;
  }

  const userSchedules = await pairingUserAktif();
  const catatan = await bacaCatatan(senin, userSchedules.map((us) => us.telegramId));
  const keputusan = putuskanPerOrang(userSchedules, roster, catatan, hari, isoDateOf(today));

  const pesan: PesanMassal[] = keputusan.flatMap((k) =>
    k.pesan ? [{ telegramId: k.telegramId, text: k.pesan }] : []
  );
  const hasil = await kirimMassal(bot, pesan);

  // Hanya kabar yang benar-benar sampai yang dicatat: yang gagal hari ini menerima kabar
  // lengkap besok, bukan dianggap sudah tahu.
  const sampai = new Set(hasil.terkirimKe.map(String));
  for (const k of keputusan) {
    if (k.catatan && sampai.has(k.telegramId.toString())) {
      await simpanCatatan(k.telegramId, senin, k.catatan);
    }
  }

  const hilang = keputusan.filter((k) => k.alasan === 'roster-hilang').length;
  if (hilang > 0) {
    console.warn(
      `Cek jadwal minggu depan: roster ${isoDateOf(senin)} kosong padahal sudah pernah dikirim ` +
        `ke ${hilang} orang; tidak ada yang dikabari`
    );
  }

  console.log(
    `Cek jadwal minggu depan (${hari}, pekan ${isoDateOf(senin)}, ${roster.length} baris roster): ` +
      `${ringkasAlasan(keputusan)}; ${hasil.terkirim} terkirim, ${hasil.diblokir} memblokir bot, ${hasil.gagal} gagal`
  );
}

function putuskanPerOrang(
  userSchedules: readonly { telegramId: bigint; employeeNik: string }[],
  roster: readonly ScheduleRecord[],
  catatan: ReadonlyMap<string, Catatan>,
  hari: HariCek,
  hariIni: string
): (Keputusan & { telegramId: bigint })[] {
  const terbit = roster.length > 0;

  return userSchedules.map((us) => {
    const miliknya = roster
      .filter((r) => r.employeeNik === us.employeeNik)
      .map((r) => ({ date: dateOnly(r.date), projectName: r.projectName }));

    return {
      telegramId: us.telegramId,
      ...tentukanKabar({
        hari,
        hariIni,
        terbit,
        jadwal: snapshotJadwal(miliknya),
        catatan: catatan.get(us.telegramId.toString()) ?? null,
      }),
    };
  });
}

/** "jadwal 3, sama 12" — jejak yang cukup untuk mengaudit satu malam pengecekan. */
function ringkasAlasan(keputusan: readonly { alasan: Alasan }[]): string {
  const perAlasan = new Map<Alasan, number>();
  for (const k of keputusan) perAlasan.set(k.alasan, (perAlasan.get(k.alasan) ?? 0) + 1);

  return [...perAlasan].map(([alasan, n]) => `${alasan} ${n}`).join(', ') || 'tidak ada pairing';
}

// Tetap bisa dijalankan manual: npx tsx src/cron/reminder-wfo.ts <tomorrow|weekly>
if (typeof require !== 'undefined' && require.main === module) {
  const jenis = process.argv[2];
  const tugas = jenis === 'tomorrow' ? remindTomorrow : jenis === 'weekly' ? cekJadwalMingguDepan : null;

  if (!tugas) {
    console.error('Usage: tsx src/cron/reminder-wfo.ts <tomorrow|weekly>');
    process.exit(1);
  }

  void tugas().finally(() => prisma.$disconnect());
}
