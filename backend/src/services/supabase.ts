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

export interface ScheduleRecord {
  employeeNik: string;
  jobTitle: string;
  name: string;
  status: string;
  projectName: string;
  date: string; // YYYY-MM-DD
}

function getDateRange(): { start: string; end: string } {
  // Sunday of current week to Saturday of next week (WIB)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const day = now.getDay(); // 0=Sun, 6=Sat

  const sunday = new Date(now);
  sunday.setDate(now.getDate() - day);

  const nextSaturday = new Date(sunday);
  nextSaturday.setDate(sunday.getDate() + 13); // Sunday + 13 = Saturday next week

  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { start: fmt(sunday), end: fmt(nextSaturday) };
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
