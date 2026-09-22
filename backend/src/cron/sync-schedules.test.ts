import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { prismaTiruan, fetchSchedules } = vi.hoisted(() => ({
  prismaTiruan: {
    schedule: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
  fetchSchedules: vi.fn(),
}));

vi.mock('../db', () => ({ prisma: prismaTiruan }));
vi.mock('../services/supabase', async (asli) => ({
  ...(await asli<typeof import('../services/supabase')>()),
  fetchSchedules,
}));

import { syncSchedules } from './sync-schedules';

const barisLokal = (tanggal: string, jumlah: number) =>
  Array.from({ length: jumlah }, () => ({ date: new Date(`${tanggal}T00:00:00.000Z`) }));

const barisSupabase = (tanggal: string, jumlah: number) =>
  Array.from({ length: jumlah }, (_, i) => ({
    employeeNik: `${i}`,
    name: `Karyawan ${i}`,
    jobTitle: 'Engineer',
    status: 'Aktif',
    projectName: 'HERO',
    date: tanggal,
  }));

beforeEach(() => {
  // Minggu, 20 September 2026, 20:00 WIB — malam ketika sync mulai ditolak di produksi.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T13:00:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('syncSchedules', () => {
  test('mengambil rentang Minggu ini sampai Sabtu pekan depan', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([]);
    fetchSchedules.mockResolvedValue(barisSupabase('2026-09-22', 1));

    await syncSchedules();

    expect(fetchSchedules).toHaveBeenCalledWith({ start: '2026-09-20', end: '2026-10-03' });
  });

  test('roster yang terbit ulang lebih ramping tetap disalin', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([
      ...barisLokal('2026-09-15', 199),
      ...barisLokal('2026-09-21', 206),
    ]);
    fetchSchedules.mockResolvedValue(barisSupabase('2026-09-22', 150));

    await syncSchedules();

    expect(prismaTiruan.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaTiruan.schedule.createMany.mock.calls[0][0].data).toHaveLength(150);
  });

  test('pekan yang lenyap membatalkan sync tanpa menyentuh tabel', async () => {
    prismaTiruan.schedule.findMany.mockResolvedValue([
      ...barisLokal('2026-09-22', 150),
      ...barisLokal('2026-09-29', 190),
    ]);
    fetchSchedules.mockResolvedValue(barisSupabase('2026-09-22', 150));

    await syncSchedules();

    expect(prismaTiruan.$transaction).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
