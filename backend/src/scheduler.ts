import cron from 'node-cron';
import { sendCheckInReminders } from './cron/reminder';
import { remindTomorrow, remindNextWeek } from './cron/reminder-wfo';
import { syncSchedules } from './cron/sync-schedules';
import { checkTokens } from './cron/check-tokens';
import { jalankanJobJatuhTempo, rekonsiliasiReminderCheckout } from './services/job-queue';

const schedule = (expr: string, fn: () => Promise<void>) =>
  cron.schedule(expr, fn, { timezone: 'Asia/Jakarta' });

export function startScheduler() {
  schedule('0 20 * * *',   syncSchedules);          // setiap hari 20:00
  schedule('0 8 * * 1-5',  checkTokens);            // Sen-Jum 08:00
  schedule('5 9 * * 1-5',  sendCheckInReminders);   // Sen-Jum 09:05
  schedule('30 9 * * 1-5', sendCheckInReminders);   // Sen-Jum 09:30
  schedule('50 9 * * 1-5', sendCheckInReminders);   // Sen-Jum 09:50
  schedule('0 21 * * 1-4', remindTomorrow);         // Sen-Kam 21:00
  schedule('0 21 * * 5',   remindNextWeek);         // Jumat 21:00

  // Reminder check-out tidak lagi berupa cron massal: jam pulang tiap orang berbeda, jadi
  // job-nya dijadwalkan per orang saat check-in dan diambil worker ini tiap menit.
  schedule('* * * * *', jalankanJobJatuhTempo);

  console.log('Scheduler started (8 jobs registered)');

  // Absensi yang masih terbuka saat proses start dipastikan punya job-nya.
  void rekonsiliasiReminderCheckout().catch((err) =>
    console.error('Rekonsiliasi reminder check-out gagal:', err)
  );
}
