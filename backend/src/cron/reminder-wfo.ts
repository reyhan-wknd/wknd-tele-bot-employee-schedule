import 'dotenv/config';
import { prisma } from '../db';
import { createBot, kirimMassal, type PesanMassal } from '../lib/telegram';
import { addDays, formatDateOnly, todayWIB, weekdayOf } from '../lib/time';
import { formatProjects, groupSchedulesByDate } from '../lib/schedule';
import { labelLibur } from '../services/holiday';

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

export async function remindNextWeek() {
  // Senin sampai Jumat minggu depan
  const today = todayWIB();
  const weekday = weekdayOf(today); // Jumat = 5
  const nextMonday = addDays(today, weekday === 0 ? 1 : 8 - weekday);
  const nextFriday = addDays(nextMonday, 4);

  const userSchedules = await pairingUserAktif();

  const jadwal = await prisma.schedule.findMany({
    where: {
      employeeNik: { in: userSchedules.map((us) => us.employeeNik) },
      date: { gte: nextMonday, lte: nextFriday },
    },
    orderBy: [{ date: 'asc' }, { projectName: 'asc' }],
  });

  const pesan: PesanMassal[] = [];
  for (const us of userSchedules) {
    const miliknya = jadwal.filter((s) => s.employeeNik === us.employeeNik);
    if (miliknya.length === 0) continue;

    let text = '📅 Jadwal WFO kamu minggu depan:\n\n';
    for (const group of groupSchedulesByDate(miliknya)) {
      text += `  • ${formatDateOnly(group.date)} — ${formatProjects(group)}\n`;
    }
    pesan.push({ telegramId: us.telegramId, text });
  }

  const hasil = await kirimMassal(bot, pesan);
  console.log(`Reminder jadwal minggu depan: ${userSchedules.length} pairing diperiksa, ${hasil.terkirim} terkirim, ${hasil.diblokir} memblokir bot, ${hasil.gagal} gagal`);
}

// Tetap bisa dijalankan manual: npx tsx src/cron/reminder-wfo.ts <tomorrow|weekly>
if (typeof require !== 'undefined' && require.main === module) {
  const jenis = process.argv[2];
  const tugas = jenis === 'tomorrow' ? remindTomorrow : jenis === 'weekly' ? remindNextWeek : null;

  if (!tugas) {
    console.error('Usage: tsx src/cron/reminder-wfo.ts <tomorrow|weekly>');
    process.exit(1);
  }

  void tugas().finally(() => prisma.$disconnect());
}
