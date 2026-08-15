import { describe, expect, test } from 'vitest';
import { assertSyncSane, SyncTidakMasukAkal } from './sync-guard';

describe('assertSyncSane', () => {
  test('hasil kosong dibatalkan supaya jadwal lama tidak terhapus', () => {
    expect(() => assertSyncSane(0, 394)).toThrow(SyncTidakMasukAkal);
  });

  test('penurunan lebih dari separuh dibatalkan', () => {
    expect(() => assertSyncSane(150, 394)).toThrow(/kurang dari setengah/);
  });

  test('perubahan wajar diteruskan', () => {
    expect(() => assertSyncSane(394, 394)).not.toThrow();
    expect(() => assertSyncSane(250, 394)).not.toThrow();
    expect(() => assertSyncSane(500, 394)).not.toThrow();
  });

  test('database yang masih kosong boleh diisi berapa pun', () => {
    expect(() => assertSyncSane(12, 0)).not.toThrow();
  });

  test('kosong dari kosong tetap ditolak — tidak ada yang bisa disimpulkan', () => {
    expect(() => assertSyncSane(0, 0)).toThrow(SyncTidakMasukAkal);
  });
});
