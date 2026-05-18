import 'dotenv/config';
import { prisma } from '../db';
import { fetchAllSchedules } from '../services/supabase';

async function syncSchedules() {
  const startTime = new Date().toISOString();
  console.log(`[${startTime}] Starting schedule sync...`);

  try {
    const records = await fetchAllSchedules();
    console.log(`[${new Date().toISOString()}] Fetched ${records.length} records from Supabase`);

    // Truncate + insert in transaction
    await prisma.$transaction([
      prisma.schedule.deleteMany(),
      prisma.schedule.createMany({
        data: records.map((r) => ({
          employeeNik: r.employeeNik,
          jobTitle: r.jobTitle,
          name: r.name,
          status: r.status,
          projectName: r.projectName,
          date: new Date(r.date + 'T00:00:00.000Z'),
        })),
      }),
    ]);

    console.log(`[${new Date().toISOString()}] Sync complete. Inserted ${records.length} records.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync failed:`, err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

syncSchedules();
