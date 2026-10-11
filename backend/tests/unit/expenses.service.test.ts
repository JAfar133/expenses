import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { ExpenseService } from '../../src/modules/expenses/expenses.service.ts';
import type { ExpenseRepository } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const input = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Erevan City',
  amount: 9703,
};

let database: Database;
let repository: PostgresExpenseRepository;

const createService = (repo: ExpenseRepository = repository) =>
  new ExpenseService(repo, {
    reference: { cards: ['Миша', 'Настя'], categories: ['кафе', 'продукты'] },
  });

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new PostgresExpenseRepository(database);
});

afterAll(() => database.close());

beforeEach(() => database.query('DELETE FROM expenses'));

describe('create', () => {
  it('сохраняет расход в БД в очередь Excel', async () => {
    const created = await createService().create(database, input, 'misha');

    expect(created).toMatchObject({ ...input, source: 'app', excelStatus: 'pending' });
    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('отклоняет карту, которой нет в справочнике', async () => {
    await expect(
      createService().create(database, { ...input, card: 'Вася' }, 'misha'),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_CARD',
    });
    expect(await repository.countQueue()).toBe(0);
  });

  it('принимает неизвестную категорию как есть', async () => {
    const created = await createService().create(
      database,
      { ...input, category: 'путешествия' },
      'misha',
    );

    expect(created.category).toBe('путешествия');
  });
});

describe('getNameSuggestions', () => {
  it('отдаёт подсказки из БД', async () => {
    await repository.importFromExcel(database, [{ ...input, name: 'Латте' }]);

    expect(await createService().getNameSuggestions()).toEqual([
      { name: 'Латте', category: input.category, count: 1 },
    ]);
  });

  it('если БД недоступна, отдаёт пустой список', async () => {
    const broken = {
      ...repository,
      listNameSuggestions: async () => {
        throw new Error('db down');
      },
    } as unknown as ExpenseRepository;

    expect(await createService(broken).getNameSuggestions()).toEqual([]);
  });
});

describe('getCategories', () => {
  it('объединяет конфигурацию и значения из БД без дублей', async () => {
    await repository.importFromExcel(database, [
      { ...input, category: 'транспорт' },
      { ...input, category: 'продукты' },
    ]);

    expect(await createService().getCategories()).toEqual(['кафе', 'продукты', 'транспорт']);
  });

  it('отдаёт категории из конфигурации, если БД недоступна', async () => {
    const broken = {
      ...repository,
      listCategories: async () => {
        throw new Error('db down');
      },
    } as unknown as ExpenseRepository;

    expect(await createService(broken).getCategories()).toEqual(['кафе', 'продукты']);
  });
});
