import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing via scrypt (built into Node, needs no native modules).
 * Parameters N=2^15, r=8, p=1 (about 32 MB of memory and 100 ms per hash) follow OWASP recommendations.
 * Format: scrypt$N$r$p$salt(base64)$hash(base64)
 */
const PARAMS = { N: 32_768, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Node allows 32 MB by default, while scrypt with these parameters needs slightly more. */
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { ...PARAMS, maxmem: MAX_MEMORY });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/** Constant-time check. Any invalid hash format means "password does not match". */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64');
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
