import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './database.ts';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
/** Произвольное число: блокирует одновременный запуск миграций из нескольких процессов. */
const MIGRATION_LOCK_ID = 727_274;

/**
 * Применяет по порядку все файлы `migrations/*.sql`, которых ещё нет в `schema_migrations`.
 * Каждая миграция выполняется в своей транзакции. Возвращает имена применённых миграций.
 */
export async function migrate(database: Database): Promise<string[]> {
  const files = (await readdir(fileURLToPath(MIGRATIONS_DIR)))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];

  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');

    await database.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);

      const done = await tx.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.length > 0) return;

      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
    });
  }

  return applied;
}
