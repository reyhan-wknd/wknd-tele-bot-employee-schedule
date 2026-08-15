import { describe, expect, test, vi } from 'vitest';
import { matchesEmailDomain, parseEmailDomains } from './config';

describe('parseEmailDomains', () => {
  test('memangkas spasi, huruf besar, dan awalan @', () => {
    expect(parseEmailDomains(' WeekendInc.com , @Contoh.co.id ')).toEqual([
      'weekendinc.com',
      'contoh.co.id',
    ]);
  });

  test('membuang entri kosong', () => {
    expect(parseEmailDomains('weekendinc.com,,  ,')).toEqual(['weekendinc.com']);
  });
});

describe('matchesEmailDomain', () => {
  const domains = ['weekendinc.com'];

  test('menerima email domain perusahaan', () => {
    expect(matchesEmailDomain('reyhan.ramadhan@weekendinc.com', domains)).toBe(true);
  });

  test('menerima email dengan huruf besar', () => {
    expect(matchesEmailDomain('Reyhan.Ramadhan@WeekendInc.com', domains)).toBe(true);
  });

  test('menolak domain lain', () => {
    expect(matchesEmailDomain('orang@gmail.com', domains)).toBe(false);
  });

  test('menolak subdomain', () => {
    expect(matchesEmailDomain('orang@sub.weekendinc.com', domains)).toBe(false);
  });

  test('menolak domain berakhiran mirip', () => {
    expect(matchesEmailDomain('orang@weekendinc.com.evil.com', domains)).toBe(false);
  });

  test('memakai bagian setelah @ terakhir', () => {
    expect(matchesEmailDomain('orang@weekendinc.com@evil.com', domains)).toBe(false);
  });

  test('menolak string tanpa @', () => {
    expect(matchesEmailDomain('weekendinc.com', domains)).toBe(false);
  });

  test('mendukung lebih dari satu domain', () => {
    const multi = ['weekendinc.com', 'contoh.co.id'];
    expect(matchesEmailDomain('orang@contoh.co.id', multi)).toBe(true);
    expect(matchesEmailDomain('orang@gmail.com', multi)).toBe(false);
  });
});

describe('ALLOWED_EMAIL_DOMAINS', () => {
  test('default ke weekendinc.com bila env tidak diisi', async () => {
    vi.resetModules();
    const original = process.env.ALLOWED_EMAIL_DOMAINS;
    delete process.env.ALLOWED_EMAIL_DOMAINS;

    const config = await import('./config');
    expect(config.ALLOWED_EMAIL_DOMAINS).toEqual(['weekendinc.com']);
    expect(config.isAllowedEmail('orang@weekendinc.com')).toBe(true);
    expect(config.isAllowedEmail('orang@gmail.com')).toBe(false);

    if (original !== undefined) process.env.ALLOWED_EMAIL_DOMAINS = original;
  });

  test('memakai daftar dari env bila diisi', async () => {
    vi.resetModules();
    vi.stubEnv('ALLOWED_EMAIL_DOMAINS', 'contoh.co.id, @lain.com');

    const config = await import('./config');
    expect(config.ALLOWED_EMAIL_DOMAINS).toEqual(['contoh.co.id', 'lain.com']);
    expect(config.isAllowedEmail('orang@contoh.co.id')).toBe(true);
    expect(config.isAllowedEmail('orang@weekendinc.com')).toBe(false);

    vi.unstubAllEnvs();
  });

  test('gagal saat startup bila env terisi kosong', async () => {
    vi.resetModules();
    vi.stubEnv('ALLOWED_EMAIL_DOMAINS', '   ');

    await expect(import('./config')).rejects.toThrow(/tidak menghasilkan satu domain/);

    vi.unstubAllEnvs();
  });
});
