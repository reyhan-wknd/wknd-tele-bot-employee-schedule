/**
 * Pencocokan nama karyawan untuk /schedule_of, dipisahkan dari Telegram dan Supabase
 * supaya bisa diuji sendiri.
 *
 * Dua tahap, dan urutannya yang menentukan kualitas hasil: cocok pasti dulu, fuzzy hanya
 * dijalankan kalau tahap pertama benar-benar kosong. Kalau fuzzy ikut menilai sejak awal,
 * ketikan yang sudah benar ("ade") akan menyeret nama-nama mirip ("adi", "ate") ke dalam
 * daftar dan memperburuk hasil yang tadinya sudah tepat.
 */

/** Di bawah ini query terlalu luas: dua huruf sudah cocok dengan puluhan nama. */
export const MIN_HURUF_QUERY = 3;

/** Tombol yang ditampilkan sekaligus. Lebih dari ini, keyboard Telegram minta di-scroll. */
export const MAKS_PILIHAN = 8;

/** Saran "maksud kamu" sengaja sedikit — tebakan yang banyak bukan lagi saran. */
export const MAKS_SARAN = 3;

export interface KandidatNama {
  employeeNik: string;
  name: string;
  jobTitle: string;
}

export interface HasilCari {
  /** `pasti` = benar-benar cocok, `saran` = tebakan typo, `kosong` = tidak ada apa-apa. */
  jenis: 'pasti' | 'saran' | 'kosong';
  /** Sudah dipotong sesuai MAKS_PILIHAN / MAKS_SARAN. */
  hasil: KandidatNama[];
  /** Jumlah kecocokan sebelum dipotong — dipakai untuk menyebut "masih ada N lainnya". */
  total: number;
}

/**
 * Samakan bentuk nama sebelum dibandingkan: tanpa diakritik, huruf kecil, dan setiap
 * tanda baca berubah jadi pemisah kata. "M. Rizky-Alif" dan "M Rizky Alif" harus
 * menghasilkan kunci yang sama, karena user tidak akan mengetik tanda bacanya.
 */
export function normalisasiNama(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TIDAK_COCOK = Number.POSITIVE_INFINITY;

/**
 * Seberapa kuat sebuah nama cocok dengan query. Makin kecil makin kuat.
 *
 * Token diberi dua tingkat sendiri karena begitulah orang menyebut rekan kerja: "rizky"
 * untuk "Muhammad Rizky", sebagai kata utuh atau awalannya — bukan sebagai potongan di
 * tengah kata. Token yang utuh didahulukan supaya "ramadhan" menaruh "Reyhan Ramadhan"
 * di atas "Siti Ramadhani".
 */
function peringkatCocok(nama: string, query: string): number {
  if (nama === query) return 0;
  if (nama.startsWith(query)) return 1;

  const token = nama.split(' ');
  if (token.some((t) => t === query)) return 2;
  if (token.some((t) => t.startsWith(query))) return 3;
  if (nama.includes(query)) return 4;

  return TIDAK_COCOK;
}

/** Levenshtein dua baris — tabel penuh tidak perlu disimpan, hanya baris sebelumnya. */
function jarakEdit(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let sebelumnya = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const sekarang = [i];
    for (let j = 1; j <= b.length; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1;
      sekarang[j] = Math.min(sekarang[j - 1] + 1, sebelumnya[j] + 1, sebelumnya[j - 1] + biaya);
    }
    sebelumnya = sekarang;
  }

  return sebelumnya[b.length];
}

/** Toleransi typo tumbuh bersama panjang ketikan: satu huruf salah di kata pendek sudah banyak. */
function ambangTypo(query: string): number {
  if (query.length <= 4) return 1;
  if (query.length <= 8) return 2;
  return 3;
}

/**
 * Semua rangkaian kata berurutan sepanjang jumlah kata query.
 *
 * Untuk query satu kata ini sama saja dengan daftar tokennya. Yang penting adalah query
 * dua kata: "ainur rofik" harus bisa dibandingkan dengan "ainur rofiq" di dalam "Muhammad
 * Ainur Rofiq", bukan hanya dengan nama penuhnya — jaraknya melebar oleh "muhammad " yang
 * tidak ikut diketik, dan orangnya jadi tidak ketemu.
 */
function jendelaKata(nama: string, jumlahKata: number): string[] {
  const kata = nama.split(' ');
  if (jumlahKata >= kata.length) return [nama];

  return kata.slice(0, kata.length - jumlahKata + 1).map((_, i) => kata.slice(i, i + jumlahKata).join(' '));
}

/**
 * Jarak terdekat antara query dan sebuah nama.
 *
 * Potongan sepanjang query ikut dibandingkan supaya typo pada ketikan separuh nama tetap
 * tertangkap: "budhi" hanya dekat dengan "budiman" bila yang dibandingkan "budim",
 * sedangkan terhadap kata penuhnya jaraknya melebar oleh sisa huruf yang belum diketik.
 */
function jarakTerdekat(nama: string, query: string): number {
  const bagian = [nama, ...jendelaKata(nama, query.split(' ').length)];

  return Math.min(
    ...bagian.flatMap((teks) => [jarakEdit(query, teks), jarakEdit(query, teks.slice(0, query.length))])
  );
}

interface Dinilai {
  kandidat: KandidatNama;
  nama: string;
  nilai: number;
}

/**
 * Peringkat (atau jarak typo) dulu, lalu alfabet.
 *
 * Sesama peringkat sama kuatnya, jadi yang menentukan tinggal enak-tidaknya dibaca:
 * delapan tombol berurutan A–Z bisa dipindai sekilas, sedangkan urutan lain — panjang
 * nama, misalnya — terlihat acak dan membuat orang membaca semuanya satu per satu.
 */
function bandingkan(a: Dinilai, b: Dinilai): number {
  return a.nilai - b.nilai || a.nama.localeCompare(b.nama);
}

function rangkum(terpilih: Dinilai[], batas: number, jenis: 'pasti' | 'saran'): HasilCari {
  return {
    jenis,
    hasil: terpilih.slice(0, batas).map((d) => d.kandidat),
    total: terpilih.length,
  };
}

const KOSONG: HasilCari = { jenis: 'kosong', hasil: [], total: 0 };

/**
 * Pencarian yang sebetulnya mengarah ke diri sendiri.
 *
 * Hasil diri sendiri selalu dibuang dari daftar, tapi menjawab "tidak ditemukan" untuk
 * nama yang jelas-jelas ada di direktori membuat orang mengira datanya rusak. Kecocokan
 * pasti ke orang lain tetap menang: `/schedule_of muhammad` tidak boleh berubah jadi
 * "itu kamu" hanya karena si pencari kebetulan juga bernama Muhammad.
 */
export function menunjukDiriSendiri(
  query: string,
  direktori: readonly KandidatNama[],
  nikSendiri: string | null,
  orangLain: HasilCari
): boolean {
  if (!nikSendiri) return false;

  const diri = cariNama(query, direktori.filter((k) => k.employeeNik === nikSendiri));
  if (diri.jenis === 'kosong') return false;
  if (diri.jenis === 'pasti') return orangLain.jenis !== 'pasti';

  return orangLain.jenis === 'kosong';
}

export function cariNama(queryMentah: string, kandidat: readonly KandidatNama[]): HasilCari {
  const query = normalisasiNama(queryMentah);
  if (query.length < MIN_HURUF_QUERY) return KOSONG;

  const semua = kandidat.map((k) => ({ kandidat: k, nama: normalisasiNama(k.name) }));

  const pasti = semua
    .map((d) => ({ ...d, nilai: peringkatCocok(d.nama, query) }))
    .filter((d) => d.nilai !== TIDAK_COCOK)
    .sort(bandingkan);

  if (pasti.length > 0) return rangkum(pasti, MAKS_PILIHAN, 'pasti');

  const ambang = ambangTypo(query);
  const saran = semua
    .map((d) => ({ ...d, nilai: jarakTerdekat(d.nama, query) }))
    .filter((d) => d.nilai <= ambang)
    .sort(bandingkan);

  if (saran.length > 0) return rangkum(saran, MAKS_SARAN, 'saran');

  return KOSONG;
}
