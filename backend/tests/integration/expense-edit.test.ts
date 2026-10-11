import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { describeExcelState } from '../../src/storage/excel-state.ts';
import type { Expense, StoredExpense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const coffee: Expense = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'кафе',
  name: 'Кофе',
  amount: 640,
};

let database: Database;
let repository: PostgresExpenseRepository;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
  repository = new PostgresExpenseRepository(database);
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM expense_changes');
  await database.query('DELETE FROM expenses');
  await database.query('DELETE FROM auth_sessions');
  t = await createTestApp(database);
});

/** Запись, уже лежащая в Excel (снимок строки равен значениям). */
async function inExcel(expense: Expense = coffee): Promise<StoredExpense> {
  const created = await repository.insertPending(database, expense, 'misha');
  await repository.markSynced(database, [created.id]);
  return (await repository.findById(created.id))!;
}

const patch = (id: string, payload: unknown, as: 'misha' | 'nastya' = 'misha') =>
  t.inject({ method: 'PATCH', url: `/api/expenses/${id}`, payload: payload as object }, as);
const del = (id: string, as: 'misha' | 'nastya' = 'misha') =>
  t.inject({ method: 'DELETE', url: `/api/expenses/${id}` }, as);
const restore = (id: string, as: 'misha' | 'nastya' = 'misha') =>
  t.inject({ method: 'POST', url: `/api/expenses/${id}/restore` }, as);

const changes = () =>
  database.query<{ action: string; changed_by: string; before: unknown; after: unknown }>(
    'SELECT action, changed_by, before, after FROM expense_changes ORDER BY id',
  );

describe('права', () => {
  it('править и удалять может только редактор; остальные получают 403 и ничего не меняется', async () => {
    const record = await inExcel();

    for (const response of [
      await patch(record.id, { amount: 1 }, 'nastya'),
      await del(record.id, 'nastya'),
      await restore(record.id, 'nastya'),
    ]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
    expect(await repository.findById(record.id)).toEqual(record);
    expect(await changes()).toHaveLength(0);
  });

  it('без входа 401', async () => {
    const record = await inExcel();

    for (const request of [
      { method: 'PATCH' as const, url: `/api/expenses/${record.id}`, payload: { amount: 1 } },
      { method: 'DELETE' as const, url: `/api/expenses/${record.id}` },
      { method: 'POST' as const, url: `/api/expenses/${record.id}/restore` },
    ]) {
      expect(
        (await t.app.inject({ ...request, headers: { origin: TEST_ORIGIN } })).statusCode,
      ).toBe(401);
    }
  });

  it('/api/auth/me сообщает, может ли пользователь править', async () => {
    expect(
      (await t.inject({ method: 'GET', url: '/api/auth/me' }, 'misha')).json().data.user.canEdit,
    ).toBe(true);
    expect(
      (await t.inject({ method: 'GET', url: '/api/auth/me' }, 'nastya')).json().data.user.canEdit,
    ).toBe(false);
  });
});

describe('правка', () => {
  it('меняет значения, пишет журнал, запись ждёт обновления Excel', async () => {
    const record = await inExcel();

    const response = await patch(record.id, { name: 'Кофе с молоком', amount: 800 });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: record.id,
      name: 'Кофе с молоком',
      amount: 800,
      excelState: 'pending-update',
    });
    expect(await repository.findById(record.id)).toMatchObject({
      name: 'Кофе с молоком',
      amount: 800,
      excelSnapshot: coffee,
    });
    const log = await changes();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'update', changed_by: 'misha' });
    expect(log[0]!.before).toMatchObject({ name: 'Кофе', amount: 640 });
    expect(log[0]!.after).toMatchObject({ name: 'Кофе с молоком', amount: 800 });
  });

  it('можно править любое из полей: дату, карту, категорию', async () => {
    const record = await inExcel();

    await patch(record.id, { date: '2026-09-01', card: 'Настя', category: 'продукты' });

    expect(await repository.findById(record.id)).toMatchObject({
      date: '2026-09-01',
      card: 'Настя',
      category: 'продукты',
      name: 'Кофе',
    });
  });

  it('запись, которой ещё нет в Excel, просто получает новые значения и остаётся в очереди на добавление', async () => {
    t.sync.excelAvailable = false; // Excel занят: очередь не записывается
    const created = await repository.insertPending(database, coffee, 'misha');

    const response = await patch(created.id, { amount: 5 });

    expect(response.json().data.excelState).toBe('pending-add');
  });

  it('без изменений: 200, журнал пуст', async () => {
    const record = await inExcel();

    const response = await patch(record.id, { name: 'Кофе', amount: 640 });

    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe('Изменений нет');
    expect(await changes()).toHaveLength(0);
  });

  it('смена суммы сбрасывает исходную сумму в валюте, остальные правки её сохраняют', async () => {
    const created = await repository.insertPending(database, coffee, 'misha', {
      amount: 2,
      currency: 'USD',
      rate: 320,
    });

    await patch(created.id, { name: 'Переименовано' });
    expect((await repository.findById(created.id))!.original).toMatchObject({ currency: 'USD' });

    await patch(created.id, { amount: 700 });
    expect((await repository.findById(created.id))!.original).toBeNull();
  });

  it.each([
    ['карта не из списка', { card: 'Вася' }, 'INVALID_CARD'],
    ['нулевая сумма', { amount: 0 }, 'INVALID_AMOUNT'],
    ['дробная сумма', { amount: 10.5 }, 'INVALID_AMOUNT'],
    ['отрицательная сумма', { amount: -5 }, 'INVALID_AMOUNT'],
    ['некорректная дата', { date: '10.10.2026' }, 'INVALID_DATE'],
    ['пустое наименование', { name: '   ' }, 'INVALID_NAME'],
    ['слишком длинное наименование', { name: 'я'.repeat(256) }, 'INVALID_NAME'],
    ['пустая категория', { category: '' }, 'INVALID_CATEGORY'],
    ['ничего не указано', {}, 'NOTHING_TO_UPDATE'],
    ['неизвестное поле', { createdBy: 'nastya' }, 'VALIDATION_ERROR'],
  ])('%s: 422 %s и запись не меняется', async (_title, payload, code) => {
    const record = await inExcel();

    const response = await patch(record.id, payload);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe(code);
    expect(await repository.findById(record.id)).toEqual(record);
  });

  it('неизвестная запись: 404, неверный идентификатор: 422', async () => {
    expect((await patch('2b7f0b4e-8b1d-4c3a-9d2e-5b1f0c9a7d11', { amount: 1 })).statusCode).toBe(
      404,
    );
    expect((await patch('не-uuid', { amount: 1 })).statusCode).toBe(422);
  });

  it('удалённую запись править нельзя: сначала вернуть', async () => {
    const record = await inExcel();
    await del(record.id);

    const response = await patch(record.id, { amount: 1 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('EXPENSE_DELETED');
  });

  it('запись, которую как раз пишут в Excel, править нельзя: повторите позже', async () => {
    const created = await repository.insertPending(database, coffee, 'misha');
    await repository.markWriting(database, [created.id]);

    for (const response of [await patch(created.id, { amount: 1 }), await del(created.id)]) {
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('EXPENSE_BUSY');
    }
  });
});

describe('удаление и возврат', () => {
  it('удаление мягкое: запись остаётся, ждёт удаления строки из Excel, пишется в журнал', async () => {
    const record = await inExcel();

    const response = await del(record.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: record.id, excelState: 'pending-remove' });
    expect(response.json().data.deletedAt).not.toBeNull();
    expect(await repository.findById(record.id)).toMatchObject({
      deletedReason: 'app',
      excelSnapshot: coffee,
    });
    expect((await changes()).map((c) => c.action)).toEqual(['delete']);
  });

  it('запись, которой не было в Excel, удаляется сразу: строку убирать не из чего', async () => {
    const created = await repository.insertPending(database, coffee, 'misha');

    const response = await del(created.id);

    expect(response.json().data.excelState).toBe('removed');
    expect(await repository.listQueue(database)).toEqual([]);
  });

  it('повторное удаление безопасно и не засоряет журнал', async () => {
    const record = await inExcel();
    await del(record.id);

    const again = await del(record.id);

    expect(again.statusCode).toBe(200);
    expect(await changes()).toHaveLength(1);
  });

  it('возврат до удаления строки из Excel: запись снова активна и идентична Excel', async () => {
    const record = await inExcel();
    await del(record.id);

    const response = await restore(record.id);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ deletedAt: null, excelState: 'synced' });
    expect((await changes()).map((c) => c.action)).toEqual(['delete', 'restore']);
  });

  it('возврат после удаления строки из Excel: запись снова встаёт в очередь на добавление', async () => {
    const record = await inExcel();
    await del(record.id);
    await repository.clearSnapshots(database, [record.id]); // синхронизация убрала строку
    t.sync.excelAvailable = false;

    const response = await restore(record.id);

    expect(response.json().data.excelState).toBe('pending-add');
    expect((await repository.listQueue(database)).map((r) => r.id)).toEqual([record.id]);
  });

  it('возврат активной записи ничего не делает', async () => {
    const record = await inExcel();

    const response = await restore(record.id);

    expect(response.statusCode).toBe(200);
    expect(await changes()).toHaveLength(0);
  });

  it('удалённая запись не попадает в аналитику, а при включённых удалённых видна', async () => {
    const record = await inExcel();
    await del(record.id);

    const without = await t.inject({ method: 'GET', url: '/api/analytics/summary' });
    const withDeleted = await t.inject({ method: 'GET', url: '/api/expenses?includeDeleted=true' });

    expect(without.json().data.current.count).toBe(0);
    expect(withDeleted.json().data.items[0]).toMatchObject({
      id: record.id,
      excelState: 'pending-remove',
      deletedReason: 'app',
    });
  });
});

describe('состояние записи относительно Excel', () => {
  const base = { ...coffee, deletedAt: null, deletedReason: null, excelSnapshot: null };

  it.each([
    ['активная, в Excel идентична', { excelSnapshot: coffee }, 'synced'],
    [
      'активная, в Excel прежняя строка',
      { excelSnapshot: { ...coffee, amount: 1 } },
      'pending-update',
    ],
    ['активная, в Excel ещё нет', {}, 'pending-add'],
    [
      'удалена в приложении, строка ещё в Excel',
      { deletedAt: 'x', deletedReason: 'app', excelSnapshot: coffee },
      'pending-remove',
    ],
    ['удалена в приложении, строка убрана', { deletedAt: 'x', deletedReason: 'app' }, 'removed'],
    [
      'удалена, потому что строку убрали в Excel',
      { deletedAt: 'x', deletedReason: 'excel' },
      'missing',
    ],
  ])('%s → %s', (_title, overrides, expected) => {
    expect(describeExcelState({ ...base, ...overrides } as never)).toBe(expected);
  });

  it('список операций отдаёт состояние и причину задержки', async () => {
    const identical = await inExcel(coffee);
    const edited = await inExcel({ ...coffee, name: 'Хлеб', category: 'продукты' });
    await patch(edited.id, { amount: 1 });
    const queued = await repository.insertPending(database, { ...coffee, name: 'Новая' }, 'misha');
    await repository.markPending(database, [queued.id], 'FILE_LOCKED');

    const items = (await t.inject({ method: 'GET', url: '/api/expenses?limit=50' })).json().data
      .items;
    const state = (id: string) => items.find((i: { id: string }) => i.id === id);

    expect(state(identical.id).excelState).toBe('synced');
    expect(state(edited.id).excelState).toBe('pending-update');
    expect(state(queued.id)).toMatchObject({
      excelState: 'pending-add',
      excelError: 'FILE_LOCKED',
    });
  });
});
