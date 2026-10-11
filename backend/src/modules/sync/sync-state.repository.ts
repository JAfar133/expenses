import type { Database } from '../../infrastructure/database/database.ts';
import type { SyncResult } from './sync.types.ts';

/** Stores the result of the last sync so it survives a backend restart. */
export class SyncStateRepository {
  constructor(private readonly database: Database) {}

  async get(): Promise<SyncResult | undefined> {
    const [row] = await this.database.query<{ last_result: SyncResult }>(
      'SELECT last_result FROM sync_state WHERE id = 1',
    );
    return row?.last_result;
  }

  async save(result: SyncResult): Promise<void> {
    await this.database.query(
      `INSERT INTO sync_state (id, last_result, updated_at) VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET last_result = EXCLUDED.last_result, updated_at = now()`,
      [JSON.stringify(result)],
    );
  }
}
