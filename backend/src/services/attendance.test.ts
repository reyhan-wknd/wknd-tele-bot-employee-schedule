import { describe, expect, test } from 'vitest';
import { ambangCheckout, batasReminder, bolehCheckin, bolehCheckout, durasiKerja, selisihJam } from './attendance';

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

/** Semua waktu ditulis sebagai instant UTC; WIB = UTC+7, jadi 01:00Z = 08:00 WIB. */
const wib = (isoWaktu: string) => new Date(`2026-08-17T${isoWaktu}:00.000+07:00`);

describe('ambangCheckout', () => {
  const ambangJam = (jamCheckIn: string) => wibJam(ambangCheckout(wib(jamCheckIn)).ambang);

  // Baca ambang sebagai "HH:MM" WIB supaya ekspektasinya terbaca seperti tabel aturan.
  function wibJam(instant: Date): string {
    return instant.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  test('datang lebih pagi tidak memajukan jam pulang — kerja mulai 09:00', () => {
    expect(ambangJam('08:00')).toBe('18:00');
    expect(ambangJam('08:45')).toBe('18:00');
    expect(ambangJam('09:00')).toBe('18:00');
  });

  test('datang setelah 09:00 menggeser ambangnya sebanyak itu juga', () => {
    expect(ambangJam('09:30')).toBe('18:30');
    expect(ambangJam('11:00')).toBe('20:00');
  });

  test('istirahat proporsional: mulai 12:30 hanya kebagian sisa 30 menit', () => {
    expect(ambangCheckout(wib('12:30')).menitWajib).toBe(8 * 60 + 30);
    expect(ambangJam('12:30')).toBe('21:00');
  });

  test('mulai jam 13:00 ke atas tidak kebagian istirahat sama sekali', () => {
    expect(ambangCheckout(wib('13:00')).menitWajib).toBe(8 * 60);
    expect(ambangJam('13:00')).toBe('21:00');
    expect(ambangJam('16:00')).toBe('00:00'); // lewat batas hari
  });

  test('ambangnya bersambung di sekitar jam istirahat, tanpa lompatan', () => {
    // Kalau istirahatnya dibuat lompatan 1 jam / 0 jam, 12:59 dan 13:00 akan berjarak
    // hampir sejam — celah yang bisa dimanfaatkan dengan menggeser check-in semenit.
    expect(ambangJam('12:59')).toBe('21:00');
    expect(ambangJam('13:00')).toBe('21:00');
    expect(ambangJam('13:01')).toBe('21:01');
  });
});

describe('bolehCheckout', () => {
  test('tepat di ambang sudah boleh', () => {
    expect(bolehCheckout(wib('08:00'), wib('18:00'))).toEqual({ boleh: true });
  });

  test('lewat ambang boleh', () => {
    expect(bolehCheckout(wib('08:00'), wib('20:00'))).toEqual({ boleh: true });
  });

  test('sebelum ambang butuh konfirmasi, dengan sisa menitnya', () => {
    expect(bolehCheckout(wib('08:00'), wib('17:30'))).toEqual({
      boleh: false,
      alasan: 'belum-cukup-jam',
      sisaMenit: 30,
    });
  });

  test('tidak ada lagi gerbang jam — pagi pun boleh asal jam kerjanya genap', () => {
    // Check-in 13:00, ambang 21:00. Jam berapa pun tidak lagi jadi penghalang tersendiri.
    expect(bolehCheckout(wib('13:00'), wib('21:00'))).toEqual({ boleh: true });
  });

  test('sisa menit dibulatkan ke atas', () => {
    const sekarang = new Date(wib('18:00').getTime() - 30_000); // 30 detik sebelum ambang
    expect(bolehCheckout(wib('08:00'), sekarang).sisaMenit).toBe(1);
  });
});

describe('batasReminder', () => {
  const tanggal = new Date('2026-08-17T00:00:00.000Z'); // date-only 17 Agustus

  test('jatuh pada 23:00 WIB di tanggal absensinya', () => {
    // 23:00 WIB = 16:00Z pada hari yang sama.
    expect(batasReminder(tanggal).toISOString()).toBe('2026-08-17T16:00:00.000Z');
  });

  test('ambang check-in pagi masih di dalam batas', () => {
    expect(ambangCheckout(wib('08:00')).ambang <= batasReminder(tanggal)).toBe(true);
  });

  test('ambang check-in jam 14:00 masih muat, jam 15:00 sudah lewat', () => {
    // 14:00 + 8 jam = 22:00, masih di bawah batas. 15:00 + 8 jam = 23:00, tepat di batas.
    expect(ambangCheckout(wib('14:00')).ambang <= batasReminder(tanggal)).toBe(true);
    expect(ambangCheckout(wib('15:00')).ambang <= batasReminder(tanggal)).toBe(true);
    // 16:00 + 8 jam = 24:00, sudah melewati hari — tidak boleh ada reminder.
    expect(ambangCheckout(wib('16:00')).ambang > batasReminder(tanggal)).toBe(true);
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
