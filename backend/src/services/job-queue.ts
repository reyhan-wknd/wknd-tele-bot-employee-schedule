/**
 * Antrean pekerjaan tertunda sederhana di atas MySQL.
 *
 * Reminder check-out tidak lagi disapu cron massal, melainkan dijadwalkan per orang saat
 * check-in — karena jam pulang tiap orang berbeda, dan cron jam 18:00 ikut menagih yang
 * baru masuk jam 14:00.
 *
 * Kenapa tabel, bukan `setTimeout`: proses di-restart tiap deploy, dan timer di memori
 * hilang tanpa jejak. Kenapa bukan Redis: server belum punya, dan menambah satu container
 * demi antrean sekecil ini tidak sepadan sementara MySQL dan node-cron sudah ada.
 */
import { prisma } from '../db';
import { createBot, diblokirUser, retryAfter } from '../lib/telegram';
import { ambangCheckout, batasReminder } from './attendance';

export const JENIS_REMINDER_CHECKOUT = 'checkout-reminder';

const JEDA_REMINDER_MS = 60 * 60 * 1000;

/** Satu putaran worker memproses paling banyak ini, supaya tidak menahan event loop. */
const MAKS_JOB_PER_PUTARAN = 50;

const bot = createBot(process.env.BOT_TOKEN!);

/**
 * Jadwalkan reminder berikutnya. Dilewati bila sudah melewati batas — dan itu memang
 * jawaban yang benar untuk yang check-in sore: absensinya ditutup besok lewat jalur
 * koreksi jam manual, bukan ditagih tengah malam.
 */
async function jadwalkan(
  telegramId: bigint,
  attendanceId: number,
  runAt: Date,
  tanggalAbsensi: Date
): Promise<boolean> {
  if (runAt > batasReminder(tanggalAbsensi)) return false;

  await prisma.scheduledJob.create({
    data: { type: JENIS_REMINDER_CHECKOUT, telegramId, attendanceId, runAt, status: 'pending' },
  });
  return true;
}

/** Dipanggil setelah check-in berhasil. Reminder pertama jatuh tepat di ambang jam pulang. */
export async function jadwalkanReminderCheckout(
  telegramId: bigint,
  attendanceId: number,
  checkIn: Date,
  tanggalAbsensi: Date
): Promise<boolean> {
  const { ambang } = ambangCheckout(checkIn);
  return jadwalkan(telegramId, attendanceId, ambang, tanggalAbsensi);
}

/**
 * Dipanggil setelah check-out berhasil. Ini sekadar kerapian — penjaga sebenarnya tetap
 * pemeriksaan `checkOut` di dalam job, karena balapan antara check-out dan job yang sedang
 * berjalan selalu mungkin terjadi.
 */
export async function batalkanReminderCheckout(attendanceId: number): Promise<void> {
  await prisma.scheduledJob.updateMany({
    where: { attendanceId, status: 'pending' },
    data: { status: 'cancelled' },
  });
}

async function kirim(telegramId: bigint, teks: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(Number(telegramId), teks);
  } catch (err) {
    const tunggu = retryAfter(err);
    if (tunggu !== null) {
      await new Promise((r) => setTimeout(r, tunggu * 1000));
      await bot.telegram.sendMessage(Number(telegramId), teks).catch((err2) => {
        console.error(`Reminder check-out ke ${telegramId} gagal setelah diulang:`, err2);
      });
      return;
    }

    if (diblokirUser(err)) {
      console.warn(`${telegramId} memblokir bot, reminder check-out dilewati`);
      return;
    }
    console.error(`Reminder check-out ke ${telegramId} gagal:`, err);
  }
}

async function prosesJob(job: {
  id: number;
  telegramId: bigint;
  attendanceId: number;
}): Promise<void> {
  const absensi = await prisma.attendance.findUnique({ where: { id: job.attendanceId } });

  // Job ditandai selesai lebih dulu: kalau pengiriman gagal, yang hilang cuma satu
  // reminder, bukan job yang tertinggal pending lalu ditembakkan berulang tiap menit.
  await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: 'done' } });

  if (!absensi || absensi.checkOut) return;

  // Dihitung dari sekarang, bukan dari runAt: kalau proses sempat mati beberapa jam,
  // runAt + 1 jam menghasilkan rentetan job yang semuanya sudah lewat dan menembak
  // beruntun dalam satu menit.
  const berikutnya = new Date(Date.now() + JEDA_REMINDER_MS);
  const adaLagi = await jadwalkan(job.telegramId, job.attendanceId, berikutnya, absensi.date);

  await kirim(
    job.telegramId,
    adaLagi
      ? '⏰ Reminder: Kamu belum check-out. Gunakan /check_out untuk absen pulang.'
      : '⏰ Reminder terakhir: Kamu belum check-out.\n\nCheck-out terkunci pukul 23:59. Lewat dari itu, jamnya harus dimasukkan manual besok.'
  );
}

/** Dijalankan worker tiap menit. */
export async function jalankanJobJatuhTempo(): Promise<void> {
  const jobs = await prisma.scheduledJob.findMany({
    where: { status: 'pending', runAt: { lte: new Date() } },
    orderBy: { runAt: 'asc' },
    take: MAKS_JOB_PER_PUTARAN,
  });

  for (const job of jobs) {
    try {
      await prosesJob(job);
    } catch (err) {
      console.error(`Job ${job.id} gagal diproses:`, err);
    }
  }
}

/**
 * Absensi terbuka yang tidak punya job pending dibuatkan job saat start.
 *
 * Menutup celah pada hari rilis — orang yang check-in sebelum deploy kehilangan cron lama
 * tapi belum punya job — sekaligus memulihkan keadaan setelah crash.
 */
export async function rekonsiliasiReminderCheckout(): Promise<void> {
  const terbuka = await prisma.attendance.findMany({ where: { checkOut: null } });
  if (terbuka.length === 0) return;

  const punyaJob = new Set(
    (
      await prisma.scheduledJob.findMany({
        where: { status: 'pending', attendanceId: { in: terbuka.map((a) => a.id) } },
        select: { attendanceId: true },
      })
    ).map((j) => j.attendanceId)
  );

  let dibuat = 0;
  for (const absensi of terbuka) {
    if (punyaJob.has(absensi.id)) continue;

    const { ambang } = ambangCheckout(absensi.checkIn);
    // Yang ambangnya sudah lewat tetap perlu ditagih sekarang, bukan dilewati begitu saja.
    const runAt = ambang < new Date() ? new Date() : ambang;
    if (await jadwalkan(absensi.telegramId, absensi.id, runAt, absensi.date)) dibuat++;
  }

  if (dibuat > 0) console.log(`Rekonsiliasi reminder check-out: ${dibuat} job dibuat`);
}
