import { PGlite } from '@electric-sql/pglite';
import type { Database, SqlExecutor } from '../../src/infrastructure/database/database.ts';
import { migrate } from '../../src/infrastructure/database/migrate.ts';

/**
 * PostgreSQL в памяти (PGlite — настоящий Postgres, собранный в WASM).
 * Тесты проходят по тем же SQL и миграциям, что и production, но без Docker.
 */
export async function createTestDatabase(): Promise<Database> {
  const pglite = new PGlite();

  const executorFor = (client: Pick<PGlite, 'query' | 'exec'>): SqlExecutor => ({
    query: async <T>(text: string, params?: unknown[]) =>
      (await client.query<T>(text, params)).rows,
    exec: async (text) => void (await client.exec(text)),
  });

  const database: Database = {
    ...executorFor(pglite),
    transaction: (work) => pglite.transaction((tx) => work(executorFor(tx))),
    close: () => pglite.close(),
  };

  await migrate(database);
  return database;
}
