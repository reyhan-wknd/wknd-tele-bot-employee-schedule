import 'dotenv/config';
import { prisma } from '../db';
import { createBot } from '../lib/telegram';
import { addDays, formatDateOnly, todayWIB, weekdayOf } from '../lib/time';
import { formatProjects, groupSchedulesByDate } from '../lib/schedule';

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

async function remindTomorrow() {
  const tomorrowDate = addDays(todayWIB(), 1);

  const userSchedules = await pairingUserAktif();

  for (const us of userSchedules) {
    // findMany, bukan findFirst: satu hari bisa memuat lebih dari satu proyek.
    const schedules = await prisma.schedule.findMany({
      where: { employeeNik: us.employeeNik, date: tomorrowDate },
      orderBy: { projectName: 'asc' },
    });

    if (schedules.length > 0) {
      const projects = formatProjects(groupSchedulesByDate(schedules)[0]);
      await bot.telegram.sendMessage(
        Number(us.telegramId),
        `📢 Reminder: Besok (${formatDateOnly(tomorrowDate)}) adalah jadwal WFO kamu.\n\n📁 Project: ${projects}`
      ).catch((err) => console.error(`Failed to send WFO reminder to ${us.telegramId}:`, err.message));
    }
  }
}

async function remindNextWeek() {
  // Senin sampai Jumat minggu depan
  const today = todayWIB();
  const weekday = weekdayOf(today); // Jumat = 5
  const nextMonday = addDays(today, weekday === 0 ? 1 : 8 - weekday);
  const nextFriday = addDays(nextMonday, 4);

  const userSchedules = await pairingUserAktif();

  for (const us of userSchedules) {
    const schedules = await prisma.schedule.findMany({
      where: {
        employeeNik: us.employeeNik,
        date: { gte: nextMonday, lte: nextFriday },
      },
      orderBy: [{ date: 'asc' }, { projectName: 'asc' }],
    });

    if (schedules.length > 0) {
      let msg = '📅 Jadwal WFO kamu minggu depan:\n\n';
      for (const group of groupSchedulesByDate(schedules)) {
        msg += `  • ${formatDateOnly(group.date)} — ${formatProjects(group)}\n`;
      }
      await bot.telegram.sendMessage(Number(us.telegramId), msg)
        .catch((err) => console.error(`Failed to send weekly reminder to ${us.telegramId}:`, err.message));
    }
  }
}

async function main() {
  const type = process.argv[2]; // 'tomorrow' or 'weekly'

  if (type === 'tomorrow') {
    await remindTomorrow();
  } else if (type === 'weekly') {
    await remindNextWeek();
  } else {
    console.error('Usage: tsx src/cron/reminder-wfo.ts <tomorrow|weekly>');
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
