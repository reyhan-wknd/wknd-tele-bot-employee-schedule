import { describe, expect, test } from 'vitest';
import { tokenMasihBerlaku } from './token';

const sekarang = new Date('2026-08-15T10:00:00Z');
const menit = (n: number) => new Date(sekarang.getTime() + n * 60_000);

describe('tokenMasihBerlaku', () => {
  test('masih lama berlaku', () => {
    expect(tokenMasihBerlaku(menit(60), sekarang)).toBe(true);
  });

  test('sudah lewat', () => {
    expect(tokenMasihBerlaku(menit(-1), sekarang)).toBe(false);
  });

  test('dalam margin 5 menit dianggap perlu disegarkan', () => {
    expect(tokenMasihBerlaku(menit(4), sekarang)).toBe(false);
    expect(tokenMasihBerlaku(menit(6), sekarang)).toBe(true);
  });

  test('tanpa data masa berlaku, jangan berasumsi masih hidup', () => {
    expect(tokenMasihBerlaku(null, sekarang)).toBe(false);
    expect(tokenMasihBerlaku(undefined, sekarang)).toBe(false);
  });
});
