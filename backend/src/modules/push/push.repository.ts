import type { Database } from '../../infrastructure/database/database.ts';
import type { PushTarget } from './push.types.ts';

export interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  /** Failures in a row: shown as «не отвечает» in the list */
  failures: number;
}

export interface StoredTarget extends PushTarget {
  id: string;
}

/** SQL for push subscriptions. A person only ever reaches their own rows. */
export class PushRepository {
  constructor(private readonly database: Database) {}

  /**
   * Saves a subscription. The same endpoint (a device) belongs to one person at a time: if somebody else used this
   * browser before, it moves to the person who is signed in now.
   */
  async upsert(entry: {
    userId: string;
    target: PushTarget;
    label: string;
  }): Promise<{ id: string }> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
             label = EXCLUDED.label, failures = 0
       RETURNING id`,
      [
        entry.userId,
        entry.target.endpoint,
        entry.target.keys.p256dh,
        entry.target.keys.auth,
        entry.label,
      ],
    );
    return row!;
  }

  async count(userId: string): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id = $1',
      [userId],
    );
    return row?.count ?? 0;
  }

  async list(userId: string): Promise<DeviceView[]> {
    const rows = await this.database.query<{
      id: string;
      label: string;
      created_at: Date;
      last_success_at: Date | null;
      failures: number;
    }>(
      `SELECT id, label, created_at, last_success_at, failures FROM push_subscriptions
        WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at.toISOString(),
      lastSuccessAt: row.last_success_at?.toISOString() ?? null,
      failures: row.failures,
    }));
  }

  /** The delivery targets of a person (secrets: only for sending). */
  async targets(userId: string, id?: string): Promise<StoredTarget[]> {
    const rows = await this.database.query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE user_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at`,
      [userId, id ?? null],
    );
    return rows.map((row) => ({
      id: row.id,
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }));
  }

  /** Removes a device of this person; false when it is not theirs. */
  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.database.query(
      'DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId],
    );
    return rows.length > 0;
  }

  async removeByEndpoint(userId: string, endpoint: string): Promise<void> {
    await this.database.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [userId, endpoint],
    );
  }

  /** The push service said the device is gone (404, 410). */
  async removeById(id: string): Promise<void> {
    await this.database.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
  }

  async markSuccess(id: string): Promise<void> {
    await this.database.query(
      'UPDATE push_subscriptions SET last_success_at = now(), failures = 0 WHERE id = $1',
      [id],
    );
  }

  /** Counts a failure that is not «gone»; returns how many in a row there are now. */
  async markFailure(id: string): Promise<number> {
    const [row] = await this.database.query<{ failures: number }>(
      'UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1 RETURNING failures',
      [id],
    );
    return row?.failures ?? 0;
  }
}
