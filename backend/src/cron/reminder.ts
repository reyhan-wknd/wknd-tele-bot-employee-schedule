import 'dotenv/config';
import { prisma } from '../db';
import { createBot } from '../lib/telegram';
import { isUserOnLeave } from '../services/calendar';
import { todayWIB, weekdayOf } from '../lib/time';

const bot = createBot(process.env.BOT_TOKEN!);

async function sendCheckInReminders() {
  const today = todayWIB();
  const weekday = weekdayOf(today);
  if (weekday === 0 || weekday === 6) return; // Skip weekends

  // Find all verified users
  const users = await prisma.user.findMany();

  for (const user of users) {
    // Check if already checked in
    const attendance = await prisma.attendance.findUnique({
      where: { telegramId_date: { telegramId: user.telegramId, date: today } },
    });
    if (attendance) continue;

    const onLeave = await isUserOnLeave(user.telegramId);
    if (onLeave) continue;

    await bot.telegram.sendMessage(
      Number(user.telegramId),
      '⏰ Reminder: Kamu belum check-in hari ini. Gunakan /check_in untuk absen masuk.'
    ).catch((err) => console.error(`Failed to send check-in reminder to ${user.telegramId}:`, err.message));
  }
}

async function sendCheckOutReminders() {
  const today = todayWIB();
  if (weekdayOf(today) === 0 || weekdayOf(today) === 6) return;

  // Find users who checked in but haven't checked out
  const attendances = await prisma.attendance.findMany({
    where: { date: today, checkOut: null },
  });

  const realNow = new Date();

  for (const att of attendances) {
    const diffHours = (realNow.getTime() - att.checkIn.getTime()) / (1000 * 60 * 60);
    if (diffHours < 8) continue; // Not yet 8 hours

    await bot.telegram.sendMessage(
      Number(att.telegramId),
      '⏰ Reminder: Kamu belum check-out hari ini. Gunakan /check_out untuk absen pulang.'
    ).catch((err) => console.error(`Failed to send check-out reminder to ${att.telegramId}:`, err.message));
  }
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
