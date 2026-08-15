/** Selisih aman sebelum kedaluwarsa, supaya token tidak dipakai tepat di detik terakhir. */
const MARGIN_MS = 5 * 60 * 1000;

/**
 * Masa berlaku access token sekarang disimpan di database, jadi pengecekan harian tidak
 * perlu lagi menembak endpoint tokeninfo Google untuk setiap user.
 */
export function tokenMasihBerlaku(expiry: Date | null | undefined, sekarang: Date = new Date()): boolean {
  if (!expiry) return false; // tidak diketahui — perlakukan sebagai perlu disegarkan
  return expiry.getTime() - MARGIN_MS > sekarang.getTime();
}
