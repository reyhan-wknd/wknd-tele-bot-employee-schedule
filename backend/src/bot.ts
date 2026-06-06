import { Telegraf } from 'telegraf';
import type { Express } from 'express';
import { prisma } from './db';
import { isUserOnLeave } from './services/calendar';
import {
  findEmployeesByName,
  findEmployeeByNik,
  pairUserSchedule,
  getUserPairing,
  extractNameFromEmail,
} from './services/schedule';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

export const bot = new Telegraf(BOT_TOKEN);

// Track users waiting for NIK input
const awaitingNik = new Set<number>();

function nowWIB(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

function todayDateWIB(): Date {
  const now = nowWIB();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  return new Date(dateStr);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('id-ID', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// --- Schedule Pairing Flow ---

async function startPairingFlow(ctx: any, telegramId: bigint) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    ctx.reply('❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  const nameFromEmail = extractNameFromEmail(user.googleEmail);
  const matches = await findEmployeesByName(nameFromEmail);

  if (matches.length === 1) {
    ctx.reply(`Apakah ini kamu?\n\n👤 ${matches[0].name}\n💼 ${matches[0].jobTitle}\n🆔 ${matches[0].employeeNik}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Ya, itu saya', callback_data: `pair:${matches[0].employeeNik}` }],
          [{ text: '❌ Bukan saya', callback_data: 'pair:not_me' }],
        ],
      },
    });
  } else if (matches.length > 1) {
    const buttons = matches.map((m) => [
      { text: `${m.name} (${m.jobTitle})`, callback_data: `pair:${m.employeeNik}` },
    ]);
    buttons.push([{ text: '❌ Tidak ada yang cocok', callback_data: 'pair:not_me' }]);
    ctx.reply(`Ditemukan ${matches.length} nama yang mirip. Pilih yang sesuai:`, {
      reply_markup: { inline_keyboard: buttons },
    });
  } else {
    ctx.reply(`❌ Nama "${nameFromEmail}" tidak ditemukan di jadwal.\n\nApakah kamu ingin mencari berdasarkan NIK?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Cari via NIK', callback_data: 'pair:ask_nik' }],
          [{ text: '❌ Tidak', callback_data: 'pair:disable' }],
        ],
      },
    });
  }
}

// --- Schedule Display ---

async function showSchedule(ctx: any, telegramId: bigint) {
  const pairing = await getUserPairing(telegramId);
  if (!pairing) {
    await startPairingFlow(ctx, telegramId);
    return;
  }

  const now = nowWIB();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const diffToSunday = -day; // Sunday = start of week

  const sunday = new Date(now);
  sunday.setDate(now.getDate() + diffToSunday);

  const nextSaturday = new Date(sunday);
  nextSaturday.setDate(sunday.getDate() + 13); // Sunday + 13 = Saturday next week

  const today = todayDateWIB();
  const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}T00:00:00.000Z`;
  const nextSaturdayStr = `${nextSaturday.getFullYear()}-${String(nextSaturday.getMonth() + 1).padStart(2, '0')}-${String(nextSaturday.getDate()).padStart(2, '0')}T00:00:00.000Z`;

  const schedules = await prisma.schedule.findMany({
    where: {
      employeeNik: pairing.employeeNik,
      date: { gte: today, lte: new Date(nextSaturdayStr) },
    },
    orderBy: { date: 'asc' },
  });

  // Split: this week = Sun-Sat, next week = next Sun onwards
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const saturdayStr = `${saturday.getFullYear()}-${String(saturday.getMonth() + 1).padStart(2, '0')}-${String(saturday.getDate()).padStart(2, '0')}T23:59:59.000Z`;
  const saturdayEnd = new Date(saturdayStr);

  const thisWeek = schedules.filter((s) => s.date <= saturdayEnd);
  const nextWeek = schedules.filter((s) => s.date > saturdayEnd);

  const groupByDate = (items: typeof schedules) => {
    const map = new Map<string, { date: Date; projects: string[] }>();
    for (const s of items) {
      const key = s.date.toISOString();
      if (!map.has(key)) map.set(key, { date: s.date, projects: [] });
      map.get(key)!.projects.push(s.projectName);
    }
    return Array.from(map.values());
  };

  let msg = '📅 Jadwal WFO kamu:\n';

  // Today's status
  const todaySchedule = await prisma.schedule.findMany({
    where: { employeeNik: pairing.employeeNik, date: today },
  });
  const dayOfWeek = now.getDay();
  let todayStatus: string;
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    todayStatus = '🏖️ Day Off';
  } else if (todaySchedule.length > 0) {
    todayStatus = `🏢 WFO (${todaySchedule.map((s) => s.projectName).join(', ')})`;
  } else {
    todayStatus = '🏠 WFH';
  }
  msg += `\n📍 Hari ini: ${todayStatus}\n`;

  msg += '\n📌 Minggu ini:\n';
  const thisWeekGrouped = groupByDate(thisWeek);
  if (thisWeekGrouped.length > 0) {
    for (const g of thisWeekGrouped) {
      msg += `  • ${formatDate(g.date)} — ${g.projects.join(', ')}\n`;
    }
  } else {
    msg += '  Belum ada jadwal\n';
  }

  msg += '\n📌 Minggu depan:\n';
  const nextWeekGrouped = groupByDate(nextWeek);
  if (nextWeekGrouped.length > 0) {
    for (const g of nextWeekGrouped) {
      msg += `  • ${formatDate(g.date)} — ${g.projects.join(', ')}\n`;
    }
  } else {
    msg += '  Belum ada jadwal\n';
  }

  ctx.reply(msg);
}

// Callback query handlers for pairing
bot.action(/^pair:(.+)$/, async (ctx) => {
  const data = ctx.match[1];
  const telegramId = BigInt(ctx.from!.id);

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);

  if (data === 'not_me') {
    ctx.reply('Apakah kamu ingin mencari berdasarkan NIK?', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Cari via NIK', callback_data: 'pair:ask_nik' }],
          [{ text: '❌ Tidak', callback_data: 'pair:disable' }],
        ],
      },
    });
  } else if (data === 'ask_nik') {
    awaitingNik.add(Number(telegramId));
    ctx.reply('Silakan kirim NIK kamu:');
  } else if (data === 'disable') {
    ctx.reply('Fitur schedule dinonaktifkan. Kirim /schedule kapan saja untuk mencoba lagi.');
  } else {
    // data is employeeNik — pair and auto-show schedule
    await pairUserSchedule(telegramId, data);
    const emp = await findEmployeeByNik(data);
    ctx.reply(`✅ Berhasil! Akun kamu terhubung dengan:\n\n👤 ${emp?.name}\n🆔 ${data}`);
    await showSchedule(ctx, telegramId);
  }
});

// Handle NIK text input
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;

  if (!awaitingNik.has(userId)) {
    return next();
  }

  awaitingNik.delete(userId);
  const nik = ctx.message.text.trim();
  const telegramId = BigInt(userId);

  const emp = await findEmployeeByNik(nik);
  if (emp) {
    await pairUserSchedule(telegramId, emp.employeeNik);
    ctx.reply(`✅ Berhasil! Akun kamu terhubung dengan:\n\n👤 ${emp.name}\n💼 ${emp.jobTitle}\n🆔 ${emp.employeeNik}`);
    await showSchedule(ctx, telegramId);
  } else {
    ctx.reply(`❌ NIK "${nik}" tidak ditemukan.\n\nIngin mencoba lagi?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Coba lagi', callback_data: 'pair:ask_nik' }],
          [{ text: '❌ Tidak', callback_data: 'pair:disable' }],
        ],
      },
    });
  }
});

// --- Commands ---

bot.command('start', (ctx) => {
  ctx.reply(
    'Selamat datang! 👋\n\n' +
    '/login — hubungkan akun Google\n' +
    '/status — cek status\n' +
    '/schedule — jadwal WFO\n' +
    '/check_in — absen masuk\n' +
    '/check_out — absen pulang\n' +
    '/logout — hapus koneksi akun'
  );
});

bot.command('login', async (ctx) => {
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
  if (user) {
    ctx.reply(`Kamu sudah login sebagai ${user.googleEmail}.\n\nGunakan /logout terlebih dahulu jika ingin login ulang.`);
    return;
  }

  ctx.reply('Klik tombol di bawah untuk verifikasi akun Google Anda:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔐 Verifikasi Akun', web_app: { url: FRONTEND_URL } }],
      ],
    },
  });
});

bot.command('schedule', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    ctx.reply('❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  await showSchedule(ctx, telegramId);
});

bot.command('check_in', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    ctx.reply('❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  const now = nowWIB();
  const today = todayDateWIB();

  const day = now.getDay();
  if (day === 0 || day === 6) {
    ctx.reply('❌ Check-in hanya bisa dilakukan di hari kerja (Senin-Jumat).');
    return;
  }

  if (now.getHours() < 8) {
    ctx.reply('❌ Check-in hanya bisa dilakukan mulai jam 08:00 WIB.');
    return;
  }

  const onLeave = await isUserOnLeave(telegramId, now);
  if (onLeave) {
    ctx.reply('❌ Kamu sedang cuti hari ini. Tidak perlu check-in.');
    return;
  }

  const existing = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });
  if (existing) {
    ctx.reply(`❌ Kamu sudah check-in hari ini (${formatTime(existing.checkIn)}).`);
    return;
  }

  const realNow = new Date();
  await prisma.attendance.create({
    data: { telegramId, date: today, checkIn: realNow },
  });

  ctx.reply(`✅ Check-in berhasil!\n\n🕐 ${formatTime(realNow)}`);
});

bot.command('check_out', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    ctx.reply('❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  const now = nowWIB();
  const today = todayDateWIB();

  const attendance = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });
  if (!attendance) {
    ctx.reply('❌ Kamu belum check-in hari ini. Gunakan /check_in terlebih dahulu.');
    return;
  }

  if (attendance.checkOut) {
    ctx.reply(`❌ Kamu sudah check-out hari ini (${formatTime(attendance.checkOut)}).`);
    return;
  }

  if (now.getHours() < 18) {
    ctx.reply('❌ Check-out hanya bisa dilakukan mulai jam 18:00 WIB.');
    return;
  }

  const realNow = new Date();
  const diffHours = (realNow.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
  if (diffHours < 8) {
    const remaining = Math.ceil((8 - diffHours) * 60);
    ctx.reply(`❌ Minimal 8 jam setelah check-in. Sisa ${remaining} menit lagi.`);
    return;
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { checkOut: realNow },
  });

  const durationHours = Math.floor(diffHours);
  const durationMins = Math.round((diffHours - durationHours) * 60);

  ctx.reply(`✅ Check-out berhasil!\n\n🕐 ${formatTime(realNow)}\n⏱️ Durasi kerja: ${durationHours}j ${durationMins}m`);
});

bot.command('status', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    ctx.reply('❌ Belum terverifikasi. Gunakan /login untuk menghubungkan akun Google.');
    return;
  }

  const today = todayDateWIB();
  const attendance = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });

  let attendanceInfo = '\n\n📋 Absensi hari ini:\n';
  if (!attendance) {
    attendanceInfo += '  Belum check-in';
  } else {
    attendanceInfo += `  Check-in: ${formatTime(attendance.checkIn)}`;
    if (attendance.checkOut) {
      attendanceInfo += `\n  Check-out: ${formatTime(attendance.checkOut)}`;
      const diff = (attendance.checkOut.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
      attendanceInfo += `\n  Durasi: ${Math.floor(diff)}j ${Math.round((diff % 1) * 60)}m`;
    } else {
      attendanceInfo += '\n  Check-out: Belum';
    }
  }

  ctx.reply(`✅ Akun terverifikasi\n\n📧 ${user.googleEmail}${attendanceInfo}`);
});

bot.command('logout', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    ctx.reply('Kamu belum menghubungkan akun Google.');
    return;
  }

  await prisma.user.delete({ where: { telegramId } });
  ctx.reply(`🔓 Akun Google (${user.googleEmail}) berhasil di-unlink.`);
});

const BOT_COMMANDS = [
  { command: 'start', description: 'Lihat daftar perintah' },
  { command: 'login', description: 'Hubungkan akun Google' },
  { command: 'logout', description: 'Hapus koneksi akun Google' },
  { command: 'status', description: 'Cek status verifikasi & absensi hari ini' },
  { command: 'schedule', description: 'Lihat jadwal WFO minggu ini & minggu depan' },
  { command: 'check_in', description: 'Absen masuk (min. 08:00 WIB)' },
  { command: 'check_out', description: 'Absen pulang (min. 18:00 WIB)' },
];

export function launchBot(app?: Express) {
  const mode = process.env.BOT_MODE || 'polling';

  bot.telegram.setMyCommands(BOT_COMMANDS);

  if (mode === 'webhook') {
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    const webhookUrl = `${process.env.WEBHOOK_DOMAIN}${webhookPath}`;

    app?.use(bot.webhookCallback(webhookPath));
    bot.telegram.setWebhook(webhookUrl);
    console.log(`Bot running in webhook mode: ${webhookPath}`);
  } else {
    bot.launch();
    console.log('Bot running in polling mode');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  }
}
