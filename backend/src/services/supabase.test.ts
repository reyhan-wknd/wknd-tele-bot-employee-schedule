import { afterEach, describe, expect, test, vi } from 'vitest';

/** Impor ulang modul dengan SUPABASE_KEY yang sudah ter-stub, lalu pasang fetch tiruan. */
async function withFetch(response: { ok: boolean; status?: number; body?: unknown }) {
  vi.resetModules();
  vi.stubEnv('SUPABASE_KEY', 'kunci-uji');

  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fetchMock);

  const { findEmployeeByEmail } = await import('./supabase');
  return { findEmployeeByEmail, fetchMock };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('findEmployeeByEmail', () => {
  const row = { nik: '21225', name: 'Reyhan Ramadhan', job_title: 'Backend Developer' };

  test('memetakan kolom Supabase ke bentuk yang dipakai aplikasi', async () => {
    const { findEmployeeByEmail } = await withFetch({ ok: true, body: [row] });

    await expect(findEmployeeByEmail('reyhan.ramadhan@weekendinc.com')).resolves.toEqual({
      employeeNik: '21225',
      name: 'Reyhan Ramadhan',
      jobTitle: 'Backend Developer',
    });
  });

  test('menembak tabel employees dengan filter email persis', async () => {
    const { findEmployeeByEmail, fetchMock } = await withFetch({ ok: true, body: [row] });
    await findEmployeeByEmail('reyhan.ramadhan@weekendinc.com');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/employees?');
    expect(url).toContain('email=eq.reyhan.ramadhan%40weekendinc.com');
    expect(url).toContain('limit=1');
    expect(fetchMock.mock.calls[0][1].headers.apikey).toBe('kunci-uji');
  });

  test('menormalkan huruf besar dan spasi berlebih', async () => {
    const { findEmployeeByEmail, fetchMock } = await withFetch({ ok: true, body: [row] });
    await findEmployeeByEmail('  Reyhan.Ramadhan@WeekendInc.com  ');

    expect(fetchMock.mock.calls[0][0]).toContain('email=eq.reyhan.ramadhan%40weekendinc.com');
  });

  test('mengembalikan null bila email tidak terdaftar', async () => {
    const { findEmployeeByEmail } = await withFetch({ ok: true, body: [] });

    await expect(findEmployeeByEmail('bukan.karyawan@weekendinc.com')).resolves.toBeNull();
  });

  test('melempar error bila Supabase membalas non-2xx', async () => {
    const { findEmployeeByEmail } = await withFetch({ ok: false, status: 503, body: {} });

    await expect(findEmployeeByEmail('reyhan.ramadhan@weekendinc.com')).rejects.toThrow(/503/);
  });
});
