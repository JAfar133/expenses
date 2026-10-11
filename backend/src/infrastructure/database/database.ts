import pg from 'pg';

export type Row = Record<string, unknown>;

/** SQL execution. Parameters are substituted as $1, $2, … (no value concatenation into the query). */
export interface SqlExecutor {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Several commands in a row without parameters (for migrations). */
  exec(text: string): Promise<void>;
}

export interface Database extends SqlExecutor {
  /** Runs work in a transaction: everything is rolled back on error. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Connection to a real PostgreSQL. */
export function createPostgresDatabase(connectionString: string): Database {
  const pool = new pg.Pool({ connectionString, max: 10 });

  const executorFor = (client: pg.Pool | pg.PoolClient): SqlExecutor => ({
    query: async (text, params) => (await client.query(text, params)).rows,
    exec: async (text) => void (await client.query(text)),
  });

  return {
    ...executorFor(pool),

    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(executorFor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    close: () => pool.end(),
  };
}

/** Waits until the database starts responding (e.g. the Postgres container is still starting). */
export async function waitForDatabase(
  database: Database,
  {
    timeoutMs = 30_000,
    intervalMs = 1000,
    onRetry,
  }: { timeoutMs?: number; intervalMs?: number; onRetry?: (error: unknown) => void } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      await database.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
      onRetry?.(error);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
