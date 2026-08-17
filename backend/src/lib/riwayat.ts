/**
 * Penyusun baris tabel riwayat absensi, dipisahkan dari database dan Telegram supaya
 * bisa diuji sendiri.
 *
 * Selalu menghasilkan satu baris per hari kalender, termasuk hari yang tidak ada
 * absensinya — justru hari bolong itu yang paling perlu terlihat.
 */

import { durasiKerja, selisihJam } from '../services/attendance';
import { formatTanggalRingkas, formatTimeWIB, isoDateOf, weekdayOf } from './time';

/** Dipakai saat sel tidak punya jam untuk ditampilkan. */
export const SEL_KOSONG = '—';

export interface AbsensiRiwayat {
  date: Date;
  checkIn: Date;
  checkOut: Date | null;
}

export interface BarisRiwayat {
  no: number;
  tanggal: string;
  masuk: string;
  pulang: string;
  /** Merangkap keterangan untuk hari tanpa absensi: Libur, Akhir pekan, Tidak absen. */
  durasi: string;
}

function keteranganHariKosong(hari: Date, libur: ReadonlyMap<string, string>): string {
  // Hari libur didahulukan: kalau libur nasional jatuh di akhir pekan, menyebutnya "libur"
  // lebih menjelaskan daripada "akhir pekan".
  if (libur.has(isoDateOf(hari))) return 'Libur';

  const weekday = weekdayOf(hari);
  if (weekday === 0 || weekday === 6) return 'Akhir pekan';

  return 'Tidak absen';
}

export function susunBarisRiwayat(opsi: {
  hari: readonly Date[];
  absensi: readonly AbsensiRiwayat[];
  libur: ReadonlyMap<string, string>;
}): BarisRiwayat[] {
  const perTanggal = new Map(opsi.absensi.map((a) => [isoDateOf(a.date), a]));

  return opsi.hari.map((hari, index) => {
    const baris = {
      no: index + 1,
      tanggal: formatTanggalRingkas(hari),
      masuk: SEL_KOSONG,
      pulang: SEL_KOSONG,
      durasi: '',
    };

    const absensi = perTanggal.get(isoDateOf(hari));
    if (!absensi) {
      return { ...baris, durasi: keteranganHariKosong(hari, opsi.libur) };
    }

    baris.masuk = formatTimeWIB(absensi.checkIn);

    if (!absensi.checkOut) {
      return { ...baris, durasi: 'Berjalan' };
    }

    const durasi = durasiKerja(selisihJam(absensi.checkIn, absensi.checkOut));
    return {
      ...baris,
      pulang: formatTimeWIB(absensi.checkOut),
      durasi: `${durasi.jam}j ${durasi.menit}m`,
    };
  });
}
