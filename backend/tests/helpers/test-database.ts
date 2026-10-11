import { PGlite } from '@electric-sql/pglite';
import type { Database, SqlExecutor } from '../../src/infrastructure/database/database.ts';
import { migrate } from '../../src/infrastructure/database/migrate.ts';

/**
 * In-memory PostgreSQL (PGlite is a real Postgres compiled to WASM).
 * Tests run the same SQL and migrations as production, but without Docker.
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
