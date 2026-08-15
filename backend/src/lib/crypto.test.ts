import crypto from 'crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { belumTerenkripsi, decryptToken, encryptToken } from './crypto';

const KUNCI = crypto.randomBytes(32).toString('base64');

function denganKunci(kunci: string = KUNCI) {
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', kunci);
}

afterEach(() => vi.unstubAllEnvs());

describe('encryptToken / decryptToken', () => {
  test('nilai kembali utuh setelah bolak-balik', () => {
    denganKunci();
    const token = 'ya29.a0AQvPyI-contoh_token';

    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  test('hasil enkripsi tidak memuat teks aslinya', () => {
    denganKunci();
    const hasil = encryptToken('1//0g-refresh-token');

    expect(hasil).not.toContain('refresh-token');
    expect(hasil.startsWith('v1:')).toBe(true);
  });

  test('dua enkripsi nilai sama menghasilkan ciphertext berbeda', () => {
    denganKunci();

    expect(encryptToken('sama')).not.toBe(encryptToken('sama'));
  });

  test('token lama yang masih polos dibaca apa adanya', () => {
    denganKunci();

    expect(decryptToken('ya29.token-lama-belum-terenkripsi')).toBe('ya29.token-lama-belum-terenkripsi');
    expect(belumTerenkripsi('ya29.token-lama')).toBe(true);
    expect(belumTerenkripsi(encryptToken('baru'))).toBe(false);
  });

  test('null dan string kosong aman', () => {
    denganKunci();

    expect(decryptToken(null)).toBeNull();
    expect(decryptToken(undefined)).toBeNull();
    expect(decryptToken('')).toBeNull();
  });

  test('ciphertext yang diutak-atik ditolak, bukan mengembalikan data salah', () => {
    denganKunci();
    const asli = encryptToken('rahasia');
    const [v, iv, tag, data] = asli.split(':');
    const rusak = [v, iv, tag, Buffer.from('data lain').toString('base64')].join(':');

    expect(() => decryptToken(rusak)).toThrow();
  });

  test('kunci dari deployment lain tidak bisa membuka', () => {
    denganKunci();
    const terenkripsi = encryptToken('rahasia');

    denganKunci(crypto.randomBytes(32).toString('base64'));
    expect(() => decryptToken(terenkripsi)).toThrow();
  });

  test('kunci hilang atau salah panjang gagal dengan pesan jelas', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY belum diisi/);

    denganKunci(Buffer.alloc(16).toString('base64'));
    expect(() => encryptToken('x')).toThrow(/32 byte/);
  });
});
