import { prisma } from '../db';
import {
  cocokHariLibur,
  libur365Hari,
  TAHUN_BERULANG,
  type HariLibur,
  type LiburMendatang,
  type TanggalLibur,
} from '../lib/holiday';
import { todayWIB } from '../lib/time';

/**
 * Jumlah entri libur selalu kecil (belasan per tahun), jadi seluruh tabel ditarik lalu
 * dicocokkan di memori. Itu membuat aturan "berulang tiap tahun" cukup ditulis sekali di
 * `lib/holiday.ts` dan tidak perlu diterjemahkan lagi jadi query SQL.
 */
async function semuaLibur(): Promise<HariLibur[]> {
  return prisma.holiday.findMany({
    select: { year: true, month: true, day: true, label: true },
  });
}

/** Label hari liburnya, atau null bila tanggal itu hari biasa. */
export async function labelLibur(tanggal: Date = todayWIB()): Promise<string | null> {
  return cocokHariLibur(await semuaLibur(), tanggal)?.label ?? null;
}

export async function daftarUpcoming(mulai: Date = todayWIB()): Promise<LiburMendatang[]> {
  return libur365Hari(await semuaLibur(), mulai);
}

export async function cariLibur(tanggal: TanggalLibur) {
  return prisma.holiday.findUnique({ where: { year_month_day: tanggal } });
}

export async function tambahLibur(tanggal: TanggalLibur, label: string) {
  return prisma.holiday.create({ data: { ...tanggal, label } });
}

export async function ubahLabelLibur(tanggal: TanggalLibur, label: string) {
  return prisma.holiday.update({ where: { year_month_day: tanggal }, data: { label } });
}

export async function hapusLibur(tanggal: TanggalLibur) {
  return prisma.holiday.delete({ where: { year_month_day: tanggal } });
}

/** Dipakai seed: menulis ulang entri yang sudah ada tanpa menggandakannya. */
export async function simpanLibur(tanggal: TanggalLibur, label: string) {
  return prisma.holiday.upsert({
    where: { year_month_day: tanggal },
    create: { ...tanggal, label },
    update: { label },
  });
}

export { TAHUN_BERULANG };
