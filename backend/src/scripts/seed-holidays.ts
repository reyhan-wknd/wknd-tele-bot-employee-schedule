/**
 * Mengisi tabel `holidays` dari kalender hari libur Indonesia milik Google.
 *
 * Diambil sebagai ICS publik, jadi tidak perlu API key maupun OAuth.
 *
 * Pakai:
 *   npx tsx src/scripts/seed-holidays.ts          # tahun berjalan
 *   npx tsx src/scripts/seed-holidays.ts 2027     # tahun tertentu
 *
 * Idempoten — entri yang sudah ada hanya diperbarui labelnya, tidak digandakan. Feed
 * Google hanya memuat sekitar satu tahun ke depan, jadi skrip ini memang perlu
 * dijalankan lagi tiap tahun.
 *
 * Hasilnya usulan, bukan kebenaran akhir — tanggal libur keagamaan baru pasti setelah
 * SKB 3 Menteri terbit. Tinjau keluarannya, lalu koreksi lewat /manage_holiday.
 */
import 'dotenv/config';
import { prisma } from '../db';
import { MAKS_PANJANG_LABEL, TAHUN_BERULANG } from '../lib/holiday';
import { simpanLibur } from '../services/holiday';
import { todayWIB } from '../lib/time';

const ICS_URL =
  'https://calendar.google.com/calendar/ical/id.indonesian%23holiday%40group.v.calendar.google.com/public/basic.ics';

/**
 * Tanggal yang benar-benar tetap disimpan sebagai entri berulang, sehingga seed tahun
 * berikutnya cukup menambahkan yang bergerak saja.
 */
const TANGGAL_TETAP = new Set(['01-01', '05-01', '06-01', '08-17', '12-25']);

/**
 * Kalender Google memuat penanda yang bukan hari libur. Kalau ikut terimpor, bot akan
 * diam di hari kerja — kesalahan yang jauh lebih merugikan daripada kelewat satu libur.
 */
const BUKAN_HARI_LIBUR = [/^1 ramadan/i, /^hari paskah$/i, /^malam tahun baru$/i];

/**
 * Google menandai sebagian tanggal dengan "(belum pasti)". Itu catatan proses, bukan nama
 * hari liburnya, jadi tidak perlu ikut terbaca user di /holiday.
 *
 * Panjangnya juga dipotong ke batas yang sama dengan /manage_holiday, supaya label dari
 * hulu tidak bisa menggagalkan seed dengan cara yang tidak bisa dilakukan admin.
 */
export function rapikanLabel(label: string): string {
  return label
    .replace(/\s*\((?:belum pasti|tentative)\)\s*$/i, '')
    .trim()
    .slice(0, MAKS_PANJANG_LABEL);
}

interface EntriIcs {
  isoDate: string;
  label: string;
}

/** Baris ICS yang panjang dilipat dengan awalan spasi; sambung dulu sebelum diparse. */
export function parseIcs(teks: string): EntriIcs[] {
  const utuh = teks.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n');
  const entri: EntriIcs[] = [];

  for (const blok of utuh.split('BEGIN:VEVENT').slice(1)) {
    const tanggal = /DTSTART;VALUE=DATE:(\d{8})/.exec(blok);
    const ringkasan = /SUMMARY:(.+)/.exec(blok);
    if (!tanggal || !ringkasan) continue;

    const raw = tanggal[1];
    entri.push({
      isoDate: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`,
      label: ringkasan[1].trim(),
    });
  }

  return entri;
}

async function main() {
  const argumen = process.argv[2];
  const tahun = argumen ? Number(argumen) : todayWIB().getUTCFullYear();

  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
    console.error(`Tahun tidak masuk akal: ${argumen}`);
    process.exit(1);
  }

  console.log(`Mengambil kalender hari libur untuk ${tahun}...`);
  const res = await fetch(ICS_URL);
  if (!res.ok) {
    console.error(`Gagal mengambil kalender: HTTP ${res.status}`);
    process.exit(1);
  }

  const semua = parseIcs(await res.text());
  // Urutkan supaya daftar yang dicetak enak ditinjau; ICS tidak menjamin urutan.
  const tahunIni = semua
    .filter((e) => e.isoDate.startsWith(`${tahun}-`))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  if (tahunIni.length === 0) {
    console.error(
      `Kalender Google tidak memuat satu pun entri untuk ${tahun} — feed-nya biasanya hanya ` +
        `mencakup sekitar setahun ke depan. Masukkan manual lewat /manage_holiday.`
    );
    process.exit(1);
  }

  const dilewati: string[] = [];
  const ditulis: string[] = [];

  for (const entri of tahunIni) {
    if (BUKAN_HARI_LIBUR.some((pola) => pola.test(entri.label))) {
      dilewati.push(`${entri.isoDate}  ${entri.label}`);
      continue;
    }

    const [, bulan, hari] = entri.isoDate.split('-');
    const berulang = TANGGAL_TETAP.has(`${bulan}-${hari}`);
    const label = rapikanLabel(entri.label);

    await simpanLibur(
      {
        year: berulang ? TAHUN_BERULANG : tahun,
        month: Number(bulan),
        day: Number(hari),
      },
      label
    );

    ditulis.push(`${entri.isoDate}  ${label}${berulang ? '  [berulang tiap tahun]' : ''}`);
  }

  console.log(`\n=== Tersimpan (${ditulis.length}) ===`);
  for (const baris of ditulis) console.log(`  ${baris}`);

  console.log(`\n=== Dilewati karena bukan hari libur (${dilewati.length}) ===`);
  for (const baris of dilewati) console.log(`  ${baris}`);

  console.log('\nTinjau daftar di atas, lalu koreksi lewat /manage_holiday bila perlu.');
}

if (typeof require !== 'undefined' && require.main === module) {
  void main()
    .catch((err) => {
      console.error('Seed gagal:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
