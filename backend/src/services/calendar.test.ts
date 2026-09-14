import { afterEach, describe, expect, test, vi } from 'vitest';

const { eventsList } = vi.hoisted(() => ({ eventsList: vi.fn() }));

vi.mock('googleapis', () => ({
  google: { calendar: () => ({ events: { list: eventsList } }) },
}));
vi.mock('../lib/crypto', () => ({ decryptToken: (v: string | null) => v, encryptToken: (v: string) => v }));
vi.mock('../db', () => ({ prisma: {} }));

import { BATAS_TUNGGU_KALENDER_MS, isLeaveEvent, isUserOnLeave } from './calendar';

describe('isLeaveEvent', () => {
  test('event bertipe Out of office dianggap cuti', () => {
    expect(isLeaveEvent({ eventType: 'outOfOffice' })).toBe(true);
  });

  test('judul tidak berpengaruh sama sekali', () => {
    // Apa pun judulnya — bahkan yang tidak terdengar seperti cuti — asal tipenya OOO.
    for (const eventType of ['outOfOffice']) {
      expect(isLeaveEvent({ eventType })).toBe(true);
    }

    // Dan sebaliknya: judul yang terdengar seperti cuti tetap bukan cuti tanpa tipe OOO.
    for (const eventType of ['default', 'focusTime', 'workingLocation', null, undefined]) {
      expect(isLeaveEvent({ eventType }), String(eventType)).toBe(false);
    }
  });

  test('event biasa bukan cuti', () => {
    expect(isLeaveEvent({})).toBe(false);
    expect(isLeaveEvent({ eventType: 'default' })).toBe(false);
  });
});

describe('isUserOnLeave dibatasi waktu', () => {
  const USER = { telegramId: 1n, accessToken: 'a', refreshToken: 'r' };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    eventsList.mockReset();
  });

  test('Google yang tidak menjawab dianggap tidak cuti setelah batas tunggu, bukan menggantung', async () => {
    // Bentuk insiden 14 September 2026: koneksi ke googleapis.com menggantung sampai
    // timeout OS, diulang dua kali — satu /check_in tertahan 4–7 menit.
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    eventsList.mockReturnValue(new Promise(() => undefined));

    let selesai = false;
    const hasil = isUserOnLeave(USER).finally(() => {
      selesai = true;
    });

    await vi.advanceTimersByTimeAsync(BATAS_TUNGGU_KALENDER_MS - 1);
    expect(selesai).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(hasil).resolves.toBe(false);
  });

  test('permintaannya sendiri diberi timeout dan tidak diulang', async () => {
    // Batas di atas hanya melepaskan pemanggil; tanpa ini soketnya tetap menggantung
    // di belakang, dan gaxios tetap mengulangnya dua kali lagi.
    eventsList.mockResolvedValue({ data: { items: [] } });

    await isUserOnLeave(USER);

    expect(eventsList).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        timeout: BATAS_TUNGGU_KALENDER_MS,
        retryConfig: expect.objectContaining({ retry: 0, noResponseRetries: 0 }),
      })
    );
  });

  test('jawaban yang datang tepat waktu tetap dipakai', async () => {
    eventsList.mockResolvedValue({ data: { items: [{ eventType: 'outOfOffice' }] } });

    await expect(isUserOnLeave(USER)).resolves.toBe(true);
  });
});
