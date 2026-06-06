import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { prisma } from '../db';

const bot = new Telegraf(process.env.BOT_TOKEN!);

function formatDate(date: Date): string {
  return date.toLocaleDateString('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export async function remindTomorrow() {
  // Get tomorrow's date in WIB
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  const tomorrowDate = new Date(tomorrowStr);

  // Find all user_schedules paired users who have WFO tomorrow
  const userSchedules = await prisma.userSchedule.findMany();

  for (const us of userSchedules) {
    const schedule = await prisma.schedule.findFirst({
      where: { employeeNik: us.employeeNik, date: tomorrowDate },
    });

    if (schedule) {
      await bot.telegram.sendMessage(
        Number(us.telegramId),
        `📢 Reminder: Besok (${formatDate(tomorrowDate)}) adalah jadwal WFO kamu.\n\n📁 Project: ${schedule.projectName}`
      ).catch((err) => console.error(`Failed to send WFO reminder to ${us.telegramId}:`, err.message));
    }
  }
}

export async function remindNextWeek() {
  // Get next Monday to Friday
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day = now.getDay(); // Friday = 5
  const daysToNextMonday = day === 0 ? 1 : 8 - day;

  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysToNextMonday);

  const nextFriday = new Date(nextMonday);
  nextFriday.setDate(nextMonday.getDate() + 4);

  const mondayStr = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  const fridayStr = `${nextFriday.getFullYear()}-${String(nextFriday.getMonth() + 1).padStart(2, '0')}-${String(nextFriday.getDate()).padStart(2, '0')}T00:00:00.000Z`;

  const userSchedules = await prisma.userSchedule.findMany();

  for (const us of userSchedules) {
    const schedules = await prisma.schedule.findMany({
      where: {
        employeeNik: us.employeeNik,
        date: { gte: new Date(mondayStr), lte: new Date(fridayStr) },
      },
      orderBy: { date: 'asc' },
    });

    if (schedules.length > 0) {
      let msg = '📅 Jadwal WFO kamu minggu depan:\n\n';
      for (const s of schedules) {
        msg += `  • ${formatDate(s.date)} — ${s.projectName}\n`;
      }
      await bot.telegram.sendMessage(Number(us.telegramId), msg)
        .catch((err) => console.error(`Failed to send weekly reminder to ${us.telegramId}:`, err.message));
    }
  }
}
