import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.ts';
import type { Database, SqlExecutor } from '../database/database.ts';

export interface IdempotentRequest {
  userId: string;
  key: string;
  /** Request body: needed to tell a repeat from a different request with the same key */
  payload: unknown;
}

export interface IdempotentResult<T> {
  value: T;
  /** true — a previously stored result was returned, no write was performed */
  replayed: boolean;
}

/**
 * Duplicate protection: one key — at most one write, a repeat returns the earlier result.
 *
 * The key and the write itself are saved in one PostgreSQL transaction, so there is no "unknown"
 * state: either both are committed or neither. A concurrent request with the same key
 * waits for the first to finish and gets its result.
 */
export class IdempotencyService {
  constructor(private readonly database: Database) {}

  run<T>(
    request: IdempotentRequest,
    work: (tx: SqlExecutor) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const { userId, key } = request;
    const requestHash = createHash('sha256').update(JSON.stringify(request.payload)).digest('hex');

    return this.database.transaction(async (tx) => {
      const claimed = await tx.query(
        `INSERT INTO idempotency_keys (user_id, key, request_hash, result)
         VALUES ($1, $2, $3, 'null'::jsonb)
         ON CONFLICT (user_id, key) DO NOTHING
         RETURNING 1`,
        [userId, key, requestHash],
      );

      if (claimed.length === 0) {
        return this.replay<T>(tx, userId, key, requestHash);
      }

      const value = await work(tx);
      await tx.query(
        'UPDATE idempotency_keys SET result = $3::jsonb WHERE user_id = $1 AND key = $2',
        [userId, key, JSON.stringify(value)],
      );
      return { value, replayed: false };
    });
  }

  /** Removes keys older than the given date. Returns the number removed. */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const deleted = await this.database.query(
      'DELETE FROM idempotency_keys WHERE created_at < $1 RETURNING 1',
      [cutoff.toISOString()],
    );
    return deleted.length;
  }

  private async replay<T>(
    tx: SqlExecutor,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotentResult<T>> {
    const [row] = await tx.query<{ request_hash: string; result: T }>(
      'SELECT request_hash, result FROM idempotency_keys WHERE user_id = $1 AND key = $2',
      [userId, key],
    );

    if (row!.request_hash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'Этот ключ запроса уже использован с другими данными',
      );
    }
    return { value: row!.result, replayed: true };
  }
}
