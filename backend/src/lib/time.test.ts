import { describe, expect, test } from 'vitest';
import {
  addDays,
  dateOnly,
  formatDateOnly,
  formatTimeWIB,
  hourWIB,
  isoDateOf,
  todayWIB,
  weekdayOf,
  weekdayWIB,
  wibClock,
  wibDayBounds,
} from './time';

// Semua ekspektasi di bawah harus tetap benar apa pun zona waktu mesin yang menjalankan tes:
// jalankan `TZ=UTC npm test` dan `TZ=America/New_York npm test` untuk membuktikannya.

describe('wibClock', () => {
  test('menggeser instant UTC ke jam dinding WIB', () => {
    expect(wibClock(new Date('2026-08-15T03:46:21Z'))).toEqual({
      date: '2026-08-15',
      hour: 10,
      minute: 46,
    });
  });

  test('detik terakhir sebelum pergantian hari WIB masih hari kemarin', () => {
    expect(wibClock(new Date('2026-08-14T16:59:59Z'))).toMatchObject({ date: '2026-08-14', hour: 23 });
  });

  test('tengah malam WIB menghasilkan jam 0, bukan 24', () => {
    expect(wibClock(new Date('2026-08-14T17:00:00Z'))).toMatchObject({ date: '2026-08-15', hour: 0 });
  });
});

describe('todayWIB & hourWIB', () => {
  test('tanggal WIB dikembalikan sebagai tengah malam UTC', () => {
    expect(todayWIB(new Date('2026-08-14T17:30:00Z')).toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  test('jam kerja dibaca dari jam WIB, bukan jam mesin', () => {
    expect(hourWIB(new Date('2026-08-15T01:00:00Z'))).toBe(8); // 08:00 WIB
    expect(hourWIB(new Date('2026-08-15T11:00:00Z'))).toBe(18); // 18:00 WIB
  });
});

describe('aritmetika tanggal', () => {
  test('addDays melewati pergantian bulan', () => {
    expect(isoDateOf(addDays(dateOnly('2026-08-31'), 1))).toBe('2026-09-01');
    expect(isoDateOf(addDays(dateOnly('2026-01-01'), -1))).toBe('2025-12-31');
  });

  test('weekdayOf memakai kalender, 0 = Minggu', () => {
    expect(weekdayOf(dateOnly('2026-08-15'))).toBe(6); // Sabtu
    expect(weekdayOf(dateOnly('2026-08-16'))).toBe(0); // Minggu
  });

  test('weekdayWIB ikut hari WIB, bukan hari UTC', () => {
    // 16:00Z Sabtu masih Sabtu di WIB (23:00), 17:00Z sudah Minggu (00:00)
    expect(weekdayWIB(new Date('2026-08-15T16:00:00Z'))).toBe(6);
    expect(weekdayWIB(new Date('2026-08-15T17:00:00Z'))).toBe(0);
  });
});

describe('wibDayBounds', () => {
  test('menutup tepat satu hari WIB', () => {
    const { start, end } = wibDayBounds(new Date('2026-08-15T03:00:00Z'));

    expect(start.toISOString()).toBe('2026-08-14T17:00:00.000Z'); // 00:00 WIB
    expect(end.toISOString()).toBe('2026-08-15T16:59:59.999Z'); // 23:59 WIB
    expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
  });

  test('event sepanjang hari untuk besok berada di luar jendela', () => {
    const { end } = wibDayBounds(new Date('2026-08-15T03:00:00Z'));
    const besokMulai = new Date('2026-08-15T17:00:00Z'); // 00:00 WIB tanggal 16

    expect(besokMulai.getTime()).toBeGreaterThan(end.getTime());
  });
});

describe('format', () => {
  test('formatDateOnly membaca nilai date-only apa adanya', () => {
    const teks = formatDateOnly(dateOnly('2026-08-15'));

    expect(teks).toContain('Sabtu');
    expect(teks).toContain('15');
    expect(teks).toContain('2026');
  });

  test('formatTimeWIB menampilkan jam WIB', () => {
    expect(formatTimeWIB(new Date('2026-08-15T03:46:00Z'))).toMatch(/^10[.:]46$/);
  });
});
