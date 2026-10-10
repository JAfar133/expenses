import pg from 'pg';

export type Row = Record<string, unknown>;

/** Выполнение SQL. Параметры подставляются как $1, $2, … (никакой конкатенации значений в запрос). */
export interface SqlExecutor {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Несколько команд подряд без параметров (для миграций). */
  exec(text: string): Promise<void>;
}

export interface Database extends SqlExecutor {
  /** Выполняет работу в транзакции: при ошибке всё откатывается. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Подключение к настоящему PostgreSQL. */
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

/** Ждёт, пока база начнёт отвечать (например, контейнер Postgres ещё запускается). */
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
