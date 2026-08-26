/**
 * Ringkasan keadaan besok yang ditempelkan pada pesan check-out.
 *
 * Yang disebut hanya hal yang memang perlu disiapkan: jadwal WFO, cuti, hari libur,
 * dan akhir pekan. Hari kerja WFH biasa tidak menghasilkan apa-apa (null) — menempelkan
 * "besok WFH" pada setiap check-out hanya menambah baris yang selalu sama.
 */

import { formatDateOnly, weekdayOf } from './time';

export interface KeadaanBesok {
  /** date-only: tanggal kalender WIB besok. */
  tanggal: Date;
  cuti: boolean;
  libur: string | null;
  projects: readonly string[];
}

export function ringkasBesok(keadaan: KeadaanBesok): string | null {
  const { tanggal, cuti, libur, projects } = keadaan;
  const akhirPekan = weekdayOf(tanggal) === 0 || weekdayOf(tanggal) === 6;

  const baris: string[] = [];

  if (cuti) baris.push('🌴 Kamu cuti');

  // Hari libur terdaftar mengalahkan sebutan akhir pekan, sama seperti di /status.
  // Adanya jadwal WFO juga membuat "akhir pekan" tidak perlu disebut — kalimatnya akan
  // berlawanan dengan baris di bawahnya, dan tanggalnya sendiri sudah menyebut harinya.
  if (libur) baris.push(`🎌 Libur: ${libur}`);
  else if (akhirPekan && projects.length === 0) baris.push('🏖️ Akhir pekan');

  // Jadwal WFO tetap disebut meski besok libur atau cuti: kalau barisnya memang ada di
  // roster, orangnya perlu tahu supaya bisa mengurusnya.
  if (projects.length > 0) baris.push(`🏢 WFO — ${projects.join(', ')}`);

  if (baris.length === 0) return null;

  // Sengaja tanpa parse_mode di pemanggilnya: label libur ditulis admin dan bisa memuat
  // * atau _, dan nama project pun tidak dijamin bebas dari keduanya.
  return `📅 Besok (${formatDateOnly(tanggal)}):\n${baris.map((b) => `  ${b}`).join('\n')}`;
}
