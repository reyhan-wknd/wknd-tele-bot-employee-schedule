import { describe, expect, test } from 'vitest';
import {
  cocokHariLibur,
  libur365Hari,
  MAKS_PANJANG_LABEL,
  parseArgumenTanggal,
  parsePerintahKelola,
  potongMenjadiPesan,
  TAHUN_BERULANG,
  tanggalValid,
  type HariLibur,
} from './holiday';
import { dateOnly, isoDateOf } from './time';

describe('parseArgumenTanggal', () => {
  test('4 digit menjadi entri berulang tiap tahun', () => {
    const hasil = parseArgumenTanggal('0817');
    expect(hasil).toEqual({ ok: true, nilai: { year: TAHUN_BERULANG, month: 8, day: 17 } });
  });

  test('8 digit menjadi entri sekali pada tahun itu', () => {
    const hasil = parseArgumenTanggal('20260321');
    expect(hasil).toEqual({ ok: true, nilai: { year: 2026, month: 3, day: 21 } });
  });

  test('panjang selain 4 dan 8 digit ditolak', () => {
    for (const raw of ['817', '081', '202603211', 'abcd', '']) {
      expect(parseArgumenTanggal(raw).ok).toBe(false);
    }
  });

  test('tanggal yang tidak ada ditolak', () => {
    expect(parseArgumenTanggal('1332').ok).toBe(false); // bulan 13
    expect(parseArgumenTanggal('0431').ok).toBe(false); // April cuma 30 hari
    expect(parseArgumenTanggal('20260230').ok).toBe(false);
  });

  test('29 Februari ditolak sebagai entri berulang, diterima sebagai tahun kabisat', () => {
    const berulang = parseArgumenTanggal('0229');
    expect(berulang.ok).toBe(false);
    if (!berulang.ok) expect(berulang.pesan).toMatch(/kabisat/);

    expect(parseArgumenTanggal('20280229').ok).toBe(true);
    expect(parseArgumenTanggal('20260229').ok).toBe(false); // 2026 bukan kabisat
  });

  test('spasi di tepi tidak membuatnya gagal', () => {
    expect(parseArgumenTanggal('  0817 ').ok).toBe(true);
  });
});

describe('tanggalValid', () => {
  test('entri berulang memperlakukan Februari sebagai 28 hari', () => {
    expect(tanggalValid({ year: TAHUN_BERULANG, month: 2, day: 28 })).toBe(true);
    expect(tanggalValid({ year: TAHUN_BERULANG, month: 2, day: 29 })).toBe(false);
  });
});

describe('parsePerintahKelola', () => {
  test('add dengan label berspasi tanpa tanda kutip', () => {
    const hasil = parsePerintahKelola('add 0817 Hari Kemerdekaan Indonesia');
    expect(hasil).toEqual({
      ok: true,
      nilai: {
        aksi: 'add',
        tanggal: { year: TAHUN_BERULANG, month: 8, day: 17 },
        label: 'Hari Kemerdekaan Indonesia',
      },
    });
  });

  test('tanda kutip dilucuti kalau terlanjur dipakai', () => {
    const hasil = parsePerintahKelola('add 0817 "Hari Kemerdekaan"');
    expect(hasil.ok && hasil.nilai.label).toBe('Hari Kemerdekaan');
  });

  test('remove tidak butuh label', () => {
    const hasil = parsePerintahKelola('remove 0817');
    expect(hasil.ok && hasil.nilai.aksi).toBe('remove');
  });

  test('add dan edit tanpa label ditolak', () => {
    expect(parsePerintahKelola('add 0817').ok).toBe(false);
    expect(parsePerintahKelola('edit 0817').ok).toBe(false);
  });

  test('aksi tak dikenal ditolak dan menyertakan contoh', () => {
    const hasil = parsePerintahKelola('hapus 0817');
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/\/manage_holiday add/);
  });

  test('aksi tidak peka huruf besar-kecil', () => {
    expect(parsePerintahKelola('ADD 0817 Natal').ok).toBe(true);
  });

  test('perintah kosong ditolak, bukan bikin crash', () => {
    expect(parsePerintahKelola('').ok).toBe(false);
    expect(parsePerintahKelola('   ').ok).toBe(false);
  });

  test('label kepanjangan ditolak di sini, bukan dilempar ke MySQL', () => {
    const panjang = 'x'.repeat(MAKS_PANJANG_LABEL + 1);
    const hasil = parsePerintahKelola(`add 0817 ${panjang}`);

    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.pesan).toMatch(/terlalu panjang/i);
  });

  test('label tepat di batas masih diterima', () => {
    const pas = 'x'.repeat(MAKS_PANJANG_LABEL);
    expect(parsePerintahKelola(`add 0817 ${pas}`).ok).toBe(true);
  });

  test('label berisi karakter markdown tetap diterima apa adanya', () => {
    const hasil = parsePerintahKelola('add 0817 Hari *Kemerdekaan* _RI_');
    expect(hasil.ok && hasil.nilai.label).toBe('Hari *Kemerdekaan* _RI_');
  });

  test('label multi-baris dirapatkan jadi satu baris', () => {
    const hasil = parsePerintahKelola('add 0817 Hari\nKemerdekaan');
    expect(hasil.ok && hasil.nilai.label).toBe('Hari Kemerdekaan');
  });

  test('tahun di luar rentang wajar ditolak', () => {
    expect(parseArgumenTanggal('19690817').ok).toBe(false);
    expect(parseArgumenTanggal('21010817').ok).toBe(false);
    expect(parseArgumenTanggal('20260817').ok).toBe(true);
  });
});

describe('potongMenjadiPesan', () => {
  test('daftar kosong tidak menghasilkan pesan sama sekali', () => {
    expect(potongMenjadiPesan('Judul\n\n', [])).toEqual([]);
  });

  test('daftar pendek muat dalam satu pesan berjudul', () => {
    const pesan = potongMenjadiPesan('Judul\n\n', ['  • a', '  • b']);
    expect(pesan).toHaveLength(1);
    expect(pesan[0]).toBe('Judul\n\n  • a\n  • b');
  });

  test('daftar panjang dipecah dan tiap pesan tetap di bawah batas Telegram', () => {
    const baris = Array.from({ length: 200 }, (_, i) => `  • ${'x'.repeat(100)} ${i}`);
    const pesan = potongMenjadiPesan('Judul\n\n', baris);

    expect(pesan.length).toBeGreaterThan(1);
    for (const satu of pesan) expect(satu.length).toBeLessThan(4096);
  });

  test('tidak ada baris yang hilang saat dipecah', () => {
    const baris = Array.from({ length: 200 }, (_, i) => `baris-${i}`);
    const gabung = potongMenjadiPesan('Judul\n\n', baris).join('\n');

    for (const satu of baris) expect(gabung).toContain(satu);
  });

  test('judul hanya muncul di pesan pertama', () => {
    const baris = Array.from({ length: 200 }, (_, i) => `  • ${'x'.repeat(100)} ${i}`);
    const pesan = potongMenjadiPesan('JUDUL\n\n', baris);

    expect(pesan[0].startsWith('JUDUL')).toBe(true);
    for (const lanjutan of pesan.slice(1)) expect(lanjutan).not.toContain('JUDUL');
  });
});

describe('cocokHariLibur', () => {
  const rows: HariLibur[] = [
    { year: TAHUN_BERULANG, month: 8, day: 17, label: 'Hari Kemerdekaan' },
    { year: 2026, month: 3, day: 21, label: 'Hari Idul Fitri' },
  ];

  test('entri berulang cocok di tahun mana pun', () => {
    expect(cocokHariLibur(rows, dateOnly('2026-08-17'))?.label).toBe('Hari Kemerdekaan');
    expect(cocokHariLibur(rows, dateOnly('2031-08-17'))?.label).toBe('Hari Kemerdekaan');
  });

  test('entri sekali hanya cocok di tahunnya sendiri', () => {
    expect(cocokHariLibur(rows, dateOnly('2026-03-21'))?.label).toBe('Hari Idul Fitri');
    expect(cocokHariLibur(rows, dateOnly('2027-03-21'))).toBeNull();
  });

  test('hari biasa tidak cocok', () => {
    expect(cocokHariLibur(rows, dateOnly('2026-08-18'))).toBeNull();
  });

  test('entri khusus tahun menimpa entri berulang di tanggal yang sama', () => {
    const dengan_timpaan: HariLibur[] = [
      ...rows,
      { year: 2026, month: 8, day: 17, label: 'HUT RI ke-81' },
    ];
    expect(cocokHariLibur(dengan_timpaan, dateOnly('2026-08-17'))?.label).toBe('HUT RI ke-81');
  });
});

describe('libur365Hari', () => {
  const rows: HariLibur[] = [
    { year: TAHUN_BERULANG, month: 8, day: 17, label: 'Hari Kemerdekaan' },
    { year: TAHUN_BERULANG, month: 1, day: 1, label: 'Tahun Baru' },
    { year: 2026, month: 12, day: 25, label: 'Natal 2026' },
    { year: 2020, month: 5, day: 1, label: 'Sudah lewat' },
  ];

  test('entri berulang ikut diproyeksikan melewati pergantian tahun', () => {
    const hasil = libur365Hari(rows, dateOnly('2026-08-16'));
    const tanggal = hasil.map((h) => isoDateOf(h.tanggal));

    expect(tanggal).toContain('2026-08-17'); // tahun berjalan
    expect(tanggal).toContain('2027-01-01'); // tahun berikutnya
    expect(tanggal).toContain('2026-12-25');
  });

  test('yang sudah lewat dan di luar jendela tidak ikut', () => {
    const hasil = libur365Hari(rows, dateOnly('2026-08-16'));
    const label = hasil.map((h) => h.label);

    expect(label).not.toContain('Sudah lewat');
    expect(hasil.every((h) => isoDateOf(h.tanggal) >= '2026-08-16')).toBe(true);
    expect(hasil.every((h) => isoDateOf(h.tanggal) <= '2027-08-15')).toBe(true);
  });

  test('hasilnya urut menaik', () => {
    const hasil = libur365Hari(rows, dateOnly('2026-08-16'));
    const waktu = hasil.map((h) => h.tanggal.getTime());
    expect(waktu).toEqual([...waktu].sort((a, b) => a - b));
  });

  test('tanggal yang sama tidak muncul dua kali, entri khusus tahun yang dipakai', () => {
    const bentrok: HariLibur[] = [
      { year: TAHUN_BERULANG, month: 8, day: 17, label: 'Hari Kemerdekaan' },
      { year: 2026, month: 8, day: 17, label: 'HUT RI ke-81' },
    ];
    const hasil = libur365Hari(bentrok, dateOnly('2026-08-01'));
    const tanggal17 = hasil.filter((h) => isoDateOf(h.tanggal) === '2026-08-17');

    expect(tanggal17).toHaveLength(1);
    expect(tanggal17[0].label).toBe('HUT RI ke-81');
    expect(tanggal17[0].berulang).toBe(false);
  });

  test('hari pertama dan hari ke-365 termasuk jendela', () => {
    const rowsBatas: HariLibur[] = [
      { year: 2026, month: 8, day: 16, label: 'Hari ini' },
      { year: 2027, month: 8, day: 15, label: 'Hari ke-365' },
      { year: 2027, month: 8, day: 16, label: 'Sehari kelewat' },
    ];
    const label = libur365Hari(rowsBatas, dateOnly('2026-08-16')).map((h) => h.label);

    expect(label).toContain('Hari ini');
    expect(label).toContain('Hari ke-365');
    expect(label).not.toContain('Sehari kelewat');
  });

  test('29 Februari berulang yang terlanjur tersimpan diabaikan, bukan bikin crash', () => {
    const rusak: HariLibur[] = [{ year: TAHUN_BERULANG, month: 2, day: 29, label: 'Aneh' }];
    expect(() => libur365Hari(rusak, dateOnly('2026-01-01'))).not.toThrow();
    expect(libur365Hari(rusak, dateOnly('2026-01-01'))).toHaveLength(0);
  });
});
