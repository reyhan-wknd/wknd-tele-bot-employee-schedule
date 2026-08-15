import { describe, expect, test } from 'vitest';
import { formatProjects, groupSchedulesByDate } from './schedule';
import { dateOnly } from './time';

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
