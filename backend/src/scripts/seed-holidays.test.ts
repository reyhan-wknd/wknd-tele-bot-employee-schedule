import { describe, expect, test } from 'vitest';
import { parseIcs, rapikanLabel } from './seed-holidays';
import { MAKS_PANJANG_LABEL } from '../lib/holiday';

describe('rapikanLabel', () => {
  test('penanda "(belum pasti)" dari Google dibuang', () => {
    expect(rapikanLabel('Hari Raya Waisak (belum pasti)')).toBe('Hari Raya Waisak');
    expect(rapikanLabel('Maulid Nabi Muhammad (Belum Pasti)')).toBe('Maulid Nabi Muhammad');
    expect(rapikanLabel('Nyepi (tentative)')).toBe('Nyepi');
  });

  test('tanda kurung yang memang bagian nama tidak ikut terbuang', () => {
    expect(rapikanLabel('Idul Adha (Lebaran Haji)')).toBe('Idul Adha (Lebaran Haji)');
    expect(rapikanLabel('Hari Suci Nyepi (Tahun Baru Saka)')).toBe('Hari Suci Nyepi (Tahun Baru Saka)');
  });

  test('label dari hulu yang kepanjangan dipotong, bukan menggagalkan seed', () => {
    expect(rapikanLabel('x'.repeat(300))).toHaveLength(MAKS_PANJANG_LABEL);
  });

  test('spasi berlebih dirapikan', () => {
    expect(rapikanLabel('  Hari Tahun Baru  ')).toBe('Hari Tahun Baru');
  });
});

describe('parseIcs', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260817',
    'DTEND;VALUE=DATE:20260818',
    'SUMMARY:Hari Proklamasi Kemerdekaan R.I.',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260321',
    'SUMMARY:Hari Idul Fitri',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  test('tanggal dan label terbaca sebagai ISO', () => {
    expect(parseIcs(ics)).toEqual([
      { isoDate: '2026-08-17', label: 'Hari Proklamasi Kemerdekaan R.I.' },
      { isoDate: '2026-03-21', label: 'Hari Idul Fitri' },
    ]);
  });

  // ICS melipat baris panjang di tengah kata: CRLF + satu spasi awal adalah penanda
  // lipatan dan ikut dibuang saat disambung, bukan berubah jadi spasi.
  test('baris terlipat disambung dulu — kalau tidak, labelnya terpotong', () => {
    const terlipat = [
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260817',
      'SUMMARY:Hari Proklamasi Kemerdekaan Repub',
      ' lik Indonesia',
      'END:VEVENT',
    ].join('\r\n');

    expect(parseIcs(terlipat)[0].label).toBe('Hari Proklamasi Kemerdekaan Republik Indonesia');
  });

  test('event tanpa DTSTART atau SUMMARY dilewati, bukan bikin crash', () => {
    const cacat = ['BEGIN:VEVENT', 'SUMMARY:Tanpa tanggal', 'END:VEVENT'].join('\r\n');
    expect(parseIcs(cacat)).toEqual([]);
  });

  test('masukan kosong menghasilkan daftar kosong', () => {
    expect(parseIcs('')).toEqual([]);
  });
});
