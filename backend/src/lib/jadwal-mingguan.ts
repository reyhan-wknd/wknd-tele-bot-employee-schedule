/**
 * Kabar jadwal WFO pekan depan, dicek Jumat, Sabtu, dan Minggu pukul 21:00.
 *
 * Roster di Supabase tidak terbit pada jam yang tetap — pernah Jumat 21:03, Sabtu 20:11,
 * Minggu 17:56 — dan bila berubah, ia diterbitkan ulang utuh. Satu kali cek Jumat malam
 * karena itu bisa melewatkannya sama sekali, atau mengabarkan versi yang kemudian diganti.
 *
 * Aturannya, per orang:
 *   - Roster belum terbit → dikabari belum terbit; Minggu menjadi kesimpulan akhir
 *     "tidak ada WFO pekan depan".
 *   - Roster sudah terbit → kabar pertama berisi jadwal lengkap (atau "tidak dapat WFO");
 *     sesudahnya hanya bersuara bila isinya berbeda dari yang sudah dikirim.
 *
 * "Belum terbit" berarti tidak ada satu baris pun untuk pekan itu, untuk siapa pun.
 * Seseorang yang tidak punya baris di roster yang sudah terbit bukan "belum terbit"
 * melainkan memang tidak dapat WFO — dan itu sudah jawaban yang pasti.
 *
 * Modul ini murni: semua keputusan diambil di sini tanpa I/O supaya seluruh tabel
 * perilakunya bisa diuji langsung.
 */

import { addDays, dateOnly, formatDateOnly, isoDateOf, weekdayOf } from './time';

export type HariCek = 'jumat' | 'sabtu' | 'minggu';

const HARI_CEK: Partial<Record<number, HariCek>> = { 5: 'jumat', 6: 'sabtu', 0: 'minggu' };

/** null bila hari ini bukan hari pengecekan. */
export function hariCek(today: Date): HariCek | null {
  return HARI_CEK[weekdayOf(today)] ?? null;
}

/** Senin–Jumat pekan depan; Jumat, Sabtu, dan Minggu menunjuk pekan yang sama. */
export function pekanDepan(today: Date): { senin: Date; jumat: Date } {
  const weekday = weekdayOf(today);
  const senin = addDays(today, weekday === 0 ? 1 : 8 - weekday);

  return { senin, jumat: addDays(senin, 4) };
}

export interface JadwalHari {
  /** YYYY-MM-DD */
  tanggal: string;
  projects: string[];
}

/** Bentuk baku jadwal satu orang: per tanggal, terurut, project diurutkan — agar bisa dibandingkan persis. */
export function snapshotJadwal(items: readonly { date: Date; projectName: string }[]): JadwalHari[] {
  const perTanggal = new Map<string, Set<string>>();

  for (const item of items) {
    const tanggal = isoDateOf(item.date);
    perTanggal.set(tanggal, (perTanggal.get(tanggal) ?? new Set()).add(item.projectName));
  }

  return [...perTanggal.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tanggal, projects]) => ({ tanggal, projects: [...projects].sort() }));
}

export type StatusKabar = 'belum-terbit' | 'tidak-terbit' | 'terkirim';

/** Apa yang terakhir dikabarkan ke seseorang tentang satu pekan. */
export interface Catatan {
  status: StatusKabar;
  /** Jadwal yang sudah dikirim; selalu kosong untuk `belum-terbit` dan `tidak-terbit`. */
  snapshot: JadwalHari[];
  /** YYYY-MM-DD */
  notifiedOn: string;
}

export type Alasan =
  | 'jadwal'
  | 'tanpa-wfo'
  | 'berubah'
  | 'sama'
  | 'belum-terbit'
  | 'tidak-terbit'
  | 'sudah-dikabari'
  | 'roster-hilang';

export interface Keputusan {
  alasan: Alasan;
  /** null berarti tidak ada yang perlu dikirim. */
  pesan: string | null;
  /** Catatan yang disimpan bila pesannya sampai; null berarti catatan lama dibiarkan. */
  catatan: Catatan | null;
}

export interface MasukanKabar {
  hari: HariCek;
  /** YYYY-MM-DD */
  hariIni: string;
  /** Roster pekan depan sudah punya baris, untuk siapa pun. */
  terbit: boolean;
  /** Jadwal orang ini di roster tersebut. */
  jadwal: JadwalHari[];
  catatan: Catatan | null;
}

const diam = (alasan: Alasan): Keputusan => ({ alasan, pesan: null, catatan: null });

const BESOK: Record<Exclude<HariCek, 'minggu'>, string> = { jumat: 'Sabtu', sabtu: 'Minggu' };

const tanggalPanjang = (tanggal: string) => formatDateOnly(dateOnly(tanggal));

function barisJadwal(hari: JadwalHari, tanda = ''): string {
  return `  • ${tanggalPanjang(hari.tanggal)} — ${hari.projects.join(', ')}${tanda}`;
}

function pesanJadwal(jadwal: readonly JadwalHari[]): string {
  if (jadwal.length === 0) {
    return '📅 Jadwal WFO minggu depan sudah terbit, dan kamu tidak dijadwalkan WFO.';
  }

  return `📅 Jadwal WFO kamu minggu depan:\n\n${jadwal.map((h) => barisJadwal(h)).join('\n')}`;
}

function samaProjects(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function samaJadwal(a: readonly JadwalHari[], b: readonly JadwalHari[]): boolean {
  return a.length === b.length && a.every((h, i) => h.tanggal === b[i].tanggal && samaProjects(h.projects, b[i].projects));
}

/** Jadwal terbaru utuh; 🆕 tanggal baru, ✏️ project berubah, lalu tanggal yang dicabut. */
function pesanBerubah(lama: readonly JadwalHari[], baru: readonly JadwalHari[]): string {
  const lamaPerTanggal = new Map(lama.map((h) => [h.tanggal, h.projects]));
  const tanggalBaru = new Set(baru.map((h) => h.tanggal));
  const dicabut = lama.filter((h) => !tanggalBaru.has(h.tanggal));

  const bagian: string[] = [];

  if (baru.length === 0) {
    bagian.push('🔄 Jadwal WFO minggu depan berubah: kamu tidak lagi dijadwalkan WFO.');
  } else {
    const baris = baru.map((h) => {
      const sebelumnya = lamaPerTanggal.get(h.tanggal);
      const tanda = !sebelumnya ? '  🆕' : samaProjects(sebelumnya, h.projects) ? '' : '  ✏️';
      return barisJadwal(h, tanda);
    });
    bagian.push(`🔄 Jadwal WFO minggu depan berubah:\n\n${baris.join('\n')}`);
  }

  if (dicabut.length > 0) {
    bagian.push(`❌ Tidak lagi WFO:\n${dicabut.map((h) => `  • ${tanggalPanjang(h.tanggal)}`).join('\n')}`);
  }

  return bagian.join('\n\n');
}

function kabarBelumTerbit({ hari, hariIni, catatan }: MasukanKabar): Keputusan {
  // Roster yang tadinya ada lalu lenyap bukan kabar untuk user — terbit ulang selalu
  // mengganti roster, tidak pernah mengosongkannya. Jadwal yang sudah dikirim dibiarkan.
  if (catatan?.status === 'terkirim') return diam('roster-hilang');

  if (catatan?.status === 'tidak-terbit') return diam('sudah-dikabari');
  if (catatan?.status === 'belum-terbit' && catatan.notifiedOn === hariIni) return diam('sudah-dikabari');

  if (hari === 'minggu') {
    return {
      alasan: 'tidak-terbit',
      pesan: '📭 Sampai malam ini jadwal WFO minggu depan belum juga terbit, jadi minggu depan tidak ada WFO untukmu.',
      catatan: { status: 'tidak-terbit', snapshot: [], notifiedOn: hariIni },
    };
  }

  return {
    alasan: 'belum-terbit',
    pesan: `⏳ Jadwal WFO minggu depan belum terbit. Jadwal akan dicek lagi besok (${BESOK[hari]}) pukul 21:00.`,
    catatan: { status: 'belum-terbit', snapshot: [], notifiedOn: hariIni },
  };
}

export function tentukanKabar(masukan: MasukanKabar): Keputusan {
  if (!masukan.terbit) return kabarBelumTerbit(masukan);

  const { hariIni, jadwal, catatan } = masukan;
  const baru: Catatan = { status: 'terkirim', snapshot: jadwal, notifiedOn: hariIni };

  if (!catatan || catatan.status === 'belum-terbit') {
    return { alasan: jadwal.length > 0 ? 'jadwal' : 'tanpa-wfo', pesan: pesanJadwal(jadwal), catatan: baru };
  }

  // `tidak-terbit` sudah mengabarkan "tidak ada WFO", jadi dibandingkan sebagai jadwal kosong.
  if (samaJadwal(catatan.snapshot, jadwal)) return diam('sama');

  return { alasan: 'berubah', pesan: pesanBerubah(catatan.snapshot, jadwal), catatan: baru };
}
