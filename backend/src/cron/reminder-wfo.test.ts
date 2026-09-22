import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { prismaTiruan, kirimMassal, fetchSchedules, syncSchedules } = vi.hoisted(() => ({
  prismaTiruan: {
    userSchedule: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    weeklyScheduleNotice: { findMany: vi.fn(), upsert: vi.fn() },
  },
  kirimMassal: vi.fn(),
  fetchSchedules: vi.fn(),
  syncSchedules: vi.fn(),
}));

vi.mock('../db', () => ({ prisma: prismaTiruan }));
vi.mock('../lib/telegram', () => ({ createBot: () => ({}), kirimMassal }));
vi.mock('../services/supabase', () => ({ fetchSchedules }));
vi.mock('./sync-schedules', () => ({ syncSchedules }));
vi.mock('../services/holiday', () => ({ labelLibur: vi.fn().mockResolvedValue(null) }));

import { cekJadwalMingguDepan } from './reminder-wfo';

const ANI = { telegramId: 1n, employeeNik: '100' };
const BUDI = { telegramId: 2n, employeeNik: '200' };

const baris = (employeeNik: string, date: string, projectName: string) => ({
  employeeNik,
  name: `Karyawan ${employeeNik}`,
  jobTitle: 'Engineer',
  status: 'Aktif',
  projectName,
  date,
});

const catatanJumat = (telegramId: bigint, snapshot: unknown[]) => ({
  id: 1,
  telegramId,
  weekStart: new Date('2026-09-28T00:00:00.000Z'),
  status: 'terkirim',
  snapshot: JSON.stringify(snapshot),
  notifiedOn: new Date('2026-09-25T00:00:00.000Z'),
  updatedAt: new Date(),
});

const terkirimSemua = async (_bot: unknown, pesan: { telegramId: bigint }[]) => ({
  terkirim: pesan.length,
  diblokir: 0,
  gagal: 0,
  terkirimKe: pesan.map((p) => p.telegramId),
});

const pesanTerkirim = () => kirimMassal.mock.calls[0]?.[1] as { telegramId: bigint; text: string }[];

/** 21:00 WIB pada tanggal ini. */
const pukul21 = (tanggal: string) => vi.setSystemTime(new Date(`${tanggal}T14:00:00Z`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  prismaTiruan.userSchedule.findMany.mockResolvedValue([ANI, BUDI]);
  prismaTiruan.user.findMany.mockResolvedValue([{ telegramId: ANI.telegramId }, { telegramId: BUDI.telegramId }]);
  prismaTiruan.weeklyScheduleNotice.findMany.mockResolvedValue([]);
  kirimMassal.mockImplementation(terkirimSemua);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('cek jadwal minggu depan', () => {
  test('menyinkronkan dulu, lalu mengambil roster Senin–Jumat pekan depan langsung dari Supabase', async () => {
    pukul21('2026-09-26'); // Sabtu
    fetchSchedules.mockResolvedValue([baris(ANI.employeeNik, '2026-09-28', 'HERO')]);

    await cekJadwalMingguDepan();

    expect(fetchSchedules).toHaveBeenCalledWith({ start: '2026-09-28', end: '2026-10-02' });
    expect(syncSchedules.mock.invocationCallOrder[0]).toBeLessThan(fetchSchedules.mock.invocationCallOrder[0]);
  });

  test('Jumat, roster belum terbit: semua dikabari dan kabarnya dicatat', async () => {
    pukul21('2026-09-25');
    fetchSchedules.mockResolvedValue([]);

    await cekJadwalMingguDepan();

    expect(pesanTerkirim().map((p) => p.telegramId)).toEqual([ANI.telegramId, BUDI.telegramId]);
    expect(pesanTerkirim()[0].text).toMatch(/belum terbit.*besok \(Sabtu\)/);
    expect(prismaTiruan.weeklyScheduleNotice.upsert).toHaveBeenCalledTimes(2);
    expect(prismaTiruan.weeklyScheduleNotice.upsert.mock.calls[0][0]).toMatchObject({
      where: { telegramId_weekStart: { telegramId: ANI.telegramId, weekStart: new Date('2026-09-28T00:00:00.000Z') } },
      create: { status: 'belum-terbit', snapshot: '[]', notifiedOn: new Date('2026-09-25T00:00:00.000Z') },
    });
  });

  test('Sabtu, jadwal salah satu orang berubah: hanya dia yang dikabari', async () => {
    pukul21('2026-09-26');
    prismaTiruan.weeklyScheduleNotice.findMany.mockResolvedValue([
      catatanJumat(ANI.telegramId, [{ tanggal: '2026-09-28', projects: ['HERO'] }]),
      catatanJumat(BUDI.telegramId, [{ tanggal: '2026-09-29', projects: ['PPA'] }]),
    ]);
    fetchSchedules.mockResolvedValue([
      baris(ANI.employeeNik, '2026-09-30', 'HERO'),
      baris(BUDI.employeeNik, '2026-09-29', 'PPA'),
    ]);

    await cekJadwalMingguDepan();

    expect(pesanTerkirim()).toHaveLength(1);
    expect(pesanTerkirim()[0].telegramId).toBe(ANI.telegramId);
    expect(pesanTerkirim()[0].text).toMatch(/^🔄 Jadwal WFO minggu depan berubah/);
    expect(prismaTiruan.weeklyScheduleNotice.upsert).toHaveBeenCalledTimes(1);
    expect(prismaTiruan.weeklyScheduleNotice.upsert.mock.calls[0][0].update).toMatchObject({
      status: 'terkirim',
      snapshot: JSON.stringify([{ tanggal: '2026-09-30', projects: ['HERO'] }]),
    });
  });

  test('pesan yang tidak sampai tidak dicatat, supaya besok dikirim ulang', async () => {
    pukul21('2026-09-25');
    fetchSchedules.mockResolvedValue([baris(ANI.employeeNik, '2026-09-28', 'HERO')]);
    kirimMassal.mockResolvedValue({ terkirim: 1, diblokir: 0, gagal: 1, terkirimKe: [BUDI.telegramId] });

    await cekJadwalMingguDepan();

    expect(prismaTiruan.weeklyScheduleNotice.upsert).toHaveBeenCalledTimes(1);
    expect(prismaTiruan.weeklyScheduleNotice.upsert.mock.calls[0][0].where.telegramId_weekStart.telegramId).toBe(
      BUDI.telegramId
    );
  });

  test('Supabase gagal: tidak ada kesimpulan, tidak ada pesan', async () => {
    // Terutama hari Minggu, ketika "tidak terbit" berarti mengabarkan tidak ada WFO.
    pukul21('2026-09-27');
    fetchSchedules.mockRejectedValue(new Error('Supabase schedules fetch failed: 503'));

    await cekJadwalMingguDepan();

    expect(kirimMassal).not.toHaveBeenCalled();
    expect(prismaTiruan.weeklyScheduleNotice.upsert).not.toHaveBeenCalled();
  });

  test('catatan yang rusak diperlakukan seperti belum pernah dikabari', async () => {
    pukul21('2026-09-26');
    prismaTiruan.weeklyScheduleNotice.findMany.mockResolvedValue([
      { ...catatanJumat(ANI.telegramId, []), snapshot: '{bukan json' },
    ]);
    prismaTiruan.userSchedule.findMany.mockResolvedValue([ANI]);
    fetchSchedules.mockResolvedValue([baris(ANI.employeeNik, '2026-09-28', 'HERO')]);

    await cekJadwalMingguDepan();

    expect(pesanTerkirim()[0].text).toMatch(/^📅 Jadwal WFO kamu minggu depan/);
  });

  test('di luar Jumat–Minggu tidak melakukan apa pun', async () => {
    pukul21('2026-09-24'); // Kamis

    await cekJadwalMingguDepan();

    expect(syncSchedules).not.toHaveBeenCalled();
    expect(fetchSchedules).not.toHaveBeenCalled();
    expect(kirimMassal).not.toHaveBeenCalled();
  });
});
