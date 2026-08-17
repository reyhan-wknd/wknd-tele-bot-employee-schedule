import 'dotenv/config';
import { prisma } from '../db';
import { createBot, kirimMassal, type PesanMassal } from '../lib/telegram';
import { isUserOnLeave } from '../services/calendar';
import { labelLibur } from '../services/holiday';
import { todayWIB, weekdayOf } from '../lib/time';

const bot = createBot(process.env.BOT_TOKEN!);

export async function sendCheckInReminders() {
  const today = todayWIB();
  const weekday = weekdayOf(today);
  if (weekday === 0 || weekday === 6) {
    console.log('Reminder check-in: akhir pekan, dilewati');
    return;
  }

  const libur = await labelLibur(today);
  if (libur) {
    console.log(`Reminder check-in: hari libur (${libur}), dilewati`);
    return;
  }

  const users = await prisma.user.findMany();
  const sudahAbsen = new Set(
    (await prisma.attendance.findMany({ where: { date: today }, select: { telegramId: true } }))
      .map((a) => a.telegramId.toString())
  );

  const pesan: PesanMassal[] = [];
  for (const user of users) {
    if (sudahAbsen.has(user.telegramId.toString())) continue;
    if (await isUserOnLeave(user)) continue;

    pesan.push({
      telegramId: user.telegramId,
      text: '⏰ Reminder: Kamu belum check-in hari ini. Gunakan /check_in untuk absen masuk.',
    });
  }

  const hasil = await kirimMassal(bot, pesan);
  console.log(`Reminder check-in: ${users.length} user diperiksa, ${hasil.terkirim} terkirim, ${hasil.diblokir} memblokir bot, ${hasil.gagal} gagal`);
}

// Reminder check-out tidak lagi di sini. Menyapu semua absensi terbuka pada jam tetap
// membuat yang baru check-in siang ikut ditagih jam 18:00, padahal jam pulangnya belum.
// Sekarang dijadwalkan per orang saat check-in — lihat services/job-queue.ts.

// Tetap bisa dijalankan manual: npx tsx src/cron/reminder.ts checkin
if (typeof require !== 'undefined' && require.main === module) {
  if (process.argv[2] !== 'checkin') {
    console.error('Usage: tsx src/cron/reminder.ts checkin');
    process.exit(1);
  }

  void sendCheckInReminders().finally(() => prisma.$disconnect());
}
