const DEFAULT_EMAIL_DOMAIN = 'weekendinc.com';

/** Ubah "weekendinc.com, @contoh.com" menjadi ['weekendinc.com', 'contoh.com']. */
export function parseEmailDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/**
 * Cocokkan domain email secara persis — subdomain (`sub.weekendinc.com`) dan
 * domain berakhiran mirip (`weekendinc.com.evil.com`) ikut tertolak.
 */
export function matchesEmailDomain(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}

export const ALLOWED_EMAIL_DOMAINS = parseEmailDomains(
  process.env.ALLOWED_EMAIL_DOMAINS ?? DEFAULT_EMAIL_DOMAIN,
);

if (ALLOWED_EMAIL_DOMAINS.length === 0) {
  throw new Error('ALLOWED_EMAIL_DOMAINS terisi tapi tidak menghasilkan satu domain pun');
}

/** Hanya email dari domain perusahaan yang boleh ditautkan ke bot. */
export function isAllowedEmail(email: string): boolean {
  return matchesEmailDomain(email, ALLOWED_EMAIL_DOMAINS);
}
