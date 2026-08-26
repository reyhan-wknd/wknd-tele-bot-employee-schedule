import { describe, expect, test } from 'vitest';
import { ringkasBesok, type KeadaanBesok } from './besok';
import { dateOnly } from './time';

/** Selasa 18 Agustus 2026 — hari kerja biasa. */
const SELASA = dateOnly('2026-08-18');
/** Sabtu 22 Agustus 2026. */
const SABTU = dateOnly('2026-08-22');

const keadaan = (ubahan: Partial<KeadaanBesok> = {}): KeadaanBesok => ({
  tanggal: SELASA,
  cuti: false,
  libur: null,
  projects: [],
  ...ubahan,
});

describe('ringkasBesok', () => {
  test('hari kerja WFH biasa tidak menghasilkan apa-apa', () => {
    expect(ringkasBesok(keadaan())).toBeNull();
  });

  test('jadwal WFO disebut lengkap dengan tanggal dan projectnya', () => {
    const teks = ringkasBesok(keadaan({ projects: ['PPA', 'Prismalink'] }));

    expect(teks).toContain('Besok (Selasa, 18 Agustus 2026)');
    expect(teks).toContain('WFO — PPA, Prismalink');
  });

  test('cuti disebut', () => {
    expect(ringkasBesok(keadaan({ cuti: true }))).toContain('Kamu cuti');
  });

  test('hari libur disebut beserta labelnya', () => {
    expect(ringkasBesok(keadaan({ libur: 'Hari Kemerdekaan' }))).toContain('Libur: Hari Kemerdekaan');
  });

  test('akhir pekan disebut walau tidak ada apa-apa lagi', () => {
    expect(ringkasBesok(keadaan({ tanggal: SABTU }))).toContain('Akhir pekan');
  });

  test('hari libur yang jatuh di akhir pekan disebut libur saja', () => {
    const teks = ringkasBesok(keadaan({ tanggal: SABTU, libur: 'Hari Raya Waisak' }));

    expect(teks).toContain('Hari Raya Waisak');
    expect(teks).not.toMatch(/akhir pekan/i);
  });

  test('WFO di akhir pekan menyebut WFO, bukan hari kosong', () => {
    const teks = ringkasBesok(keadaan({ tanggal: SABTU, projects: ['PPA'] }));

    expect(teks).toContain('WFO — PPA');
    expect(teks).not.toMatch(/akhir pekan/i);
  });

  test('cuti yang bertabrakan dengan jadwal WFO menyebut dua-duanya', () => {
    const teks = ringkasBesok(keadaan({ cuti: true, projects: ['PPA'] }));

    expect(teks).toContain('Kamu cuti');
    expect(teks).toContain('WFO — PPA');
  });
});
