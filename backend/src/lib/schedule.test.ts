import { describe, expect, test } from 'vitest';
import {
  formatDuaMinggu,
  formatJadwalOrang,
  formatProjects,
  groupSchedulesByDate,
  pisahDuaMinggu,
  proyekHariIni,
  rentangDuaMinggu,
} from './schedule';
import { dateOnly, isoDateOf } from './time';

const baris = (tanggal: string, projectName: string) => ({ date: dateOnly(tanggal), projectName });

describe('groupSchedulesByDate', () => {
  test('menggabungkan proyek pada tanggal yang sama', () => {
    const hasil = groupSchedulesByDate([
      baris('2026-08-19', 'PPA'),
      baris('2026-08-19', 'Prismalink'),
    ]);

    expect(hasil).toHaveLength(1);
    expect(formatProjects(hasil[0])).toBe('PPA, Prismalink');
  });

  test('memisahkan tanggal berbeda dan mengurutkannya', () => {
    const hasil = groupSchedulesByDate([
      baris('2026-08-21', 'NEMO'),
      baris('2026-08-19', 'PPA'),
      baris('2026-08-19', 'Prismalink'),
    ]);

    expect(hasil.map((g) => g.date.toISOString().slice(0, 10))).toEqual(['2026-08-19', '2026-08-21']);
    expect(hasil.map(formatProjects)).toEqual(['PPA, Prismalink', 'NEMO']);
  });

  test('mengelompokkan berdasarkan nilai tanggal, bukan identitas objek', () => {
    const hasil = groupSchedulesByDate([
      { date: new Date('2026-08-19T00:00:00.000Z'), projectName: 'PPA' },
      { date: new Date('2026-08-19T00:00:00.000Z'), projectName: 'Prismalink' },
    ]);

    expect(hasil).toHaveLength(1);
  });

  test('daftar kosong menghasilkan daftar kosong', () => {
    expect(groupSchedulesByDate([])).toEqual([]);
  });

  test('tidak mengubah masukan', () => {
    const masukan = [baris('2026-08-19', 'PPA')];
    const salinan = [...masukan];
    groupSchedulesByDate(masukan);

    expect(masukan).toEqual(salinan);
  });
});

/** Rabu, 19 Agustus 2026. Minggu pekan itu 16 Agustus, Sabtunya 22, Sabtu berikutnya 29. */
const RABU = dateOnly('2026-08-19');

describe('rentangDuaMinggu', () => {
  const batas = (today: string) => {
    const r = rentangDuaMinggu(dateOnly(today));
    return [isoDateOf(r.mulai), isoDateOf(r.batasMingguIni), isoDateOf(r.selesai)];
  };

  test('mulai dari hari ini, bukan dari awal pekan', () => {
    expect(batas('2026-08-19')).toEqual(['2026-08-19', '2026-08-22', '2026-08-29']);
  });

  test('hari Minggu adalah awal pekannya sendiri', () => {
    expect(batas('2026-08-16')).toEqual(['2026-08-16', '2026-08-22', '2026-08-29']);
  });

  test('hari Sabtu masih terhitung minggu ini, bukan minggu depan', () => {
    expect(batas('2026-08-22')).toEqual(['2026-08-22', '2026-08-22', '2026-08-29']);
  });

  test('pergantian bulan tidak menggeser perhitungan', () => {
    expect(batas('2026-12-31')).toEqual(['2026-12-31', '2027-01-02', '2027-01-09']);
  });
});

describe('pisahDuaMinggu', () => {
  test('Sabtu masuk minggu ini, Minggu berikutnya masuk minggu depan', () => {
    const rentang = rentangDuaMinggu(RABU);
    const { mingguIni, mingguDepan } = pisahDuaMinggu(
      [baris('2026-08-22', 'PPA'), baris('2026-08-23', 'NEMO')],
      rentang
    );

    expect(mingguIni.map((s) => s.projectName)).toEqual(['PPA']);
    expect(mingguDepan.map((s) => s.projectName)).toEqual(['NEMO']);
  });
});

describe('formatDuaMinggu', () => {
  test('menyusun kedua blok dengan proyek yang digabung per tanggal', () => {
    const teks = formatDuaMinggu(
      [baris('2026-08-19', 'PPA'), baris('2026-08-19', 'Prismalink'), baris('2026-08-25', 'NEMO')],
      rentangDuaMinggu(RABU)
    );

    expect(teks).toBe(
      '\n📌 Minggu ini:\n  • Rabu, 19 Agustus 2026 — PPA, Prismalink\n' +
        '\n📌 Minggu depan:\n  • Selasa, 25 Agustus 2026 — NEMO\n'
    );
  });

  test('minggu tanpa jadwal tetap muncul, dengan keterangannya', () => {
    expect(formatDuaMinggu([], rentangDuaMinggu(RABU))).toBe(
      '\n📌 Minggu ini:\n  Belum ada jadwal\n\n📌 Minggu depan:\n  Belum ada jadwal\n'
    );
  });
});

describe('proyekHariIni', () => {
  test('hanya tanggal yang sama persis yang terhitung', () => {
    const isi = [baris('2026-08-19', 'PPA'), baris('2026-08-19', 'Prismalink'), baris('2026-08-20', 'NEMO')];

    expect(proyekHariIni(isi, RABU)).toEqual(['PPA', 'Prismalink']);
  });

  test('tidak ada jadwal hari itu menghasilkan daftar kosong', () => {
    expect(proyekHariIni([baris('2026-08-20', 'NEMO')], RABU)).toEqual([]);
  });
});

describe('formatJadwalOrang', () => {
  const BUDI = { name: 'Budi Santoso', jobTitle: 'QA Engineer' };

  test('menyebut nama dan jabatan, lalu kedua minggunya', () => {
    const teks = formatJadwalOrang(BUDI, [baris('2026-08-25', 'NEMO')], RABU, rentangDuaMinggu(RABU));

    expect(teks).toContain('👤 Budi Santoso — QA Engineer');
    expect(teks).toContain('📌 Minggu depan:\n  • Selasa, 25 Agustus 2026 — NEMO');
  });

  test('WFO hari ini disebut di baris tersendiri', () => {
    const teks = formatJadwalOrang(
      BUDI,
      [baris('2026-08-19', 'PPA'), baris('2026-08-19', 'Prismalink')],
      RABU,
      rentangDuaMinggu(RABU)
    );

    expect(teks).toContain('📍 Hari ini: 🏢 WFO (PPA, Prismalink)');
  });

  test('tidak ada jadwal hari ini berarti tidak ada barisnya, bukan klaim WFH', () => {
    const teks = formatJadwalOrang(BUDI, [baris('2026-08-25', 'NEMO')], RABU, rentangDuaMinggu(RABU));

    expect(teks).not.toContain('Hari ini');
    expect(teks).not.toContain('WFH');
    expect(teks).not.toContain('Day Off');
  });

  test('tanpa jadwal sama sekali, kedua blok minggu tidak ikut ditampilkan', () => {
    const teks = formatJadwalOrang(BUDI, [], RABU, rentangDuaMinggu(RABU));

    expect(teks).toBe(
      '👤 Budi Santoso — QA Engineer\n\n📅 Tidak ada jadwal WFO terdaftar untuk minggu ini maupun minggu depan.'
    );
  });
});
