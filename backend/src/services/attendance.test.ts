import { describe, expect, test } from 'vitest';
import { bolehCheckin, bolehCheckout, durasiKerja, selisihJam } from './attendance';

describe('bolehCheckin', () => {
  test('hari kerja setelah jam 08:00 diizinkan', () => {
    expect(bolehCheckin(1, 8)).toEqual({ boleh: true });
    expect(bolehCheckin(5, 23)).toEqual({ boleh: true });
  });

  test('akhir pekan ditandai, bukan ditolak mutlak — pemanggilnya yang minta konfirmasi', () => {
    expect(bolehCheckin(0, 10)).toEqual({ boleh: false, alasan: 'akhir-pekan' });
    expect(bolehCheckin(6, 10)).toEqual({ boleh: false, alasan: 'akhir-pekan' });
  });

  test('sebelum jam 08:00 ditolak', () => {
    expect(bolehCheckin(1, 7)).toEqual({ boleh: false, alasan: 'belum-jam-kerja' });
    expect(bolehCheckin(1, 0)).toEqual({ boleh: false, alasan: 'belum-jam-kerja' });
  });

  test('akhir pekan sebelum jam 08:00 tetap dilaporkan sebagai belum-jam-kerja', () => {
    // Kalau urutannya terbalik, alasannya jadi akhir-pekan, dan tombol konfirmasi akan
    // membuat aturan jam 08:00 bisa ditembus di hari Sabtu.
    expect(bolehCheckin(6, 6)).toEqual({ boleh: false, alasan: 'belum-jam-kerja' });
    expect(bolehCheckin(0, 3)).toEqual({ boleh: false, alasan: 'belum-jam-kerja' });
  });
});

describe('bolehCheckout', () => {
  test('shift hari ini butuh jam 18:00 dan 8 jam kerja', () => {
    expect(bolehCheckout({ lanjutanKemarin: false, jamWIB: 18, jamKerja: 9 })).toEqual({ boleh: true });
  });

  test('sebelum jam 18:00 ditolak untuk shift hari ini', () => {
    expect(bolehCheckout({ lanjutanKemarin: false, jamWIB: 17, jamKerja: 9 })).toEqual({
      boleh: false,
      alasan: 'belum-jam-pulang',
    });
  });

  test('absensi kemarin boleh ditutup lewat tengah malam meski jam masih dini', () => {
    expect(bolehCheckout({ lanjutanKemarin: true, jamWIB: 0, jamKerja: 15 })).toEqual({ boleh: true });
    expect(bolehCheckout({ lanjutanKemarin: true, jamWIB: 6, jamKerja: 9 })).toEqual({ boleh: true });
  });

  test('aturan 8 jam tetap berlaku untuk absensi kemarin', () => {
    expect(bolehCheckout({ lanjutanKemarin: true, jamWIB: 1, jamKerja: 7.5 })).toEqual({
      boleh: false,
      alasan: 'belum-8-jam',
      sisaMenit: 30,
    });
  });

  test('sisa menit dibulatkan ke atas', () => {
    expect(bolehCheckout({ lanjutanKemarin: false, jamWIB: 20, jamKerja: 7.99 }).sisaMenit).toBe(1);
  });
});

describe('durasiKerja', () => {
  test('memecah jam desimal jadi jam dan menit', () => {
    expect(durasiKerja(8.5)).toEqual({ jam: 8, menit: 30 });
    expect(durasiKerja(9.25)).toEqual({ jam: 9, menit: 15 });
  });

  test('tidak pernah menghasilkan 60 menit', () => {
    expect(durasiKerja(8.999)).toEqual({ jam: 9, menit: 0 });
  });
});

describe('selisihJam', () => {
  test('menghitung jarak dua waktu dalam jam desimal', () => {
    expect(selisihJam(new Date('2026-08-17T01:00:00Z'), new Date('2026-08-17T10:30:00Z'))).toBe(9.5);
  });
});
