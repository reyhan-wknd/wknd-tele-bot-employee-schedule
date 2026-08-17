import { describe, expect, test } from 'vitest';
import { susunBarisRiwayat, SEL_KOSONG, type AbsensiRiwayat } from './riwayat';
import { addDays, dateOnly } from './time';

/** 14 hari menaik yang berakhir di 17 Agustus 2026 (Senin). */
const HARI = Array.from({ length: 14 }, (_, i) => addDays(dateOnly('2026-08-04'), i));

const absensi = (isoDate: string, masukZ: string, pulangZ: string | null): AbsensiRiwayat => ({
  date: dateOnly(isoDate),
  checkIn: new Date(masukZ),
  checkOut: pulangZ ? new Date(pulangZ) : null,
});

const kosong = new Map<string, string>();

describe('susunBarisRiwayat', () => {
  test('selalu satu baris per hari kalender, bernomor urut', () => {
    const baris = susunBarisRiwayat({ hari: HARI, absensi: [], libur: kosong });

    expect(baris).toHaveLength(14);
    expect(baris.map((b) => b.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(baris[0].tanggal).toBe('Sel, 04 Agu');
    expect(baris[13].tanggal).toBe('Sen, 17 Agu');
  });

  test('hari dengan absensi lengkap menampilkan jam dan durasinya', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      // 02:00Z = 09:00 WIB, 11:05Z = 18:05 WIB
      absensi: [absensi('2026-08-04', '2026-08-04T02:00:00Z', '2026-08-04T11:05:00Z')],
      libur: kosong,
    });

    expect(baris[0]).toEqual({
      no: 1,
      tanggal: 'Sel, 04 Agu',
      masuk: '09.00',
      pulang: '18.05',
      durasi: '9j 5m',
    });
  });

  test('absensi yang belum ditutup ditandai Berjalan, pulangnya kosong', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      absensi: [absensi('2026-08-05', '2026-08-05T02:00:00Z', null)],
      libur: kosong,
    });

    expect(baris[1].masuk).toBe('09.00');
    expect(baris[1].pulang).toBe(SEL_KOSONG);
    expect(baris[1].durasi).toBe('Berjalan');
  });

  test('akhir pekan tanpa absensi diberi keterangannya', () => {
    const baris = susunBarisRiwayat({ hari: HARI, absensi: [], libur: kosong });

    // 08 Agustus Sabtu, 09 Agustus Minggu.
    expect(baris[4].durasi).toBe('Akhir pekan');
    expect(baris[5].durasi).toBe('Akhir pekan');
  });

  test('hari kerja yang bolong ditandai Tidak absen, bukan dibiarkan kosong', () => {
    const baris = susunBarisRiwayat({ hari: HARI, absensi: [], libur: kosong });

    expect(baris[0].durasi).toBe('Tidak absen'); // Selasa
    expect(baris[0].masuk).toBe(SEL_KOSONG);
  });

  test('hari libur terdaftar menang atas Tidak absen', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      absensi: [],
      libur: new Map([['2026-08-17', 'Hari Proklamasi Kemerdekaan R.I.']]),
    });

    expect(baris[13].durasi).toBe('Libur');
  });

  test('hari libur yang jatuh di akhir pekan disebut Libur, bukan Akhir pekan', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      absensi: [],
      libur: new Map([['2026-08-08', 'Libur khusus']]), // 8 Agustus = Sabtu
    });

    expect(baris[4].durasi).toBe('Libur');
  });

  test('absensi tetap ditampilkan meski hari itu libur — sebagian orang memang masuk', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      absensi: [absensi('2026-08-17', '2026-08-17T02:00:00Z', '2026-08-17T11:00:00Z')],
      libur: new Map([['2026-08-17', 'Hari Kemerdekaan']]),
    });

    expect(baris[13].masuk).toBe('09.00');
    expect(baris[13].durasi).toBe('9j 0m');
  });

  test('absensi di luar rentang tidak menyusup ke baris mana pun', () => {
    const baris = susunBarisRiwayat({
      hari: HARI,
      absensi: [absensi('2026-07-30', '2026-07-30T02:00:00Z', '2026-07-30T11:00:00Z')],
      libur: kosong,
    });

    expect(baris.every((b) => b.masuk === SEL_KOSONG)).toBe(true);
  });
});
