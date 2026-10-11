import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let repository: PostgresExpenseRepository;

const coffee = { date: '2026-10-10', card: 'Миша', category: 'кафе', name: 'Кофе', amount: 640 };

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new PostgresExpenseRepository(database);
});

afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM expenses');
});

describe('insertPending', () => {
  it('сохраняет расход в очередь Excel и возвращает его с id', async () => {
    const stored = await repository.insertPending(database, coffee, 'misha');

    expect(stored).toMatchObject({ ...coffee, source: 'app', excelStatus: 'pending' });
    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repository.findById(stored.id)).toEqual(stored);
  });

  it('дата возвращается строкой без сдвига часового пояса', async () => {
    const stored = await repository.insertPending(
      database,
      { ...coffee, date: '2026-01-01' },
      'misha',
    );

    expect(stored.date).toBe('2026-01-01');
  });

  it('откатывается вместе с транзакцией', async () => {
    await expect(
      database.transaction(async (tx) => {
        await repository.insertPending(tx, coffee, 'misha');
        throw new Error('rollback');
      }),
    ).rejects.toThrow();

    expect(await repository.countQueue()).toBe(0);
  });
});

describe('очередь в Excel', () => {
  it('listQueue отдаёт только pending, от старых к новым', async () => {
    const first = await repository.insertPending(database, { ...coffee, name: 'Первый' }, 'misha');
    const second = await repository.insertPending(database, { ...coffee, name: 'Второй' }, 'misha');
    const third = await repository.insertPending(database, { ...coffee, name: 'Третий' }, 'misha');
    await repository.markSynced(database, [second.id]);

    const queue = await repository.listQueue(database);

    expect(queue.map((e) => e.name)).toEqual(['Первый', 'Третий']);
    expect(queue.map((e) => e.id)).toEqual([first.id, third.id]);
  });

  it('прогресс статусов: pending → writing → synced', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');

    await repository.markWriting(database, [id]);
    expect((await repository.findById(id))?.excelStatus).toBe('writing');
    expect(await repository.countQueue()).toBe(1);

    await repository.markSynced(database, [id]);
    expect((await repository.findById(id))?.excelStatus).toBe('synced');
    expect(await repository.countQueue()).toBe(0);
  });

  it('markPending возвращает запись в очередь и считает попытки с причиной', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');
    await repository.markWriting(database, [id]);

    await repository.markPending(database, [id], '423 Locked');
    await repository.markPending(database, [id], '423 Locked');

    const [row] = await database.query<{ excel_attempts: number; excel_last_error: string }>(
      'SELECT excel_attempts, excel_last_error FROM expenses WHERE id = $1',
      [id],
    );
    expect(row).toEqual({ excel_attempts: 2, excel_last_error: '423 Locked' });
    expect((await repository.findById(id))?.excelStatus).toBe('pending');
  });

  it('markPending без ошибки не увеличивает счётчик', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');

    await repository.markPending(database, [id]);

    const [row] = await database.query<{ excel_attempts: number }>(
      'SELECT excel_attempts FROM expenses WHERE id = $1',
      [id],
    );
    expect(row!.excel_attempts).toBe(0);
  });

  it('операции с пустым списком id безопасны', async () => {
    await expect(repository.markSynced(database, [])).resolves.toBeUndefined();
    await expect(repository.markWriting(database, [])).resolves.toBeUndefined();
    await expect(repository.markPending(database, [], 'x')).resolves.toBeUndefined();
  });
});

describe('importFromExcel', () => {
  it('добавляет записи как уже синхронизированные', async () => {
    const imported = await repository.importFromExcel(database, [
      coffee,
      { ...coffee, name: 'Булочка', amount: 300 },
    ]);

    expect(imported).toBe(2);
    const all = await repository.listForReconcile(database);
    expect(all).toHaveLength(2);
    expect(all.every((e) => e.source === 'excel' && e.excelStatus === 'synced')).toBe(true);
    expect(await repository.countQueue()).toBe(0);
  });

  it('сохраняет настоящие дубликаты: две одинаковые строки — две записи', async () => {
    await repository.importFromExcel(database, [coffee, coffee]);

    expect(await repository.listForReconcile(database)).toHaveLength(2);
  });

  it('пустой список ничего не делает', async () => {
    expect(await repository.importFromExcel(database, [])).toBe(0);
  });
});

describe('listCategories', () => {
  it('возвращает уникальные категории в порядке появления', async () => {
    await repository.importFromExcel(database, [
      { ...coffee, category: 'кафе' },
      { ...coffee, category: 'продукты' },
    ]);
    await repository.insertPending(database, { ...coffee, category: 'кафе' }, 'misha');
    await repository.insertPending(database, { ...coffee, category: 'транспорт' }, 'misha');

    expect(await repository.listCategories()).toEqual(['кафе', 'продукты', 'транспорт']);
  });
});

describe('listNameSuggestions', () => {
  const add = (name: string, category: string, times = 1) =>
    repository.importFromExcel(
      database,
      Array.from({ length: times }, () => ({ ...coffee, name, category })),
    );

  it('сортирует по частоте, при равенстве свежие выше', async () => {
    await add('Латте', 'кафе', 3);
    await add('Хлеб', 'продукты', 1);
    await add('Эспрессо', 'кафе', 1);
    await add('Молоко', 'продукты', 2);

    const names = (await repository.listNameSuggestions(10)).map((s) => s.name);

    expect(names).toEqual(['Латте', 'Молоко', 'Эспрессо', 'Хлеб']);
  });

  it('считает регистр и пробелы по краям одним названием, показывает свежее написание', async () => {
    await add('латте', 'кафе');
    await add(' Латте ', 'кафе');
    await add('Латте', 'кафе');

    expect(await repository.listNameSuggestions(10)).toEqual([
      { name: 'Латте', category: 'кафе', count: 3 },
    ]);
  });

  it('одно название в разных категориях даёт отдельные записи', async () => {
    await add('Кофе', 'кафе', 2);
    await add('Кофе', 'продукты', 1);

    expect(await repository.listNameSuggestions(10)).toEqual([
      { name: 'Кофе', category: 'кафе', count: 2 },
      { name: 'Кофе', category: 'продукты', count: 1 },
    ]);
  });

  it('не включает удалённые записи и уважает лимит', async () => {
    await add('Латте', 'кафе', 2);
    await add('Хлеб', 'продукты', 1);
    const [bread] = await database.query<{ id: string }>(
      "SELECT id FROM expenses WHERE name = 'Хлеб'",
    );
    await repository.markDeleted(database, [bread!.id], 'excel');

    expect(await repository.listNameSuggestions(10)).toHaveLength(1);
    await add('Чай', 'кафе', 1);
    expect(await repository.listNameSuggestions(1)).toHaveLength(1);
  });
});

describe('мягкое удаление', () => {
  const deletedAtOf = async (id: string) =>
    (await repository.listForReconcile(database)).find((e) => e.id === id)?.deletedAt;

  it('запись помечается удалённой, но остаётся в базе', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');
    await repository.markSynced(database, [id]);

    await repository.markDeleted(database, [id], 'excel');

    expect(await deletedAtOf(id)).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/));
    expect((await repository.findById(id))?.deletedAt).not.toBeNull();
  });

  it('повторная пометка не меняет время удаления', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');
    await repository.markDeleted(database, [id], 'excel');
    const first = await deletedAtOf(id);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await repository.markDeleted(database, [id], 'excel');

    expect(await deletedAtOf(id)).toBe(first);
  });

  it('восстановление снимает пометку', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');
    await repository.markDeleted(database, [id], 'excel');

    await repository.restoreDeleted(database, [id]);

    expect(await deletedAtOf(id)).toBeNull();
  });

  it('удалённые записи не попадают в категории', async () => {
    const kept = await repository.insertPending(database, { ...coffee, category: 'кафе' }, 'misha');
    const gone = await repository.insertPending(
      database,
      { ...coffee, category: 'старое' },
      'misha',
    );
    await repository.markDeleted(database, [gone.id], 'excel');

    expect(await repository.listCategories()).toEqual(['кафе']);
    expect(kept.id).toBeTruthy();
  });

  it('listForReconcile возвращает и удалённые записи: они нужны для восстановления', async () => {
    const { id } = await repository.insertPending(database, coffee, 'misha');
    await repository.markDeleted(database, [id], 'excel');

    const ids = (await repository.listForReconcile(database)).map((e) => e.id);

    expect(ids).toContain(id);
  });

  it('пустой список id безопасен', async () => {
    await expect(repository.markDeleted(database, [], 'excel')).resolves.toBeUndefined();
    await expect(repository.restoreDeleted(database, [])).resolves.toBeUndefined();
  });
});
