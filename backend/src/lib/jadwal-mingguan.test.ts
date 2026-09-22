import { describe, expect, test } from 'vitest';
import {
  hariCek,
  pekanDepan,
  snapshotJadwal,
  tentukanKabar,
  type Catatan,
  type HariCek,
  type JadwalHari,
} from './jadwal-mingguan';
import { dateOnly, isoDateOf } from './time';

const JUMAT = '2026-09-25';
const SABTU = '2026-09-26';
const MINGGU = '2026-09-27';

const JADWAL: JadwalHari[] = [
  { tanggal: '2026-09-28', projects: ['HERO'] },
  { tanggal: '2026-09-29', projects: ['HERO'] },
  { tanggal: '2026-10-01', projects: ['HERO'] },
];

const kabar = (
  hari: HariCek,
  hariIni: string,
  terbit: boolean,
  jadwal: JadwalHari[],
  catatan: Catatan | null = null
) => tentukanKabar({ hari, hariIni, terbit, jadwal, catatan });

const terkirim = (snapshot: JadwalHari[], notifiedOn = JUMAT): Catatan => ({ status: 'terkirim', snapshot, notifiedOn });
const belumTerbit = (notifiedOn: string): Catatan => ({ status: 'belum-terbit', snapshot: [], notifiedOn });

describe('hariCek dan pekanDepan', () => {
  test('hanya Jumat, Sabtu, dan Minggu yang merupakan hari pengecekan', () => {
    expect(hariCek(dateOnly(JUMAT))).toBe('jumat');
    expect(hariCek(dateOnly(SABTU))).toBe('sabtu');
    expect(hariCek(dateOnly(MINGGU))).toBe('minggu');
    expect(hariCek(dateOnly('2026-09-24'))).toBeNull(); // Kamis
    expect(hariCek(dateOnly('2026-09-28'))).toBeNull(); // Senin
  });

  test('ketiga hari itu menunjuk Senin–Jumat yang sama', () => {
    for (const hari of [JUMAT, SABTU, MINGGU]) {
      const { senin, jumat } = pekanDepan(dateOnly(hari));
      expect([isoDateOf(senin), isoDateOf(jumat)]).toEqual(['2026-09-28', '2026-10-02']);
    }
  });
});

describe('snapshotJadwal', () => {
  test('dikelompokkan per tanggal, terurut, dan project-nya diurutkan', () => {
    const baris = [
      { date: dateOnly('2026-09-30'), projectName: 'PPA' },
      { date: dateOnly('2026-09-28'), projectName: 'HERO' },
      { date: dateOnly('2026-09-30'), projectName: 'DTE, OSEM' },
    ];

    expect(snapshotJadwal(baris)).toEqual([
      { tanggal: '2026-09-28', projects: ['HERO'] },
      { tanggal: '2026-09-30', projects: ['DTE, OSEM', 'PPA'] },
    ]);
  });
});

describe('roster pekan depan belum terbit', () => {
  test('Jumat: dikabari belum terbit, dicek lagi Sabtu', () => {
    const k = kabar('jumat', JUMAT, false, []);

    expect(k.alasan).toBe('belum-terbit');
    expect(k.pesan).toMatch(/belum terbit/);
    expect(k.pesan).toMatch(/besok \(Sabtu\)/);
    expect(k.catatan).toEqual(belumTerbit(JUMAT));
  });

  test('Sabtu: dikabari lagi, kini dicek lagi Minggu', () => {
    const k = kabar('sabtu', SABTU, false, [], belumTerbit(JUMAT));

    expect(k.alasan).toBe('belum-terbit');
    expect(k.pesan).toMatch(/besok \(Minggu\)/);
    expect(k.catatan).toEqual(belumTerbit(SABTU));
  });

  test('Minggu: kesimpulan akhir — tidak ada WFO pekan depan', () => {
    const k = kabar('minggu', MINGGU, false, [], belumTerbit(SABTU));

    expect(k.alasan).toBe('tidak-terbit');
    expect(k.pesan).toMatch(/tidak ada WFO/);
    expect(k.catatan).toEqual({ status: 'tidak-terbit', snapshot: [], notifiedOn: MINGGU });
  });

  test('dijalankan ulang di hari yang sama tidak mengirim dobel', () => {
    expect(kabar('sabtu', SABTU, false, [], belumTerbit(SABTU)).pesan).toBeNull();
    expect(
      kabar('minggu', MINGGU, false, [], { status: 'tidak-terbit', snapshot: [], notifiedOn: MINGGU }).pesan
    ).toBeNull();
  });

  test('roster yang lenyap setelah jadwal terkirim dianggap gangguan, bukan kabar', () => {
    const k = kabar('sabtu', SABTU, false, [], terkirim(JADWAL));

    expect(k).toEqual({ alasan: 'roster-hilang', pesan: null, catatan: null });
  });
});

describe('roster pekan depan sudah terbit', () => {
  test('kabar pertama: jadwal lengkap', () => {
    const k = kabar('jumat', JUMAT, true, JADWAL);

    expect(k.alasan).toBe('jadwal');
    expect(k.pesan).toBe(
      '📅 Jadwal WFO kamu minggu depan:\n\n' +
        '  • Senin, 28 September 2026 — HERO\n' +
        '  • Selasa, 29 September 2026 — HERO\n' +
        '  • Kamis, 1 Oktober 2026 — HERO'
    );
    expect(k.catatan).toEqual(terkirim(JADWAL, JUMAT));
  });

  test('terbit tapi ia tidak dapat WFO: langsung dikabari, tanpa menunggu Minggu', () => {
    const k = kabar('jumat', JUMAT, true, []);

    expect(k.alasan).toBe('tanpa-wfo');
    expect(k.pesan).toMatch(/tidak dijadwalkan WFO/);
    expect(k.catatan).toEqual(terkirim([], JUMAT));
  });

  test('baru terbit Sabtu setelah Jumat dikabari belum terbit: jadwal lengkap', () => {
    const k = kabar('sabtu', SABTU, true, JADWAL, belumTerbit(JUMAT));

    expect(k.alasan).toBe('jadwal');
    expect(k.catatan).toEqual(terkirim(JADWAL, SABTU));
  });

  test('isinya sama dengan yang sudah dikirim: diam', () => {
    expect(kabar('sabtu', SABTU, true, JADWAL, terkirim(JADWAL))).toEqual({
      alasan: 'sama',
      pesan: null,
      catatan: null,
    });
    expect(kabar('minggu', MINGGU, true, [], terkirim([])).pesan).toBeNull();
  });

  test('isinya berubah: jadwal lengkap dengan tanda perubahan', () => {
    const baru: JadwalHari[] = [
      { tanggal: '2026-09-28', projects: ['HERO'] },
      { tanggal: '2026-09-30', projects: ['HERO', 'PPA'] },
      { tanggal: '2026-10-01', projects: ['PPA'] },
    ];

    const k = kabar('sabtu', SABTU, true, baru, terkirim(JADWAL));

    expect(k.alasan).toBe('berubah');
    expect(k.pesan).toBe(
      '🔄 Jadwal WFO minggu depan berubah:\n\n' +
        '  • Senin, 28 September 2026 — HERO\n' +
        '  • Rabu, 30 September 2026 — HERO, PPA  🆕\n' +
        '  • Kamis, 1 Oktober 2026 — PPA  ✏️\n\n' +
        '❌ Tidak lagi WFO:\n' +
        '  • Selasa, 29 September 2026'
    );
    expect(k.catatan).toEqual(terkirim(baru, SABTU));
  });

  test('semua jadwalnya dicabut', () => {
    const k = kabar('minggu', MINGGU, true, [], terkirim(JADWAL));

    expect(k.alasan).toBe('berubah');
    expect(k.pesan).toBe(
      '🔄 Jadwal WFO minggu depan berubah: kamu tidak lagi dijadwalkan WFO.\n\n' +
        '❌ Tidak lagi WFO:\n' +
        '  • Senin, 28 September 2026\n' +
        '  • Selasa, 29 September 2026\n' +
        '  • Kamis, 1 Oktober 2026'
    );
    expect(k.catatan).toEqual(terkirim([], MINGGU));
  });

  test('tadinya tidak dapat WFO, kini dapat: semuanya bertanda baru', () => {
    const k = kabar('sabtu', SABTU, true, [JADWAL[0]], terkirim([]));

    expect(k.alasan).toBe('berubah');
    expect(k.pesan).toBe('🔄 Jadwal WFO minggu depan berubah:\n\n  • Senin, 28 September 2026 — HERO  🆕');
  });

  test('sudah dikabari tidak terbit, lalu ternyata terbit tanpa WFO untuknya: diam', () => {
    const catatan: Catatan = { status: 'tidak-terbit', snapshot: [], notifiedOn: MINGGU };

    expect(kabar('minggu', MINGGU, true, [], catatan).pesan).toBeNull();
  });
});
