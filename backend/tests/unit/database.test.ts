import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { migrate } from '../../src/infrastructure/database/migrate.ts';
import { dateText } from '../../src/infrastructure/database/sql.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(() => database.close());

describe('миграции', () => {
  it('создают таблицы', async () => {
    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
    );

    expect(tables.map((t) => t.table_name)).toEqual([
      'ai_usage',
      'api_keys',
      'app_settings',
      'auth_sessions',
      'bank_imports',
      'budgets',
      'card_access',
      'cards',
      'categories',
      'exchange_rate_history',
      'exchange_rates',
      'expense_attachments',
      'expense_changes',
      'expense_items',
      'expense_templates',
      'expenses',
      'groups',
      'idempotency_keys',
      'invitations',
      'memberships',
      'schema_migrations',
      'sync_state',
      'template_hidden',
      'template_order',
      'users',
    ]);
  });

  it('повторный запуск ничего не применяет', async () => {
    expect(await migrate(database)).toEqual([]);
  });
});

describe('ограничения схемы', () => {
  const insert = (overrides: Record<string, unknown> = {}) => {
    const row = {
      id: crypto.randomUUID(),
      date: '2026-10-10',
      card: 'Миша',
      category: 'кафе',
      name: 'Кофе',
      amount: 640,
      source: 'app',
      excel_status: 'pending',
      created_by: 'local',
      ...overrides,
    };
    return database.query(
      `INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.id,
        row.date,
        row.card,
        row.category,
        row.name,
        row.amount,
        row.source,
        row.excel_status,
        row.created_by,
      ],
    );
  };

  it('принимает корректную запись и возвращает дату строкой без сдвига', async () => {
    await insert({ date: '2026-01-05' });

    const [row] = await database.query<{ date: string }>(
      `SELECT ${dateText('date')} AS date FROM expenses WHERE date = '2026-01-05'`,
    );
    expect(row!.date).toBe('2026-01-05');
  });

  it.each([
    ['нулевая сумма', { amount: 0 }],
    ['отрицательная сумма', { amount: -5 }],
    ['неизвестный источник', { source: 'phone' }],
    ['неизвестный статус Excel', { excel_status: 'done' }],
  ])('отклоняет: %s', async (_name, overrides) => {
    await expect(insert(overrides)).rejects.toThrow();
  });
});

describe('транзакции', () => {
  it('откатывают изменения при ошибке', async () => {
    await expect(
      database.transaction(async (tx) => {
        await tx.query(`INSERT INTO sync_state (id, last_result) VALUES (1, '{}')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await database.query('SELECT 1 FROM sync_state')).toHaveLength(0);
  });
});

describe('мягкое удаление в схеме', () => {
  const insertWith = (deletedAt: string | null, reason: string | null) =>
    database.query(
      `INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by, deleted_at, deleted_reason)
       VALUES (gen_random_uuid(), '2026-10-10', 'Миша', 'кафе', 'Кофе', 640, 'app', 'synced', 'local', $1, $2)`,
      [deletedAt, reason],
    );

  it('принимает активную и удалённую запись', async () => {
    await expect(insertWith(null, null)).resolves.toBeDefined();
    await expect(insertWith('2026-10-10T10:00:00Z', 'excel')).resolves.toBeDefined();
  });

  it('время удаления без причины (и наоборот) отклоняется', async () => {
    await expect(insertWith('2026-10-10T10:00:00Z', null)).rejects.toThrow();
    await expect(insertWith(null, 'excel')).rejects.toThrow();
  });
});
