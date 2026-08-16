import crypto from 'crypto';
import type { Context } from 'telegraf';
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
  isoDateOf,
  todayWIB,
  weekdayOf,
} from './lib/time';
import { formatProjects, groupSchedulesByDate } from './lib/schedule';
import { bolehCheckin, bolehCheckout, durasiKerja, selisihJam } from './services/attendance';
import { createBot } from './lib/telegram';
import { ADMIN_TELEGRAM_IDS, isAdmin } from './config';
import { parsePerintahKelola, TAHUN_BERULANG } from './lib/holiday';
import {
  cariLibur,
  daftarUpcoming,
  hapusLibur,
  labelLibur,
  tambahLibur,
  ubahLabelLibur,
} from './services/holiday';

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
async function reply(ctx: Context, text: string, extra?: Parameters<Context['reply']>[1]): Promise<void> {
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

/**
 * Gerbang yang sama dipakai lima perintah: pastikan user sudah menautkan akun Google,
 * lalu kembalikan barisnya. Mengembalikan null berarti pemanggil cukup berhenti.
 */
async function requireUser(ctx: Context) {
  const telegramId = BigInt(ctx.from!.id);
  const user = await prisma.user.findUnique({ where: { telegramId } });

  if (!user) {
    await reply(ctx, '❌ Kamu belum terverifikasi. Gunakan /login terlebih dahulu.');
    return null;
  }

  return { telegramId, user };
}

// --- Schedule Pairing ---

/**
 * Ambil NIK karyawan yang tersimpan. Kalau belum ada, tautkan lewat email yang sudah
 * diverifikasi Google — identitas tidak pernah ditanyakan ke user, jadi tidak ada NIK
 * yang bisa dipaksakan dari sisi klien.
 */
async function resolveEmployeeNik(ctx: Context, telegramId: bigint, googleEmail: string): Promise<string | null> {
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

async function showSchedule(ctx: Context, telegramId: bigint, googleEmail: string) {
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

  // Jadwal hari ini sudah termuat di hasil query di atas (gte today), jadi cukup disaring.
  const todaySchedule = schedules.filter((s) => s.date.getTime() === today.getTime());
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
  const sesi = await requireUser(ctx);
  if (!sesi) return;
  const { telegramId, user } = sesi;

  await showSchedule(ctx, telegramId, user.googleEmail);
});

/**
 * Bagian check-in setelah semua gerbang waktu lolos. Dipisah karena dipakai dua jalur:
 * langsung dari /check_in, dan dari tombol konfirmasi saat hari itu terdaftar libur.
 */
async function lakukanCheckin(
  ctx: Context,
  telegramId: bigint,
  user: { accessToken: string | null; refreshToken: string | null }
): Promise<string> {
  const today = todayWIB();

  if (await isUserOnLeave({ telegramId, ...user })) {
    return '❌ Kamu sedang cuti hari ini. Tidak perlu check-in.';
  }

  const existing = await prisma.attendance.findUnique({
    where: { telegramId_date: { telegramId, date: today } },
  });
  if (existing) {
    return `❌ Kamu sudah check-in hari ini (${formatTimeWIB(existing.checkIn)}).`;
  }

  const realNow = new Date();
  await prisma.attendance.create({
    data: { telegramId, date: today, checkIn: realNow },
  });

  return `✅ Check-in berhasil!\n\n🕐 ${formatTimeWIB(realNow)}`;
}

bot.command('check_in', async (ctx) => {
  const sesi = await requireUser(ctx);
  if (!sesi) return;
  const { telegramId, user } = sesi;

  const today = todayWIB();

  const izin = bolehCheckin(weekdayOf(today), hourWIB());
  if (!izin.boleh) {
    await reply(
      ctx,
      izin.alasan === 'akhir-pekan'
        ? '❌ Check-in hanya bisa dilakukan di hari kerja (Senin-Jumat).'
        : '❌ Check-in hanya bisa dilakukan mulai jam 08:00 WIB.'
    );
    return;
  }

  // Hari libur tidak menutup check-in — sebagian orang memang masuk. Tapi jangan sampai
  // tercatat karena salah pencet, jadi minta konfirmasi dulu.
  const libur = await labelLibur(today);
  if (libur) {
    await reply(ctx, `📅 Hari ini terdaftar libur: *${libur}*.\n\nTetap mau check-in?`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Ya, tetap check-in', callback_data: `ci:ok:${isoDateOf(today)}` },
            { text: '❌ Batal', callback_data: `ci:batal:${isoDateOf(today)}` },
          ],
        ],
      },
    });
    return;
  }

  await reply(ctx, await lakukanCheckin(ctx, telegramId, user));
});

/**
 * Tombol konfirmasi check-in di hari libur.
 *
 * Tanggalnya ikut dibawa di callback_data dan dicocokkan ulang: tombol kemarin yang
 * di-scroll lagi hari ini tidak boleh mencatat absensi untuk hari yang salah.
 */
bot.action(/^ci:(ok|batal):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => undefined);

  const [, pilihan, tanggal] = ctx.match;
  const hariIni = isoDateOf(todayWIB());

  const selesai = async (teks: string) => {
    try {
      await ctx.editMessageText(teks);
    } catch {
      await reply(ctx, teks);
    }
  };

  if (tanggal !== hariIni) {
    await selesai('⌛ Tombol ini sudah kedaluwarsa karena harinya sudah berganti. Kirim /check_in lagi.');
    return;
  }

  if (pilihan === 'batal') {
    await selesai('👍 Check-in dibatalkan. Selamat berlibur!');
    return;
  }

  const sesi = await requireUser(ctx);
  if (!sesi) return;

  await selesai(await lakukanCheckin(ctx, sesi.telegramId, sesi.user));
});

bot.command('check_out', async (ctx) => {
  const sesi = await requireUser(ctx);
  if (!sesi) return;
  const { telegramId, user } = sesi;

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
  const realNow = new Date();
  const jamKerja = selisihJam(attendance.checkIn, realNow);

  const izin = bolehCheckout({ lanjutanKemarin, jamWIB: hourWIB(), jamKerja });
  if (!izin.boleh) {
    await reply(
      ctx,
      izin.alasan === 'belum-jam-pulang'
        ? '❌ Check-out hanya bisa dilakukan mulai jam 18:00 WIB.'
        : `❌ Minimal 8 jam setelah check-in. Sisa ${izin.sisaMenit} menit lagi.`
    );
    return;
  }

  await prisma.attendance.update({
    where: { id: attendance.id },
    data: { checkOut: realNow },
  });

  const durasi = durasiKerja(jamKerja);

  const keterangan = lanjutanKemarin ? `\n📅 Untuk absensi ${formatDateOnly(attendance.date)}` : '';
  await reply(
    ctx,
    `✅ Check-out berhasil!\n\n🕐 ${formatTimeWIB(realNow)}\n⏱️ Durasi kerja: ${durasi.jam}j ${durasi.menit}m${keterangan}`
  );
});

bot.command('status', async (ctx) => {
  const sesi = await requireUser(ctx);
  if (!sesi) return;
  const { telegramId, user } = sesi;

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
      const durasi = durasiKerja(selisihJam(attendance.checkIn, attendance.checkOut));
      attendanceInfo += `\n  Durasi: ${durasi.jam}j ${durasi.menit}m`;
    } else {
      attendanceInfo += '\n  Check-out: Belum';
    }
  }

  await reply(ctx, `✅ Akun terverifikasi\n\n📧 ${user.googleEmail}${attendanceInfo}`);
});

bot.command('logout', async (ctx) => {
  const sesi = await requireUser(ctx);
  if (!sesi) return;
  const { telegramId, user } = sesi;

  await unlinkUser(telegramId);
  await reply(ctx, `🔓 Akun Google (${user.googleEmail}) berhasil di-unlink.`);
});

// --- Hari Libur ---

bot.command('holiday', async (ctx) => {
  const daftar = await daftarUpcoming();

  if (daftar.length === 0) {
    await reply(
      ctx,
      '📅 Belum ada hari libur terdaftar untuk 365 hari ke depan.\n\nHubungi admin untuk mengisinya.'
    );
    return;
  }

  let msg = '📅 Hari libur 365 hari ke depan:\n\n';
  for (const libur of daftar) {
    msg += `  • ${formatDateOnly(libur.tanggal)} — ${libur.label}${libur.berulang ? ' 🔁' : ''}\n`;
  }
  msg += '\n🔁 = berulang tiap tahun';

  await reply(ctx, msg);
});

/**
 * Hanya admin. Menyembunyikan perintah ini dari menu Telegram sifatnya kosmetik —
 * siapa pun tetap bisa mengetiknya — jadi pemeriksaan di sini yang menahan sungguhan.
 */
bot.command('manage_holiday', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await reply(ctx, '❌ Perintah ini hanya untuk admin.');
    return;
  }

  const sisa = ctx.message.text.replace(/^\/manage_holiday(@\S+)?/, '');
  const perintah = parsePerintahKelola(sisa);
  if (!perintah.ok) {
    await reply(ctx, `❌ ${perintah.pesan}`);
    return;
  }

  const { aksi, tanggal, label } = perintah.nilai;
  const berulang = tanggal.year === TAHUN_BERULANG;
  const tampilTanggal = berulang
    ? `${String(tanggal.day).padStart(2, '0')}-${String(tanggal.month).padStart(2, '0')} (tiap tahun)`
    : `${String(tanggal.day).padStart(2, '0')}-${String(tanggal.month).padStart(2, '0')}-${tanggal.year}`;

  const sudahAda = await cariLibur(tanggal);

  if (aksi === 'add') {
    if (sudahAda) {
      await reply(ctx, `❌ ${tampilTanggal} sudah terdaftar sebagai "${sudahAda.label}".\n\nPakai edit untuk mengubah labelnya.`);
      return;
    }
    await tambahLibur(tanggal, label);
    await reply(ctx, `✅ Ditambahkan: ${tampilTanggal} — ${label}`);
    return;
  }

  if (!sudahAda) {
    await reply(ctx, `❌ ${tampilTanggal} belum terdaftar sebagai hari libur.`);
    return;
  }

  if (aksi === 'edit') {
    await ubahLabelLibur(tanggal, label);
    await reply(ctx, `✅ Diubah: ${tampilTanggal}\n\n"${sudahAda.label}" → "${label}"`);
    return;
  }

  await hapusLibur(tanggal);
  await reply(ctx, `🗑️ Dihapus: ${tampilTanggal} — ${sudahAda.label}`);
});

/** Daftar perintah yang muncul di menu Telegram untuk semua orang. */
const BOT_COMMANDS = [
  { command: 'start', description: 'Lihat daftar perintah' },
  { command: 'login', description: 'Hubungkan akun Google' },
  { command: 'logout', description: 'Hapus koneksi akun Google' },
  { command: 'status', description: 'Cek status verifikasi & absensi hari ini' },
  { command: 'schedule', description: 'Lihat jadwal WFO minggu ini & minggu depan' },
  { command: 'holiday', description: 'Lihat hari libur 365 hari ke depan' },
  { command: 'check_in', description: 'Absen masuk (min. 08:00 WIB)' },
  { command: 'check_out', description: 'Absen pulang (min. 18:00 WIB)' },
];

/** Menu admin: sama seperti di atas, ditambah pengelolaan hari libur. */
const ADMIN_COMMANDS = [
  ...BOT_COMMANDS,
  { command: 'manage_holiday', description: 'Kelola hari libur (admin)' },
];

/**
 * Menu per-admin dipasang dengan scope chat, jadi /manage_holiday tidak muncul di menu
 * user biasa. Ini semata kerapian tampilan — gerbang sesungguhnya ada di handler.
 */
async function daftarkanMenuPerintah() {
  await bot.telegram
    .setMyCommands(BOT_COMMANDS)
    .catch((err) => console.error('Gagal mendaftarkan daftar perintah:', errorMessage(err)));

  for (const adminId of ADMIN_TELEGRAM_IDS) {
    await bot.telegram
      .setMyCommands(ADMIN_COMMANDS, { scope: { type: 'chat', chat_id: Number(adminId) } })
      .catch((err) => console.error(`Gagal mendaftarkan menu admin untuk ${adminId}:`, errorMessage(err)));
  }
}

export async function launchBot(app?: Express) {
  const mode = process.env.BOT_MODE || 'polling';

  // Gagal mendaftarkan menu perintah tidak boleh menghentikan startup.
  await daftarkanMenuPerintah();

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
