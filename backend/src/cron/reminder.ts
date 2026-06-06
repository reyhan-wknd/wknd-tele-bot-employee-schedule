import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { prisma } from '../db';
import { isUserOnLeave } from '../services/calendar';

const bot = new Telegraf(process.env.BOT_TOKEN!);

function nowWIB(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

function todayDateWIB(): Date {
  const now = nowWIB();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  return new Date(dateStr);
}

export async function sendCheckInReminders() {
  const now = nowWIB();
  const day = now.getDay();
  if (day === 0 || day === 6) return; // Skip weekends

  const today = todayDateWIB();

  // Find all verified users
  const users = await prisma.user.findMany();

  for (const user of users) {
    // Check if already checked in
    const attendance = await prisma.attendance.findUnique({
      where: { telegramId_date: { telegramId: user.telegramId, date: today } },
    });
    if (attendance) continue;

    const onLeave = await isUserOnLeave(user.telegramId, now);
    if (onLeave) continue;

    await bot.telegram.sendMessage(
      Number(user.telegramId),
      '⏰ Reminder: Kamu belum check-in hari ini. Gunakan /check_in untuk absen masuk.'
    ).catch((err) => console.error(`Failed to send check-in reminder to ${user.telegramId}:`, err.message));
  }
}

export async function sendCheckOutReminders() {
  const now = nowWIB();
  const day = now.getDay();
  if (day === 0 || day === 6) return;

  const today = todayDateWIB();

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
