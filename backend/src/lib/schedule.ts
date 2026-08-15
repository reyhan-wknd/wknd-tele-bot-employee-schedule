/**
 * Satu karyawan bisa punya lebih dari satu proyek di tanggal yang sama, jadi baris
 * jadwal selalu dikelompokkan per tanggal sebelum ditampilkan — supaya `/schedule`
 * dan semua reminder menyebut hal yang sama dengan format yang sama.
 */

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
