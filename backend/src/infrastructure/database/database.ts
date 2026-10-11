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

/** Limits that keep a dead or blocked database from hanging requests forever. */
const CONNECTION_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

/** Connection to a real PostgreSQL. `onPoolError` receives errors of idle connections (a lost connection must not crash the process). */
export function createPostgresDatabase(
  connectionString: string,
  onPoolError: (error: Error) => void = () => undefined,
): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
  pool.on('error', onPoolError);

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
