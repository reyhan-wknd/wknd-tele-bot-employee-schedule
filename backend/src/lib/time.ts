/**
 * Semua perhitungan waktu aplikasi ini memakai zona WIB, dan hasilnya tidak boleh
 * bergantung pada zona waktu mesin tempat proses berjalan.
 *
 * Dua bentuk nilai yang dipakai konsisten di seluruh kode:
 *   - "instant"   : Date yang menandai satu titik waktu sungguhan (mis. `new Date()`).
 *   - "date-only" : Date pada tengah malam UTC yang mewakili satu tanggal kalender WIB —
 *                   bentuk yang sama dengan nilai kolom `DATE` dari Prisma.
 */

export const APP_TIME_ZONE = 'Asia/Jakarta';

/** WIB tidak mengenal DST, jadi offsetnya tetap. */
const WIB_OFFSET = '+07:00';
const DAY_MS = 86_400_000;

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface WibClock {
  /** Tanggal kalender WIB dalam format YYYY-MM-DD. */
  date: string;
  hour: number;
  minute: number;
}

/** Baca jam dinding WIB dari satu instant, tanpa melewati parsing string tanggal. */
export function wibClock(instant: Date = new Date()): WibClock {
  const parts = Object.fromEntries(
    wibFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24, // sebagian ICU memberi "24" untuk tengah malam
    minute: Number(parts.minute),
  };
}

/** Ubah "YYYY-MM-DD" menjadi date-only (tengah malam UTC). */
export function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Tanggal WIB hari ini sebagai date-only. */
export function todayWIB(instant: Date = new Date()): Date {
  return dateOnly(wibClock(instant).date);
}

/** Geser date-only sekian hari. Aman dari DST karena nilainya selalu tengah malam UTC. */
export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

/** 0 = Minggu, 6 = Sabtu. */
export function weekdayOf(value: Date): number {
  return value.getUTCDay();
}

export function isoDateOf(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function hourWIB(instant: Date = new Date()): number {
  return wibClock(instant).hour;
}

export function weekdayWIB(instant: Date = new Date()): number {
  return weekdayOf(todayWIB(instant));
}

/** Awal dan akhir satu hari WIB sebagai instant sungguhan — untuk query Google Calendar. */
export function wibDayBounds(instant: Date = new Date()): { start: Date; end: Date } {
  const { date } = wibClock(instant);
  return {
    start: new Date(`${date}T00:00:00.000${WIB_OFFSET}`),
    end: new Date(`${date}T23:59:59.999${WIB_OFFSET}`),
  };
}

/**
 * Instant sungguhan dari tanggal WIB plus offset menit sejak tengah malam.
 *
 * `menit` sengaja boleh melebihi 59 — pemanggilnya sering memegang total menit hasil
 * hitungan, dan meluber ke jam berikutnya adalah perilaku yang diinginkan.
 */
export function instanWIB(isoDate: string, jam: number, menit: number): Date {
  const tengahMalam = new Date(`${isoDate}T00:00:00.000${WIB_OFFSET}`);
  return new Date(tengahMalam.getTime() + (jam * 60 + menit) * 60_000);
}

/** Baca "17:30" atau "17.30" yang diketik user. Mengembalikan null bila tidak masuk akal. */
export function parseJamWIB(raw: string): { jam: number; menit: number } | null {
  const cocok = /^(\d{1,2})[:.](\d{2})$/.exec(raw.trim());
  if (!cocok) return null;

  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (jam > 23 || menit > 59) return null;

  return { jam, menit };
}

/** Jam:menit WIB dari satu instant. */
export function formatTimeWIB(instant: Date): string {
  return instant.toLocaleTimeString('id-ID', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "Sel, 04 Agu" — bentuk pendek untuk satu sel tabel, di mana tanggal panjang tidak muat. */
export function formatTanggalRingkas(value: Date): string {
  return value.toLocaleDateString('id-ID', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

/** Tanggal panjang dari nilai date-only — dibaca apa adanya, tanpa digeser zona lagi. */
export function formatDateOnly(value: Date): string {
  return value.toLocaleDateString('id-ID', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
