import cron from 'node-cron';
import { sendCheckInReminders, sendCheckOutReminders } from './cron/reminder';
import { remindTomorrow, remindNextWeek } from './cron/reminder-wfo';
import { syncSchedules } from './cron/sync-schedules';
import { checkTokens } from './cron/check-tokens';

const schedule = (expr: string, fn: () => Promise<void>) =>
  cron.schedule(expr, fn, { timezone: 'Asia/Jakarta' });

export function startScheduler() {
  schedule('0 20 * * *',   syncSchedules);          // setiap hari 20:00
  schedule('0 8 * * 1-5',  checkTokens);            // Sen-Jum 08:00
  schedule('30 9 * * 1-5', sendCheckInReminders);   // Sen-Jum 09:30
  schedule('50 9 * * 1-5', sendCheckInReminders);   // Sen-Jum 09:50
  schedule('0 18 * * 1-5', sendCheckOutReminders);  // Sen-Jum 18:00
  schedule('0 21 * * 1-5', sendCheckOutReminders);  // Sen-Jum 21:00
  schedule('0 23 * * 1-5', sendCheckOutReminders);  // Sen-Jum 23:00
  schedule('0 21 * * 1-4', remindTomorrow);         // Sen-Kam 21:00
  schedule('0 21 * * 5',   remindNextWeek);          // Jumat 21:00

  console.log('Scheduler started (9 jobs registered)');
}
