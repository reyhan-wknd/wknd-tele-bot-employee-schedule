/**
 * Aturan hari libur, dipisahkan dari database dan Telegram supaya bisa diuji sendiri.
 *
 * Dua bentuk entri, dibedakan oleh kolom `year`:
 *   - `year = 0`  : berulang tiap tahun — untuk tanggal yang memang tetap (17 Agustus).
 *   - `year > 0`  : berlaku sekali saja — untuk libur yang bergeser tiap tahun
 *                   (Idul Fitri, Nyepi) dan cuti bersama.
 */

import { addDays, dateOnly, isoDateOf } from './time';

/** Penanda entri yang berlaku tiap tahun. */
export const TAHUN_BERULANG = 0;

const HARI_DALAM_SETAHUN = 365;

/**
 * Kolom label muat 255 karakter, tapi batasnya sengaja jauh lebih ketat: nama hari libur
 * itu pendek, dan label panjang membuat daftar /holiday menabrak batas pesan Telegram.
 * Tanpa batas ini, label 257 karakter lolos sampai MySQL dan balasannya jadi error server.
 */
export const MAKS_PANJANG_LABEL = 100;

/** Batas pesan Telegram 4096 karakter; sisakan ruang untuk judul dan pemenggalan. */
const MAKS_PANJANG_PESAN = 3500;

const TAHUN_MIN = 1970;
const TAHUN_MAKS = 2100;

export interface HariLibur {
  year: number;
  month: number;
  day: number;
  label: string;
}

export type TanggalLibur = Pick<HariLibur, 'year' | 'month' | 'day'>;

export type Hasil<T> = { ok: true; nilai: T } | { ok: false; pesan: string };

function kabisat(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Entri berulang diperlakukan sebagai tahun non-kabisat: 29 Februari tidak ada di
 * mayoritas tahun, jadi menyimpannya sebagai "tiap tahun" tidak punya arti yang jelas.
 */
export function hariDalamBulan(year: number, month: number): number {
  const panjang = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && year !== TAHUN_BERULANG && kabisat(year)) return 29;
  return panjang[month - 1] ?? 0;
}

export function tanggalValid({ year, month, day }: TanggalLibur): boolean {
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= hariDalamBulan(year, month);
}

/**
 * `0817`     → berulang tiap 17 Agustus
 * `20260321` → hanya 21 Maret 2026
 */
export function parseArgumenTanggal(raw: string): Hasil<TanggalLibur> {
  const bersih = raw.trim();

  if (!/^\d+$/.test(bersih) || (bersih.length !== 4 && bersih.length !== 8)) {
    return {
      ok: false,
      pesan: 'Tanggal harus 4 digit MMDD (berulang tiap tahun) atau 8 digit YYYYMMDD (sekali saja).',
    };
  }

  const berulang = bersih.length === 4;
  const year = berulang ? TAHUN_BERULANG : Number(bersih.slice(0, 4));
  const month = Number(bersih.slice(berulang ? 0 : 4, berulang ? 2 : 6));
  const day = Number(bersih.slice(berulang ? 2 : 6));

  if (!berulang && (year < TAHUN_MIN || year > TAHUN_MAKS)) {
    return { ok: false, pesan: `Tahun ${year} tidak masuk akal.` };
  }

  if (!tanggalValid({ year, month, day })) {
    const alasan =
      berulang && month === 2 && day === 29
        ? '29 Februari tidak ada di tahun non-kabisat, jadi tidak bisa dipakai sebagai entri berulang. Pakai bentuk YYYYMMDD, misalnya 20280229.'
        : 'Tanggal itu tidak ada.';
    return { ok: false, pesan: alasan };
  }

  return { ok: true, nilai: { year, month, day } };
}

export type AksiKelola = 'add' | 'edit' | 'remove';

export interface PerintahKelola {
  aksi: AksiKelola;
  tanggal: TanggalLibur;
  label: string;
}

const CONTOH_PEMAKAIAN = [
  'Contoh:',
  '  /manage_holiday add 0817 Hari Kemerdekaan',
  '  /manage_holiday add 20260321 Hari Idul Fitri',
  '  /manage_holiday edit 0817 HUT RI',
  '  /manage_holiday remove 0817',
].join('\n');

/**
 * @param sisa teks setelah nama perintah, mis. `add 0817 Hari Kemerdekaan`
 */
export function parsePerintahKelola(sisa: string): Hasil<PerintahKelola> {
  const token = sisa.trim().split(/\s+/).filter(Boolean);
  const aksi = token[0]?.toLowerCase();

  if (aksi !== 'add' && aksi !== 'edit' && aksi !== 'remove') {
    return { ok: false, pesan: `Aksi harus add, edit, atau remove.\n\n${CONTOH_PEMAKAIAN}` };
  }

  if (!token[1]) {
    return { ok: false, pesan: `Tanggalnya belum diisi.\n\n${CONTOH_PEMAKAIAN}` };
  }

  const tanggal = parseArgumenTanggal(token[1]);
  if (!tanggal.ok) return tanggal;

  // Label diambil dari sisa baris supaya tidak perlu tanda kutip di HP; kalau terlanjur
  // dikutip, kutipnya dilucuti agar tidak ikut tersimpan.
  const label = token.slice(2).join(' ').replace(/^["'](.*)["']$/s, '$1').trim();

  if (aksi !== 'remove' && !label) {
    return { ok: false, pesan: `Label belum diisi.\n\n${CONTOH_PEMAKAIAN}` };
  }

  if (label.length > MAKS_PANJANG_LABEL) {
    return {
      ok: false,
      pesan: `Label terlalu panjang (${label.length} karakter, maksimal ${MAKS_PANJANG_LABEL}).`,
    };
  }

  return { ok: true, nilai: { aksi, tanggal: tanggal.nilai, label } };
}

/** Entri berulang cocok lewat bulan+tanggal, entri sekali harus cocok persis. */
export function cocokHariLibur(rows: readonly HariLibur[], tanggal: Date): HariLibur | null {
  const year = tanggal.getUTCFullYear();
  const month = tanggal.getUTCMonth() + 1;
  const day = tanggal.getUTCDate();

  // Entri khusus tahun didahulukan supaya bisa dipakai menimpa entri berulang.
  const persis = rows.find((r) => r.year === year && r.month === month && r.day === day);
  if (persis) return persis;

  return rows.find((r) => r.year === TAHUN_BERULANG && r.month === month && r.day === day) ?? null;
}

export interface LiburMendatang {
  tanggal: Date;
  label: string;
  berulang: boolean;
}

function bentukTanggal(year: number, month: number, day: number): Date {
  return dateOnly(
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  );
}

/**
 * Daftar libur dari `mulai` sampai 365 hari ke depan.
 *
 * Entri berulang diproyeksikan ke kemunculan berikutnya — dicoba di tahun `mulai` dan
 * tahun sesudahnya, karena jendela 365 hari hampir selalu memotong pergantian tahun.
 */
export function libur365Hari(rows: readonly HariLibur[], mulai: Date): LiburMendatang[] {
  const akhir = addDays(mulai, HARI_DALAM_SETAHUN - 1);
  const tahunAwal = mulai.getUTCFullYear();

  // Tanggal yang sama hanya boleh muncul sekali; entri khusus tahun menang atas berulang.
  const terkumpul = new Map<string, LiburMendatang>();

  const catat = (tanggal: Date, label: string, berulang: boolean) => {
    if (tanggal < mulai || tanggal > akhir) return;
    const kunci = isoDateOf(tanggal);
    const sudahAda = terkumpul.get(kunci);
    if (sudahAda && !sudahAda.berulang) return;
    terkumpul.set(kunci, { tanggal, label, berulang });
  };

  for (const row of rows) {
    if (row.year === TAHUN_BERULANG) {
      for (const year of [tahunAwal, tahunAwal + 1]) {
        if (!tanggalValid({ year, month: row.month, day: row.day })) continue;
        catat(bentukTanggal(year, row.month, row.day), row.label, true);
      }
      continue;
    }

    if (!tanggalValid(row)) continue;
    catat(bentukTanggal(row.year, row.month, row.day), row.label, false);
  }

  return [...terkumpul.values()].sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
}

/**
 * Pecah daftar baris menjadi beberapa pesan supaya tidak menabrak batas Telegram.
 *
 * Daftar libur bisa panjang — sekitar 30 entri setahun, dan tiap label boleh sampai
 * seratus karakter — jadi satu pesan tidak selalu cukup.
 */
export function potongMenjadiPesan(judul: string, baris: readonly string[]): string[] {
  if (baris.length === 0) return [];

  const pesan: string[] = [];
  let sekarang = judul;

  for (const satu of baris) {
    // Baris yang sendirian saja sudah kepanjangan tetap dikirim apa adanya, karena
    // membuangnya diam-diam lebih buruk daripada satu pesan yang kepanjangan.
    if (sekarang !== judul && sekarang.length + satu.length + 1 > MAKS_PANJANG_PESAN) {
      pesan.push(sekarang);
      sekarang = '';
    }
    // Judul sudah membawa pemisahnya sendiri, jadi jangan tambah baris kosong lagi.
    const perluPemisah = sekarang !== '' && !sekarang.endsWith('\n');
    sekarang += (perluPemisah ? '\n' : '') + satu;
  }

  if (sekarang) pesan.push(sekarang);
  return pesan;
}
