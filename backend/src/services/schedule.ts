import { prisma } from '../db';
import type { RentangDuaMinggu } from '../lib/schedule';
import { findEmployeeByEmail, type EmployeeRecord } from './supabase';

/** Jadwal WFO satu karyawan pada jendela dua minggu, terurut tanggal. */
export async function ambilJadwalDuaMinggu(employeeNik: string, rentang: RentangDuaMinggu) {
  return prisma.schedule.findMany({
    where: { employeeNik, date: { gte: rentang.mulai, lte: rentang.selesai } },
    orderBy: { date: 'asc' },
  });
}

export async function pairUserSchedule(telegramId: bigint, employeeNik: string): Promise<void> {
  await prisma.userSchedule.upsert({
    where: { telegramId },
    update: { employeeNik },
    create: { telegramId, employeeNik },
  });
}

export async function getUserPairing(telegramId: bigint) {
  return prisma.userSchedule.findUnique({ where: { telegramId } });
}

/**
 * Tautkan user ke data karyawan lewat email yang sudah diverifikasi Google.
 *
 * Identitasnya ditentukan sepenuhnya oleh email di ID token — user tidak pernah
 * ikut memilih, sehingga tidak ada NIK yang bisa dipaksakan dari sisi klien.
 * NIK hasil pencarian disimpan supaya query jadwal dan reminder berikutnya
 * tidak lagi bergantung pada Supabase.
 */
export async function pairUserByEmail(telegramId: bigint, email: string): Promise<EmployeeRecord | null> {
  const employee = await findEmployeeByEmail(email);
  if (!employee) return null;

  await pairUserSchedule(telegramId, employee.employeeNik);
  return employee;
}
