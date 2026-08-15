import 'dotenv/config';
import { prisma } from '../db';
import { createBot, kirimMassal, type PesanMassal } from '../lib/telegram';
import { isUserOnLeave } from '../services/calendar';
import { todayWIB, weekdayOf } from '../lib/time';

const bot = createBot(process.env.BOT_TOKEN!);

async function sendCheckInReminders() {
  const today = todayWIB();
  const weekday = weekdayOf(today);
  if (weekday === 0 || weekday === 6) {
    console.log('Reminder check-in: akhir pekan, dilewati');
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

async function sendCheckOutReminders() {
  const today = todayWIB();
  if (weekdayOf(today) === 0 || weekdayOf(today) === 6) {
    console.log('Reminder check-out: akhir pekan, dilewati');
    return;
  }

  const attendances = await prisma.attendance.findMany({
    where: { date: today, checkOut: null },
  });

  const realNow = new Date();
  const pesan: PesanMassal[] = attendances
    .filter((att) => (realNow.getTime() - att.checkIn.getTime()) / (1000 * 60 * 60) >= 8)
    .map((att) => ({
      telegramId: att.telegramId,
      text: '⏰ Reminder: Kamu belum check-out hari ini. Gunakan /check_out untuk absen pulang.',
    }));

  const hasil = await kirimMassal(bot, pesan);
  console.log(`Reminder check-out: ${attendances.length} absensi terbuka, ${hasil.terkirim} terkirim, ${hasil.diblokir} memblokir bot, ${hasil.gagal} gagal`);
}

async function main() {
  const type = process.argv[2]; // 'checkin' or 'checkout'

  if (type === 'checkin') {
    await sendCheckInReminders();
  } else if (type === 'checkout') {
    await sendCheckOutReminders();
  } else {
    console.error('Usage: tsx src/cron/reminder.ts <checkin|checkout>');
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
