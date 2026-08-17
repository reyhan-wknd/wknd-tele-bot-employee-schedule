/**
 * Aturan absensi, dipisahkan dari handler bot supaya bisa diuji tanpa Telegram
 * maupun database.
 */

import { instanWIB, isoDateOf, wibClock } from '../lib/time';

export const JAM_MULAI_CHECKIN = 8;

/** Jam kerja resmi mulai 09:00 — datang lebih pagi tidak memajukan jam pulang. */
export const JAM_MULAI_KERJA = 9;

/** Jendela istirahat 12:00–13:00. */
export const JAM_ISTIRAHAT_MULAI = 12;
export const JAM_ISTIRAHAT_SELESAI = 13;

export const MENIT_KERJA_WAJIB = 8 * 60;
export const MENIT_ISTIRAHAT_PENUH = 60;

export type AlasanTolakCheckin = 'akhir-pekan' | 'belum-jam-kerja';
export type AlasanTolakCheckout = 'belum-cukup-jam';

export interface Keputusan<T extends string> {
  boleh: boolean;
  alasan?: T;
  /** Diisi saat ditolak karena belum genap 8 jam. */
  sisaMenit?: number;
}

/**
 * Dua alasan penolakan diperlakukan berbeda oleh pemanggilnya, jadi urutannya penting:
 *
 *   - `belum-jam-kerja` adalah penolakan mutlak.
 *   - `akhir-pekan` hanya berarti "perlu dikonfirmasi dulu" — sebagian orang memang
 *     masuk di akhir pekan, dan absensinya tetap harus bisa tercatat.
 *
 * Karena itu jam diperiksa lebih dulu. Kalau tidak, Sabtu jam 6 pagi akan menghasilkan
 * `akhir-pekan`, lalu tombol konfirmasi membuat aturan jam 08:00 bisa ditembus.
 */
export function bolehCheckin(weekday: number, jamWIB: number): Keputusan<AlasanTolakCheckin> {
  if (jamWIB < JAM_MULAI_CHECKIN) return { boleh: false, alasan: 'belum-jam-kerja' };
  if (weekday === 0 || weekday === 6) return { boleh: false, alasan: 'akhir-pekan' };
  return { boleh: true };
}

/**
 * Ambang jam pulang untuk satu check-in.
 *
 * Istirahatnya proporsional, bukan lompatan: yang mulai 12:30 hanya kebagian sisa 30 menit
 * jendela istirahat. Itu membuat ambangnya bersambung — mulai 12:30 dan mulai 13:00
 * sama-sama berujung 21:00 — sehingga tidak ada celah yang bisa dimanfaatkan dengan
 * menggeser check-in beberapa menit.
 */
export function ambangCheckout(checkIn: Date): { ambang: Date; menitWajib: number } {
  const { date, hour, minute } = wibClock(checkIn);

  const menitMulaiEfektif = Math.max(hour * 60 + minute, JAM_MULAI_KERJA * 60);

  const sisaJendelaIstirahat =
    JAM_ISTIRAHAT_SELESAI * 60 - Math.max(menitMulaiEfektif, JAM_ISTIRAHAT_MULAI * 60);
  const menitIstirahat = Math.min(Math.max(sisaJendelaIstirahat, 0), MENIT_ISTIRAHAT_PENUH);

  const menitWajib = MENIT_KERJA_WAJIB + menitIstirahat;

  return {
    ambang: instanWIB(date, 0, menitMulaiEfektif + menitWajib),
    menitWajib,
  };
}

/** Setelah jam ini tidak ada lagi reminder — check-out sendiri terkunci pukul 23:59. */
export const JAM_BATAS_REMINDER = 23;

/** Pukul 23:00 WIB pada tanggal absensi; reminder tidak boleh dijadwalkan melewatinya. */
export function batasReminder(tanggalAbsensi: Date): Date {
  return instanWIB(isoDateOf(tanggalAbsensi), JAM_BATAS_REMINDER, 0);
}

/**
 * Tidak ada lagi gerbang jam pulang — check-out boleh kapan saja setelah check-in.
 * Yang belum mencapai ambang bukan ditolak, melainkan diminta konfirmasi oleh pemanggilnya.
 */
export function bolehCheckout(checkIn: Date, sekarang: Date): Keputusan<AlasanTolakCheckout> {
  const { ambang } = ambangCheckout(checkIn);
  if (sekarang >= ambang) return { boleh: true };

  return {
    boleh: false,
    alasan: 'belum-cukup-jam',
    sisaMenit: Math.ceil((ambang.getTime() - sekarang.getTime()) / 60_000),
  };
}

/** Pembulatan menit dijaga agar tidak pernah menghasilkan "8j 60m". */
export function durasiKerja(jamDesimal: number): { jam: number; menit: number } {
  const jam = Math.floor(jamDesimal);
  const menit = Math.round((jamDesimal - jam) * 60);
  return menit === 60 ? { jam: jam + 1, menit: 0 } : { jam, menit };
}

export function selisihJam(mulai: Date, selesai: Date): number {
  return (selesai.getTime() - mulai.getTime()) / (1000 * 60 * 60);
}
