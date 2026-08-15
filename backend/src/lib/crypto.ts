import crypto from 'crypto';

/**
 * Enkripsi token OAuth sebelum masuk database.
 *
 * Dump database, backup, atau akses baca ke MySQL tidak lagi otomatis berarti akses ke
 * akun Google penggunanya. Formatnya diberi awalan versi supaya nilai lama yang masih
 * polos tetap terbaca selama masa peralihan.
 */

const PREFIX = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function kunci(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY belum diisi. Buat sekali dengan: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY harus 32 byte dalam base64, sekarang ${key.length} byte`);
  }
  return key;
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, kunci(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Nilai tanpa awalan versi dianggap token lama yang belum terenkripsi. */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;

  const bagian = stored.split(':');
  if (bagian.length !== 4 || bagian[0] !== PREFIX) return stored;

  const [, iv, tag, data] = bagian;
  const decipher = crypto.createDecipheriv(ALGO, kunci(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** True bila nilai di database masih tersimpan polos. */
export function belumTerenkripsi(stored: string | null | undefined): boolean {
  return !!stored && !stored.startsWith(`${PREFIX}:`);
}
