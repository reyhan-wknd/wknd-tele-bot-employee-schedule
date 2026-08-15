import crypto from 'crypto';
import type { Express } from 'express';
import { prisma } from './db';
import { isUserOnLeave } from './services/calendar';
import { getUserPairing, pairUserByEmail } from './services/schedule';
import { unlinkUser } from './services/user';
import {
  addDays,
  formatDateOnly,
  formatTimeWIB,
  hourWIB,
  todayWIB,
  weekdayOf,
} from './lib/time';
import { formatProjects, groupSchedulesByDate } from './lib/schedule';
import { createBot } from './lib/telegram';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const FRONTEND_URL = process.env.FRONTEND_URL!;

export const bot = createBot(BOT_TOKEN);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Telegram bisa menolak balasan karena alasan yang wajar — user memblokir bot, pesan
 * terlalu tua, rate limit. Itu tidak boleh menjadi rejection yang menjatuhkan proses.
 */
async function reply(ctx: any, text: string, extra?: Record<string, unknown>): Promise<void> {
  try {
    await ctx.reply(text, extra);
  } catch (err) {
    console.error(`Gagal mengirim balasan ke ${ctx.from?.id}:`, errorMessage(err));
  }
}

// Semua perintah bersifat pribadi — email, jadwal, dan absensi tidak boleh tampil di
// grup hanya karena bot ikut ditambahkan ke sana.
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') {
    await reply(ctx, '🔒 Perintah bot ini hanya bisa dipakai di chat pribadi. Silakan DM saya.');
    return;
  }
  return next();
});

// Jaring terakhir: error apa pun di dalam handler ditangkap di sini, bukan dilempar
// ke event loop sebagai unhandled rejection.
bot.catch((err, ctx) => {
  console.error(`Error saat memproses update ${ctx.updateType} dari ${ctx.from?.id}:`, errorMessage(err));
  void reply(ctx, '⚠️ Terjadi kesalahan di sisi server. Coba lagi beberapa saat.');
});

// --- Schedule Pairing ---

/**
 * Ambil NIK karyawan yang tersimpan. Kalau belum ada, tautkan lewat email yang sudah
 * diverifikasi Google — identitas tidak pernah ditanyakan ke user, jadi tidak ada NIK
 * yang bisa dipaksakan dari sisi klien.
 */
async function resolveEmployeeNik(ctx: any, telegramId: bigint, googleEmail: string): Promise<string | null> {
  const pairing = await getUserPairing(telegramId);
  if (pairing) return pairing.employeeNik;

  try {
    const employee = await pairUserByEmail(telegramId, googleEmail);
    if (employee) {
      await reply(
        ctx,
        `📇 Terhubung dengan data karyawan:\n\n👤 ${employee.name}\n💼 ${employee.jobTitle}\n🆔 ${employee.employeeNik}`
      );
      return employee.employeeNik;
    }

    await reply(
      ctx,
      `❌ Data karyawan dengan email ${googleEmail} belum ditemukan.\n\nHubungi admin untuk melengkapi data kamu, lalu coba /schedule lagi.`
    );
  } catch (err) {
    console.error('Pairing karyawan gagal:', err);
    await reply(ctx, '⚠️ Data karyawan sedang tidak bisa diakses. Coba /schedule lagi beberapa saat.');
  }

  return null;
}

// --- Schedule Display ---

async function showSchedule(ctx: any, telegramId: bigint, googleEmail: string) {
  const employeeNik = await resolveEmployeeNik(ctx, telegramId, googleEmail);
  if (!employeeNik) return;

  const today = todayWIB();
  const weekday = weekdayOf(today); // 0=Minggu, 6=Sabtu
  const sunday = addDays(today, -weekday);
  const saturday = addDays(sunday, 6); // batas minggu ini
  const nextSaturday = addDays(sunday, 13); // batas minggu depan

  const schedules = await prisma.schedule.findMany({
    where: {
      employeeNik,
      date: { gte: today, lte: nextSaturday },
    },
    orderBy: { date: 'asc' },
  });

  const thisWeek = schedules.filter((s) => s.date <= saturday);
  const nextWeek = schedules.filter((s) => s.date > saturday);

  let msg = '📅 Jadwal WFO kamu:\n';

  // Today's status
  const todaySchedule = await prisma.schedule.findMany({
    where: { employeeNik, date: today },
  });
  // Data jadwal didahulukan: ada kalanya proyek menjadwalkan WFO di akhir pekan, dan
  // dulu hari itu tetap tertulis "Day Off" karena harinya diperiksa lebih dulu.
  let todayStatus: string;
  if (todaySchedule.length > 0) {
    todayStatus = `🏢 WFO (${todaySchedule.map((s) => s.projectName).join(', ')})`;
  } else if (weekday === 0 || weekday === 6) {
    todayStatus = '🏖️ Day Off';
  } else {
    todayStatus = '🏠 WFH';
  }
  msg += `\n📍 Hari ini: ${todayStatus}\n`;

  msg += '\n📌 Minggu ini:\n';
  const thisWeekGrouped = groupSchedulesByDate(thisWeek);
  if (thisWeekGrouped.length > 0) {
    for (const g of thisWeekGrouped) {
      msg += `  • ${formatDateOnly(g.date)} — ${formatProjects(g)}\n`;
    }
  } else {
    msg += '  Belum ada jadwal\n';
  }

  msg += '\n📌 Minggu depan:\n';
  const nextWeekGrouped = groupSchedulesByDate(nextWeek);
  if (nextWeekGrouped.length > 0) {
    for (const g of nextWeekGrouped) {
      msg += `  • ${formatDateOnly(g.date)} — ${formatProjects(g)}\n`;
    }
  } else {
    msg += '  Belum ada jadwal\n';
  }

  await reply(ctx, msg);
}

// --- Commands ---

bot.command('start', async (ctx) => {
  await reply(ctx,
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
    await reply(ctx, `Kamu sudah login sebagai ${user.googleEmail}.\n\nGunakan /logout terlebih dahulu jika ingin login ulang.`);
    return;
  }

  await reply(ctx, 'Klik tombol di bawah untuk verifikasi akun Google Anda:', {
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
    await reply(ctx, '❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  await showSchedule(ctx, telegramId, user.googleEmail);
});

bot.command('check_in', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await reply(ctx, '❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  const today = todayWIB();

  const weekday = weekdayOf(today);
  if (weekday === 0 || weekday === 6) {
    await reply(ctx, '❌ Check-in hanya bisa dilakukan di hari kerja (Senin-Jumat).');
    return;
  }

  if (hourWIB() < 8) {
    await reply(ctx, '❌ Check-in hanya bisa dilakukan mulai jam 08:00 WIB.');
    return;
  }

  const onLeave = await isUserOnLeave(telegramId);
  if (onLeave) {
    await reply(ctx, '❌ Kamu sedang cuti hari ini. Tidak perlu check-in.');
    return;
  }

  const existing = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });
  if (existing) {
    await reply(ctx, `❌ Kamu sudah check-in hari ini (${formatTimeWIB(existing.checkIn)}).`);
    return;
  }

  const realNow = new Date();
  await prisma.attendance.create({
    data: { telegramId, date: today, checkIn: realNow },
  });

  await reply(ctx, `✅ Check-in berhasil!\n\n🕐 ${formatTimeWIB(realNow)}`);
});

bot.command('check_out', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);

  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    await reply(ctx, '❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return;
  }

  const today = todayWIB();
  const kemarin = addDays(today, -1);

  const hariIni = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });

  if (hariIni?.checkOut) {
    await reply(ctx, `❌ Kamu sudah check-out hari ini (${formatTimeWIB(hariIni.checkOut)}).`);
    return;
  }

  // Absensi kemarin yang belum ditutup masih boleh diselesaikan lewat tengah malam —
  // dulu tanggalnya sudah berganti dan barisnya tertinggal terbuka selamanya.
  const attendance =
    hariIni ??
    (await prisma.attendance.findFirst({
      where: { telegramId, date: kemarin, checkOut: null },
    }));

  if (!attendance) {
    await reply(ctx, '❌ Kamu belum check-in hari ini. Gunakan /check_in terlebih dahulu.');
    return;
  }

  const lanjutanKemarin = attendance.date.getTime() !== today.getTime();

  // Batas jam 18:00 hanya berlaku untuk shift hari ini; yang lewat tengah malam sudah
  // jelas melewatinya, dan tetap dijaga aturan minimal 8 jam di bawah.
  if (!lanjutanKemarin && hourWIB() < 18) {
    await reply(ctx, '❌ Check-out hanya bisa dilakukan mulai jam 18:00 WIB.');
    return;
  }

  const realNow = new Date();
  const diffHours = (realNow.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
  if (diffHours < 8) {
    const remaining = Math.ceil((8 - diffHours) * 60);
    await reply(ctx, `❌ Minimal 8 jam setelah check-in. Sisa ${remaining} menit lagi.`);
    return;
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { checkOut: realNow },
  });

  const durationHours = Math.floor(diffHours);
  const durationMins = Math.round((diffHours - durationHours) * 60);

  const keterangan = lanjutanKemarin ? `\n📅 Untuk absensi ${formatDateOnly(attendance.date)}` : '';
  await reply(
    ctx,
    `✅ Check-out berhasil!\n\n🕐 ${formatTimeWIB(realNow)}\n⏱️ Durasi kerja: ${durationHours}j ${durationMins}m${keterangan}`
  );
});

bot.command('status', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    await reply(ctx, '❌ Belum terverifikasi. Gunakan /login untuk menghubungkan akun Google.');
    return;
  }

  const today = todayWIB();
  const attendance = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });

  let attendanceInfo = '\n\n📋 Absensi hari ini:\n';
  if (!attendance) {
    attendanceInfo += '  Belum check-in';
  } else {
    attendanceInfo += `  Check-in: ${formatTimeWIB(attendance.checkIn)}`;
    if (attendance.checkOut) {
      attendanceInfo += `\n  Check-out: ${formatTimeWIB(attendance.checkOut)}`;
      const diff = (attendance.checkOut.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
      attendanceInfo += `\n  Durasi: ${Math.floor(diff)}j ${Math.round((diff % 1) * 60)}m`;
    } else {
      attendanceInfo += '\n  Check-out: Belum';
    }
  }

  await reply(ctx, `✅ Akun terverifikasi\n\n📧 ${user.googleEmail}${attendanceInfo}`);
});

bot.command('logout', async (ctx) => {
  const telegramId = BigInt(ctx.from.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    await reply(ctx, 'Kamu belum menghubungkan akun Google.');
    return;
  }

  await unlinkUser(telegramId);
  await reply(ctx, `🔓 Akun Google (${user.googleEmail}) berhasil di-unlink.`);
});

export async function launchBot(app?: Express) {
  const mode = process.env.BOT_MODE || 'polling';

  if (mode === 'webhook') {
    // Path tidak lagi memuat BOT_TOKEN: dulu token itu ikut tercetak ke log setiap
    // start. Diturunkan dari token supaya tetap stabil tanpa env baru.
    const turunan = (label: string, panjang: number) =>
      crypto.createHmac('sha256', BOT_TOKEN).update(label).digest('hex').slice(0, panjang);

    const webhookPath = `/webhook/${turunan('webhook-path-v1', 32)}`;
    const secretToken = turunan('webhook-secret-token-v1', 64);
    const webhookUrl = `${process.env.WEBHOOK_DOMAIN}${webhookPath}`;

    // secretToken membuat Telegram mengirim header rahasia di tiap update, jadi
    // kerahasiaan URL bukan lagi satu-satunya penjaga.
    app?.use(bot.webhookCallback(webhookPath, { secretToken }));

    // Kegagalan mendaftarkan webhook tidak boleh menjatuhkan server yang sudah listen —
    // pernah terjadi: satu ETIMEDOUT ke api.telegram.org mematikan seluruh proses.
    try {
      await bot.telegram.setWebhook(webhookUrl, { secret_token: secretToken });
      console.log('Bot berjalan mode webhook, registrasi berhasil');
    } catch (err) {
      console.error('Gagal mendaftarkan webhook, server tetap jalan:', errorMessage(err));
    }
  } else {
    // bot.launch() baru selesai saat bot berhenti, jadi cukup pasang penangkap errornya.
    bot.launch().catch((err) => console.error('Bot polling berhenti karena error:', errorMessage(err)));
    console.log('Bot berjalan mode polling');
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`Menerima ${signal}, mematikan bot...`);
      if (mode !== 'webhook') bot.stop(signal);
      process.exit(0);
    });
  }
}
