/**
 * Aturan absensi, dipisahkan dari handler bot supaya bisa diuji tanpa Telegram
 * maupun database.
 */

export const JAM_MULAI_CHECKIN = 8;
export const JAM_MULAI_CHECKOUT = 18;
export const MINIMAL_JAM_KERJA = 8;

export type AlasanTolakCheckin = 'akhir-pekan' | 'belum-jam-kerja';
export type AlasanTolakCheckout = 'belum-jam-pulang' | 'belum-8-jam';

export interface Keputusan<T extends string> {
  boleh: boolean;
  alasan?: T;
  /** Diisi saat ditolak karena belum genap 8 jam. */
  sisaMenit?: number;
}

export function bolehCheckin(weekday: number, jamWIB: number): Keputusan<AlasanTolakCheckin> {
  if (weekday === 0 || weekday === 6) return { boleh: false, alasan: 'akhir-pekan' };
  if (jamWIB < JAM_MULAI_CHECKIN) return { boleh: false, alasan: 'belum-jam-kerja' };
  return { boleh: true };
}

/**
 * @param lanjutanKemarin absensi yang ditutup berasal dari hari sebelumnya — batas jam
 *        pulang tidak berlaku karena sudah pasti terlewati.
 */
export function bolehCheckout(opsi: {
  lanjutanKemarin: boolean;
  jamWIB: number;
  jamKerja: number;
}): Keputusan<AlasanTolakCheckout> {
  if (!opsi.lanjutanKemarin && opsi.jamWIB < JAM_MULAI_CHECKOUT) {
    return { boleh: false, alasan: 'belum-jam-pulang' };
  }

  if (opsi.jamKerja < MINIMAL_JAM_KERJA) {
    return {
      boleh: false,
      alasan: 'belum-8-jam',
      sisaMenit: Math.ceil((MINIMAL_JAM_KERJA - opsi.jamKerja) * 60),
    };
  }

  return { boleh: true };
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
