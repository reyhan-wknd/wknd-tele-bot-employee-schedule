/** Sync mengganti seluruh isi tabel jadwal, jadi hasil fetch harus masuk akal dulu. */

/** Penurunan lebih dari separuh dianggap mencurigakan, bukan perubahan jadwal biasa. */
const MIN_RATIO = 0.5;

export class SyncTidakMasukAkal extends Error {}

/**
 * @param fetched jumlah baris yang baru ditarik dari Supabase
 * @param existing jumlah baris yang sekarang ada di database
 */
export function assertSyncSane(fetched: number, existing: number): void {
  if (fetched === 0) {
    throw new SyncTidakMasukAkal(
      `Supabase mengembalikan 0 baris sementara database punya ${existing}. Sync dibatalkan agar jadwal lama tidak terhapus.`
    );
  }

  if (existing > 0 && fetched < existing * MIN_RATIO) {
    throw new SyncTidakMasukAkal(
      `Hasil fetch (${fetched} baris) kurang dari setengah isi database (${existing}). Sync dibatalkan; periksa sumber datanya.`
    );
  }
}
