import { createHash, randomBytes } from 'node:crypto';

/** Случайный токен на 256 бит. Передаётся клиенту в куке, в базе хранится только его хеш. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
