/**
 * Satu karyawan bisa punya lebih dari satu proyek di tanggal yang sama, jadi baris
 * jadwal selalu dikelompokkan per tanggal sebelum ditampilkan — supaya `/schedule`
 * dan semua reminder menyebut hal yang sama dengan format yang sama.
 */

import { addDays, formatDateOnly, weekdayOf } from './time';

export interface ScheduleLike {
  date: Date;
  projectName: string;
}

export interface GroupedSchedule {
  date: Date;
  projects: string[];
}

export function groupSchedulesByDate(items: readonly ScheduleLike[]): GroupedSchedule[] {
  const perTanggal = new Map<number, GroupedSchedule>();

  for (const item of items) {
    const key = item.date.getTime();
    const existing = perTanggal.get(key);
    if (existing) {
      existing.projects.push(item.projectName);
    } else {
      perTanggal.set(key, { date: item.date, projects: [item.projectName] });
    }
  }

  return Array.from(perTanggal.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** "PPA, Prismalink" */
export function formatProjects(group: GroupedSchedule): string {
  return group.projects.join(', ');
}

/**
 * Jendela yang sama dipakai `/schedule` dan `/schedule_of`: dari hari ini sampai Sabtu
 * pekan depan.
 *
 * Mulainya hari ini, bukan Minggu kemarin — jadwal WFO yang sudah lewat tidak lagi bisa
 * dipakai untuk apa pun, dan menampilkannya hanya memanjangkan pesan.
 */
export interface RentangDuaMinggu {
  mulai: Date;
  /** Sabtu pekan ini — pemisah antara "minggu ini" dan "minggu depan". */
  batasMingguIni: Date;
  selesai: Date;
}

export function rentangDuaMinggu(today: Date): RentangDuaMinggu {
  const minggu = addDays(today, -weekdayOf(today));

  return { mulai: today, batasMingguIni: addDays(minggu, 6), selesai: addDays(minggu, 13) };
}

export function pisahDuaMinggu<T extends ScheduleLike>(
  items: readonly T[],
  rentang: RentangDuaMinggu
): { mingguIni: T[]; mingguDepan: T[] } {
  return {
    mingguIni: items.filter((s) => s.date <= rentang.batasMingguIni),
    mingguDepan: items.filter((s) => s.date > rentang.batasMingguIni),
  };
}

function blokMinggu(judul: string, grup: readonly GroupedSchedule[]): string {
  const baris =
    grup.length > 0
      ? grup.map((g) => `  • ${formatDateOnly(g.date)} — ${formatProjects(g)}`)
      : ['  Belum ada jadwal'];

  return `\n📌 ${judul}:\n${baris.join('\n')}\n`;
}

/** Dua blok "Minggu ini"/"Minggu depan" yang bentuknya harus sama di semua perintah. */
export function formatDuaMinggu(items: readonly ScheduleLike[], rentang: RentangDuaMinggu): string {
  const { mingguIni, mingguDepan } = pisahDuaMinggu(items, rentang);

  return (
    blokMinggu('Minggu ini', groupSchedulesByDate(mingguIni)) +
    blokMinggu('Minggu depan', groupSchedulesByDate(mingguDepan))
  );
}

/** Proyek yang membuat orang ini harus ke kantor hari ini; kosong berarti tidak ada. */
export function proyekHariIni(items: readonly ScheduleLike[], today: Date): string[] {
  return items.filter((s) => s.date.getTime() === today.getTime()).map((s) => s.projectName);
}

/**
 * Pesan jadwal untuk orang lain (`/schedule_of`).
 *
 * Berbeda dengan `/schedule`, tidak ada baris "Hari ini" ketika orangnya tidak dijadwalkan
 * WFO: cuti orang lain hanya terbaca dari kalender pribadinya, yang tokennya tidak kita
 * punya, jadi jadwal yang kosong tidak boleh diterjemahkan menjadi "dia WFH".
 */
export function formatJadwalOrang(
  karyawan: { name: string; jobTitle: string },
  schedules: readonly ScheduleLike[],
  today: Date,
  rentang: RentangDuaMinggu
): string {
  const kepala = `👤 ${karyawan.name} — ${karyawan.jobTitle}\n`;

  if (schedules.length === 0) {
    return `${kepala}\n📅 Tidak ada jadwal WFO terdaftar untuk minggu ini maupun minggu depan.`;
  }

  const hariIni = proyekHariIni(schedules, today);
  const barisHariIni = hariIni.length > 0 ? `\n📍 Hari ini: 🏢 WFO (${hariIni.join(', ')})\n` : '';

  return kepala + barisHariIni + formatDuaMinggu(schedules, rentang);
}
