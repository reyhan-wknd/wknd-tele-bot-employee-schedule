import { describe, expect, test, vi } from 'vitest';
import { diblokirUser, kirimMassal, retryAfter } from './telegram';

const errorTelegram = (kode: number, retry?: number) => ({
  response: { error_code: kode, parameters: retry ? { retry_after: retry } : undefined },
});

function botPalsu(jawab: (id: number) => Promise<void>) {
  const dikirim: number[] = [];
  return {
    dikirim,
    bot: {
      telegram: {
        sendMessage: vi.fn(async (id: number) => {
          dikirim.push(id);
          await jawab(id);
        }),
      },
    } as never,
  };
}

describe('klasifikasi error Telegram', () => {
  test('403 berarti user memblokir bot', () => {
    expect(diblokirUser(errorTelegram(403))).toBe(true);
    expect(diblokirUser(errorTelegram(400))).toBe(false);
    expect(diblokirUser(new Error('jaringan'))).toBe(false);
  });

  test('retryAfter hanya untuk 429', () => {
    expect(retryAfter(errorTelegram(429, 3))).toBe(3);
    expect(retryAfter(errorTelegram(429))).toBe(1); // tanpa parameter, tunggu 1 detik
    expect(retryAfter(errorTelegram(403))).toBeNull();
  });
});

describe('kirimMassal', () => {
  const pesan = [
    { telegramId: 1n, text: 'a' },
    { telegramId: 2n, text: 'b' },
    { telegramId: 3n, text: 'c' },
  ];

  test('menghitung terkirim, diblokir, dan gagal secara terpisah', async () => {
    const { bot, dikirim } = botPalsu(async (id) => {
      if (id === 2) throw errorTelegram(403);
      if (id === 3) throw new Error('jaringan putus');
    });

    await expect(kirimMassal(bot, pesan)).resolves.toEqual({ terkirim: 1, diblokir: 1, gagal: 1 });
    expect(dikirim).toEqual([1, 2, 3]); // satu penerima gagal tidak menghentikan sisanya
  });

  test('mengulang sekali saat kena rate limit', async () => {
    let percobaan = 0;
    const { bot } = botPalsu(async () => {
      percobaan++;
      if (percobaan === 1) throw errorTelegram(429, 0);
    });

    await expect(kirimMassal(bot, [pesan[0]])).resolves.toEqual({ terkirim: 1, diblokir: 0, gagal: 0 });
    expect(percobaan).toBe(2);
  });

  test('daftar kosong tidak memanggil Telegram sama sekali', async () => {
    const { bot, dikirim } = botPalsu(async () => {});

    await expect(kirimMassal(bot, [])).resolves.toEqual({ terkirim: 0, diblokir: 0, gagal: 0 });
    expect(dikirim).toEqual([]);
  });
});
