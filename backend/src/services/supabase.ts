import { addDays, isoDateOf, todayWIB, weekdayOf } from '../lib/time';

const SUPABASE_URL = 'https://ngnhaftmcaoqmdgifsbv.supabase.co/rest/v1';
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

interface SupabaseEmployeeResponse {
  employee_nik: string;
  project_name: string;
  employees: { name: string; job_title: string; status: string };
}

interface SupabaseScheduleResponse {
  date: string;
  employee_nik: string;
  project_name: string;
  employees: { name: string };
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

function getDateRange(): { start: string; end: string } {
  // Minggu di pekan berjalan sampai Sabtu pekan depan, dihitung dalam WIB
  const today = todayWIB();
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

async function fetchEmployees(start: string, end: string): Promise<SupabaseEmployeeResponse[]> {
  const params = new URLSearchParams({
    'select': 'employee_nik,project_name,employees!inner(name,job_title,status)',
    'date': `gte.${start}`,
    'employees.status': 'in.(Aktif,Aktif Project)',
  });
  // Supabase uses duplicate keys for range filters
  const url = `${SUPABASE_URL}/schedules?${params.toString()}&date=lte.${end}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Supabase employees fetch failed: ${res.status}`);
  return res.json() as Promise<SupabaseEmployeeResponse[]>;
}

async function fetchSchedules(start: string, end: string): Promise<SupabaseScheduleResponse[]> {
  const params = new URLSearchParams({
    'select': 'date,employee_nik,project_name,employees!inner(name)',
    'date': `gte.${start}`,
    'order': 'date.asc',
  });
  const url = `${SUPABASE_URL}/schedules?${params.toString()}&date=lte.${end}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Supabase schedules fetch failed: ${res.status}`);
  return res.json() as Promise<SupabaseScheduleResponse[]>;
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

  const rows = (await res.json()) as { nik: string; name: string; job_title: string }[];
  const employee = rows[0];
  if (!employee) return null;

  return { employeeNik: employee.nik, name: employee.name, jobTitle: employee.job_title };
}

export async function fetchAllSchedules(): Promise<ScheduleRecord[]> {
  const { start, end } = getDateRange();

  const [employees, schedules] = await Promise.all([
    fetchEmployees(start, end),
    fetchSchedules(start, end),
  ]);

  // Build employee info map from request 1
  const employeeMap = new Map<string, { jobTitle: string; status: string }>();
  for (const emp of employees) {
    if (!employeeMap.has(emp.employee_nik)) {
      employeeMap.set(emp.employee_nik, {
        jobTitle: emp.employees.job_title,
        status: emp.employees.status,
      });
    }
  }

  // Combine schedule data with employee info
  const records: ScheduleRecord[] = [];
  for (const sch of schedules) {
    const empInfo = employeeMap.get(sch.employee_nik);
    records.push({
      employeeNik: sch.employee_nik,
      name: sch.employees.name,
      jobTitle: empInfo?.jobTitle ?? '',
      status: empInfo?.status ?? '',
      projectName: sch.project_name,
      date: sch.date,
    });
  }

  return records;
}

export { getDateRange };
