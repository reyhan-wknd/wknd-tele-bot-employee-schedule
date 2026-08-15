import 'dotenv/config';
import { prisma } from '../db';
import { fetchAllSchedules } from '../services/supabase';
import { assertSyncSane } from '../lib/sync-guard';

export async function syncSchedules() {
  console.log(`[${new Date().toISOString()}] Starting schedule sync...`);

  try {
    const records = await fetchAllSchedules();
    const existing = await prisma.schedule.count();
    console.log(
      `[${new Date().toISOString()}] Fetched ${records.length} records from Supabase (database: ${existing})`
    );

    // Sync mengganti seluruh isi tabel, jadi hasil fetch diperiksa kewajarannya dulu.
    assertSyncSane(records.length, existing);

    await prisma.$transaction([
      prisma.schedule.deleteMany(),
      prisma.schedule.createMany({
        data: records.map((r) => ({
          employeeNik: r.employeeNik,
          jobTitle: r.jobTitle,
          name: r.name,
          projectName: r.projectName,
          date: new Date(r.date + 'T00:00:00.000Z'),
        })),
      }),
    ]);

    console.log(`[${new Date().toISOString()}] Sync complete. Inserted ${records.length} records.`);
  } catch (err) {
    // Dipanggil scheduler di dalam proses yang berumur panjang: cukup dicatat, jangan
    // dilempar sampai jadi unhandled rejection yang mematikan bot.
    console.error(`[${new Date().toISOString()}] Sync failed:`, err);
  }
}

// Tetap bisa dijalankan manual: npx tsx src/cron/sync-schedules.ts
if (typeof require !== 'undefined' && require.main === module) {
  void syncSchedules().finally(() => prisma.$disconnect());
}
