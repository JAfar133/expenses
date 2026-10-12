import type { Database } from '../../infrastructure/database/database.ts';
import { timestampText } from '../../infrastructure/database/sql.ts';
import type { StoredRate } from './rates.types.ts';

export class RatesRepository {
  constructor(private readonly database: Database) {}

  async list(): Promise<StoredRate[]> {
    return this.database.query<StoredRate>(
      `SELECT currency, rate::float8 AS rate, ${timestampText('fetched_at')} AS "fetchedAt"
         FROM exchange_rates ORDER BY currency`,
    );
  }

  /** Saves the current rates and, with `day` (YYYY-MM-DD), the rates of that day in the history. */
  async save(rates: StoredRate[], day?: string): Promise<void> {
    for (const { currency, rate, fetchedAt } of rates) {
      await this.database.query(
        `INSERT INTO exchange_rates (currency, rate, fetched_at) VALUES ($1, $2, $3)
         ON CONFLICT (currency) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at`,
        [currency, rate, fetchedAt],
      );
      if (day) {
        await this.database.query(
          `INSERT INTO exchange_rate_history (currency, date, rate, fetched_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (currency, date) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at`,
          [currency, day, rate, fetchedAt],
        );
      }
    }
  }
}
