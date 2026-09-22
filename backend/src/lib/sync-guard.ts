/**
 * Sync mengganti seluruh isi tabel jadwal, jadi hasil fetch harus masuk akal dulu.
 *
 * Yang dicurigai hanya dua: hasil yang kosong sama sekali, dan pekan yang tadinya punya
 * jadwal lalu lenyap seluruhnya. Jumlah baris di dalam satu pekan sengaja *tidak*
 * dipersoalkan — roster diterbitkan ulang secara utuh, dan versi barunya bisa jauh lebih
 * ramping (20 September 2026: 206 baris diganti 150, tanpa satu pun yang sama).
 *
 * Perbandingannya juga dibatasi pada rentang yang baru diambil. Setiap Minggu jendela sync
 * bergeser dan pekan lalu keluar dengan sendirinya; guard lama membandingkan dengan isi
 * seluruh tabel sehingga pergeseran itu terbaca sebagai penyusutan, lalu menolak sync
 * berhari-hari.
 */

import { addDays, dateOnly, isoDateOf, weekdayOf } from './time';

export class SyncTidakMasukAkal extends Error {}

/** Minggu awal pekan tanggal ini — jendela sync juga dimulai dari hari Minggu. */
function awalPekan(isoDate: string): string {
  const tanggal = dateOnly(isoDate);
  return isoDateOf(addDays(tanggal, -weekdayOf(tanggal)));
}

/**
 * @param fetched tanggal (YYYY-MM-DD) tiap baris yang baru ditarik dari Supabase
 * @param existing tanggal tiap baris yang sekarang ada di database
 * @param rentang rentang inklusif yang diambil fetch tersebut
 */
export function assertSyncSane(
  fetched: readonly string[],
  existing: readonly string[],
  rentang: { start: string; end: string }
): void {
  if (fetched.length === 0) {
    throw new SyncTidakMasukAkal(
      `Supabase mengembalikan 0 baris sementara database punya ${existing.length}. Sync dibatalkan agar jadwal lama tidak terhapus.`
    );
  }

  const pekanTerambil = new Set(fetched.map(awalPekan));
  const pekanLenyap = new Set(
    existing
      .filter((d) => d >= rentang.start && d <= rentang.end)
      .map(awalPekan)
      .filter((pekan) => !pekanTerambil.has(pekan))
  );

  if (pekanLenyap.size > 0) {
    const daftar = [...pekanLenyap].sort().join(', ');
    throw new SyncTidakMasukAkal(
      `Pekan yang dimulai ${daftar} punya jadwal di database tapi kosong di hasil fetch. Sync dibatalkan; periksa sumber datanya.`
    );
  }
}
