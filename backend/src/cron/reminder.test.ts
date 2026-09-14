import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { prismaTiruan, isUserOnLeave, kirimMassal } = vi.hoisted(() => ({
  prismaTiruan: {
    user: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
  },
  isUserOnLeave: vi.fn(),
  kirimMassal: vi.fn(),
}));

vi.mock('../db', () => ({ prisma: prismaTiruan }));
vi.mock('../services/calendar', () => ({ isUserOnLeave }));
vi.mock('../services/holiday', () => ({ labelLibur: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/telegram', () => ({ createBot: () => ({}), kirimMassal }));

import { sendCheckInReminders } from './reminder';

const ANI = { telegramId: 1n, accessToken: 'a', refreshToken: 'r' };
const BUDI = { telegramId: 2n, accessToken: 'a', refreshToken: 'r' };

const penerima = () =>
  (kirimMassal.mock.calls[0]?.[1] as { telegramId: bigint }[]).map((p) => p.telegramId);

beforeEach(() => {
  // Senin, 14 September 2026, 09:05 WIB.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-14T02:05:00Z'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  prismaTiruan.user.findMany.mockResolvedValue([ANI, BUDI]);
  isUserOnLeave.mockResolvedValue(false);
  kirimMassal.mockResolvedValue({ terkirim: 0, diblokir: 0, gagal: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('reminder check-in', () => {
  test('yang belum absen dan tidak cuti diingatkan', async () => {
    prismaTiruan.attendance.findMany.mockResolvedValue([{ telegramId: ANI.telegramId }]);

    await sendCheckInReminders();

    expect(penerima()).toEqual([BUDI.telegramId]);
    // Yang sudah absen sejak awal tidak perlu ditanyakan ke Google sama sekali.
    expect(isUserOnLeave).toHaveBeenCalledTimes(1);
  });

  test('yang check-in selama cek cuti berjalan tidak ikut ditagih', async () => {
    // Insiden 14 September 2026: daftar absen dibaca 09:05, cek cuti tertahan sampai
    // 09:11, dan reminder "belum check-in" terkirim padahal orangnya check-in 09:09.
    prismaTiruan.attendance.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ telegramId: BUDI.telegramId }]);

    await sendCheckInReminders();

    expect(penerima()).toEqual([ANI.telegramId]);
  });

  test('yang cuti tidak diingatkan', async () => {
    prismaTiruan.attendance.findMany.mockResolvedValue([]);
    isUserOnLeave.mockImplementation(async (u: { telegramId: bigint }) => u.telegramId === ANI.telegramId);

    await sendCheckInReminders();

    expect(penerima()).toEqual([BUDI.telegramId]);
  });
});
