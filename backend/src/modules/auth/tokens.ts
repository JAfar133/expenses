import { createHash, randomBytes } from 'node:crypto';

/** A random 256-bit token. Sent to the client in a cookie; only its hash is stored in the database. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
