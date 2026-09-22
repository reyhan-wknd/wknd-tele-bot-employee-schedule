import { describe, expect, test } from 'vitest';
import { assertSyncSane, SyncTidakMasukAkal } from './sync-guard';

/** `jumlah` baris yang dibagi rata ke tanggal-tanggal yang diberikan. */
function baris(tanggal: readonly string[], jumlah: number): string[] {
  return Array.from({ length: jumlah }, (_, i) => tanggal[i % tanggal.length]);
}

// Rentang sync pada Minggu, 20 September 2026: Minggu ini sampai Sabtu pekan depan.
const RENTANG_20_SEP = { start: '2026-09-20', end: '2026-10-03' };

const PEKAN_14_SEP = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
const PEKAN_21_SEP_VERSI_JUMAT = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
const PEKAN_21_SEP_VERSI_MINGGU = ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const PEKAN_28_SEP = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

describe('assertSyncSane', () => {
  test('hasil kosong dibatalkan supaya jadwal lama tidak terhapus', () => {
    const lokal = baris(PEKAN_21_SEP_VERSI_JUMAT, 206);

    expect(() => assertSyncSane([], lokal, RENTANG_20_SEP)).toThrow(SyncTidakMasukAkal);
  });

  test('kosong dari kosong tetap ditolak — tidak ada yang bisa disimpulkan', () => {
    expect(() => assertSyncSane([], [], RENTANG_20_SEP)).toThrow(SyncTidakMasukAkal);
  });

  test('database yang masih kosong boleh diisi berapa pun', () => {
    expect(() => assertSyncSane(baris(PEKAN_21_SEP_VERSI_MINGGU, 12), [], RENTANG_20_SEP)).not.toThrow();
  });

  test('kasus 20 September 2026: jendela bergeser dan roster diterbitkan ulang lebih ramping', () => {
    // Lokal: pekan lalu (199) + versi Jumat pekan ini (206) = 405 baris. Supabase sudah
    // menerbitkan ulang pekan ini pada Minggu sore dengan 150 baris, tanpa satu pun yang
    // sama. Guard lama menolaknya karena 150 < ½ × 405, dan bot tertahan di versi Jumat.
    const lokal = [...baris(PEKAN_14_SEP, 199), ...baris(PEKAN_21_SEP_VERSI_JUMAT, 206)];
    const hasilFetch = baris(PEKAN_21_SEP_VERSI_MINGGU, 150);

    expect(() => assertSyncSane(hasilFetch, lokal, RENTANG_20_SEP)).not.toThrow();
  });

  test('pekan yang sudah lewat jendela tidak ikut dibandingkan', () => {
    const lokal = baris(PEKAN_14_SEP, 199);

    expect(() => assertSyncSane(baris(PEKAN_21_SEP_VERSI_MINGGU, 150), lokal, RENTANG_20_SEP)).not.toThrow();
  });

  test('pekan yang pernah ada lalu lenyap seluruhnya dibatalkan', () => {
    // Respons terpotong atau filter yang berubah menghapus pekan terakhir tanpa jejak;
    // roster yang terbit ulang selalu menggantinya, tidak pernah mengosongkannya.
    const lokal = [...baris(PEKAN_21_SEP_VERSI_MINGGU, 150), ...baris(PEKAN_28_SEP, 190)];
    const hasilFetch = baris(PEKAN_21_SEP_VERSI_MINGGU, 150);

    expect(() => assertSyncSane(hasilFetch, lokal, RENTANG_20_SEP)).toThrow(/2026-09-27/);
  });

  test('pekan baru yang terbit diteruskan', () => {
    const lokal = baris(PEKAN_21_SEP_VERSI_MINGGU, 150);
    const hasilFetch = [...baris(PEKAN_21_SEP_VERSI_MINGGU, 150), ...baris(PEKAN_28_SEP, 190)];

    expect(() => assertSyncSane(hasilFetch, lokal, RENTANG_20_SEP)).not.toThrow();
  });
});
