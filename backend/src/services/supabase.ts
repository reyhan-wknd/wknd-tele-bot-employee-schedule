import { addDays, isoDateOf, todayWIB, weekdayOf } from '../lib/time';

const SUPABASE_URL = 'https://ngnhaftmcaoqmdgifsbv.supabase.co/rest/v1';
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

interface SupabaseScheduleRow {
  date: string;
  employee_nik: string;
  project_name: string;
  employees: { name: string; job_title: string; status: string };
}

export interface EmployeeRecord {
  employeeNik: string;
  name: string;
  jobTitle: string;
}

export interface ScheduleRecord {
  employeeNik: string;
  jobTitle: string;
  name: string;
  status: string;
  projectName: string;
  date: string; // YYYY-MM-DD
}

/** Rentang tanggal inklusif, YYYY-MM-DD. */
export interface RentangTanggal {
  start: string;
  end: string;
}

/** Rentang yang disalin sync: Minggu di pekan berjalan sampai Sabtu pekan depan, dalam WIB. */
export function rentangSync(today: Date = todayWIB()): RentangTanggal {
  const sunday = addDays(today, -weekdayOf(today));
  const nextSaturday = addDays(sunday, 13);

  return { start: isoDateOf(sunday), end: isoDateOf(nextSaturday) };
}

const headers = {
  'accept': '*/*',
  'accept-profile': 'public',
  'apikey': SUPABASE_KEY,
  'authorization': `Bearer ${SUPABASE_KEY}`,
};

/** Dua status yang sama-sama berarti "masih bekerja di sini" menurut HR. */
const STATUS_AKTIF = 'in.(Aktif,Aktif Project)';

interface EmployeeRow {
  nik: string;
  name: string;
  job_title: string;
}

const keEmployeeRecord = (row: EmployeeRow): EmployeeRecord => ({
  employeeNik: row.nik,
  name: row.name,
  jobTitle: row.job_title,
});

/** REST Supabase memotong respons di batas baris (bawaannya 1.000), jadi harus dihalaman. */
const PAGE_SIZE = 500;

/**
 * Ambil seluruh jadwal pada rentang tanggal, sehalaman demi sehalaman.
 *
 * Satu request saja — dulu ada dua panggilan ke tabel yang sama, dan filter karyawan
 * aktif hanya terpasang di salah satunya sehingga jadwal karyawan non-aktif ikut
 * tersimpan dengan jabatan kosong.
 */
async function fetchSchedulePages(start: string, end: string): Promise<SupabaseScheduleRow[]> {
  const rows: SupabaseScheduleRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select: 'date,employee_nik,project_name,employees!inner(name,job_title,status)',
      date: `gte.${start}`,
      'employees.status': STATUS_AKTIF,
      order: 'date.asc,employee_nik.asc,project_name.asc',
    });

    const url = `${SUPABASE_URL}/schedules?${params.toString()}&date=lte.${end}`;
    const res = await fetch(url, {
      headers: { ...headers, Range: `${offset}-${offset + PAGE_SIZE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Supabase schedules fetch failed: ${res.status}`);
    }

    const page = (await res.json()) as SupabaseScheduleRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * Cari karyawan berdasarkan email yang sudah diverifikasi Google.
 *
 * Sengaja menembak tabel `employees` di Supabase, bukan salinan jadwal di MySQL:
 * salinan itu hanya memuat karyawan yang punya jadwal dua minggu ini, sedangkan
 * `employees` memuat semuanya. Semua email di sana tersimpan huruf kecil, jadi
 * input cukup di-lowercase lalu dicocokkan persis.
 */
export async function findEmployeeByEmail(email: string): Promise<EmployeeRecord | null> {
  const params = new URLSearchParams({
    select: 'nik,name,job_title',
    email: `eq.${email.trim().toLowerCase()}`,
    limit: '1',
  });

  const res = await fetch(`${SUPABASE_URL}/employees?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`Supabase employee lookup failed: ${res.status}`);

  const rows = (await res.json()) as EmployeeRow[];
  const employee = rows[0];
  if (!employee) return null;

  return keEmployeeRecord(employee);
}

/**
 * Cari satu karyawan lewat NIK — dipakai saat tombol pilihan /schedule_of ditekan.
 *
 * Tombol hanya membawa NIK-nya, jadi nama dan jabatan diambil lagi di sini. Sekali query
 * satu baris, dan hasilnya selalu data terkini: tombol dari kemarin tidak akan
 * menampilkan jabatan yang sudah berubah.
 */
export async function findEmployeeByNik(nik: string): Promise<EmployeeRecord | null> {
  const params = new URLSearchParams({
    select: 'nik,name,job_title',
    nik: `eq.${nik.trim()}`,
    limit: '1',
  });

  const res = await fetch(`${SUPABASE_URL}/employees?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`Supabase employee lookup failed: ${res.status}`);

  const rows = (await res.json()) as EmployeeRow[];
  const employee = rows[0];
  if (!employee) return null;

  return keEmployeeRecord(employee);
}

/**
 * Seluruh karyawan aktif — bahan pencarian nama untuk /schedule_of.
 *
 * Sengaja dari Supabase, bukan dari tabel `schedules` di MySQL: salinan itu hanya memuat
 * orang yang punya jadwal WFO dua minggu ini (118 dari 142 saat ini), sehingga orang yang
 * dua minggu ini penuh WFH akan tampak seolah tidak bekerja di sini sama sekali.
 */
export async function fetchActiveEmployees(): Promise<EmployeeRecord[]> {
  const rows: EmployeeRecord[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      select: 'nik,name,job_title',
      status: STATUS_AKTIF,
      order: 'name.asc',
    });

    const res = await fetch(`${SUPABASE_URL}/employees?${params.toString()}`, {
      headers: { ...headers, Range: `${offset}-${offset + PAGE_SIZE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Supabase employees fetch failed: ${res.status}`);
    }

    const page = (await res.json()) as EmployeeRow[];
    rows.push(...page.map(keEmployeeRecord));

    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function fetchSchedules(rentang: RentangTanggal): Promise<ScheduleRecord[]> {
  const rows = await fetchSchedulePages(rentang.start, rentang.end);

  return rows.map((row) => ({
    employeeNik: row.employee_nik,
    name: row.employees.name,
    jobTitle: row.employees.job_title,
    status: row.employees.status,
    projectName: row.project_name,
    date: row.date,
  }));
}

