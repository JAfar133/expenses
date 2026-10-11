import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { AnalyticsRepository } from '../../src/modules/analytics/analytics.repository.ts';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.ts';
import type { AnalyticsFilters } from '../../src/modules/analytics/analytics.types.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestApp, TEST_TODAY, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

let database: Database;
let expenses: PostgresExpenseRepository;
let service: AnalyticsService;
let t: TestApp;

const NO_FILTERS: AnalyticsFilters = {
  cards: [],
  categories: [],
  createdBy: [],
  currencies: [],
  includeDeleted: false,
};
const OCTOBER = { ...NO_FILTERS, from: '2026-10-01', to: '2026-10-31' };

const add = (
  date: string,
  card: string,
  category: string,
  name: string,
  amount: number,
  createdBy = 'misha',
  original?: { amount: number; currency: string; rate: number },
) => expenses.insertPending(database, { date, card, category, name, amount }, createdBy, original);

/**
 * Октябрь 2026, «сегодня» 15 октября. В периоде 1–31 октября: 5 записей на 2100,
 * в предыдущем отрезке такой же длины (16–30 сентября): одна запись на 900.
 */
async function seed() {
  await add('2026-10-01', 'Миша', 'кафе', 'Латте', 500);
  await add('2026-10-01', 'Миша', 'кафе', 'Эспрессо', 300);
  await add('2026-10-03', 'Настя', 'продукты', 'Хлеб', 200, 'nastya');
  await add('2026-10-10', 'Настя', 'кафе', 'латте', 700, 'nastya');
  await add('2026-10-10', 'Миша', 'продукты', 'Молоко', 400, 'misha', {
    amount: 1,
    currency: 'USD',
    rate: 400,
  });
  await add('2026-09-20', 'Миша', 'кафе', 'Латте', 900);
  const deleted = await add('2026-10-05', 'Миша', 'кафе', 'Удалённая', 9999);
  await expenses.markDeleted(database, [deleted.id], 'excel');
}

beforeAll(async () => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
  service = new AnalyticsService({
    repository: new AnalyticsRepository(database, 'AMD'),
    today: () => TEST_TODAY,
  });
});

afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM expenses');
  await database.query('DELETE FROM auth_sessions');
  await seed();
});

describe('summary', () => {
  it('считает итог, среднее, медиану, максимум и расход в день за прошедшие дни периода', async () => {
    const { current } = await service.summary(OCTOBER);

    expect(current).toEqual({
      total: 2100,
      count: 5,
      average: 420,
      median: 400,
      max: 700,
      activeDays: 3,
      firstDate: '2026-10-01',
      lastDate: '2026-10-10',
      // С 1 по 15 октября прошло 15 дней (будущие дни месяца не считаются)
      days: 15,
      perDay: 140,
    });
  });

  it('сравнивает с таким же числом дней перед началом периода', async () => {
    const { previous } = await service.summary(OCTOBER);

    expect(previous).toMatchObject({ total: 900, count: 1, days: 15, perDay: 60 });
  });

  it('удалённые записи не считаются, пока их не попросят', async () => {
    expect((await service.summary(OCTOBER)).current.total).toBe(2100);
    expect((await service.summary({ ...OCTOBER, includeDeleted: true })).current.total).toBe(12099);
  });

  it('без границ периода: от первой записи до сегодня, предыдущего периода нет', async () => {
    const result = await service.summary(NO_FILTERS);

    expect(result.current).toMatchObject({ total: 3000, days: 26 });
    expect(result.previous).toBeNull();
  });

  it('прошедший месяц считается целиком', async () => {
    const { current, previous } = await service.summary({
      ...NO_FILTERS,
      from: '2026-09-01',
      to: '2026-09-30',
    });

    expect(current).toMatchObject({ total: 900, days: 30, perDay: 30 });
    expect(previous).toMatchObject({ total: 0, count: 0, days: 30 });
  });

  it('пустая выборка даёт нули, а не ошибку', async () => {
    const { current } = await service.summary({ ...OCTOBER, categories: ['нет такой'] });

    expect(current).toMatchObject({ total: 0, count: 0, average: 0, median: 0, max: 0, perDay: 0 });
    expect(current.firstDate).toBeNull();
  });
});

describe('фильтры', () => {
  const total = async (filters: Partial<AnalyticsFilters>) =>
    (await service.summary({ ...OCTOBER, ...filters })).current.total;

  it('карта, категория, автор', async () => {
    expect(await total({ cards: ['Настя'] })).toBe(900);
    expect(await total({ categories: ['продукты'] })).toBe(600);
    expect(await total({ createdBy: ['nastya'] })).toBe(900);
    expect(await total({ cards: ['Миша', 'Настя'], categories: ['кафе'] })).toBe(1500);
  });

  it('валюта ввода: расходы в драммах это базовая валюта', async () => {
    expect(await total({ currencies: ['USD'] })).toBe(400);
    expect(await total({ currencies: ['AMD'] })).toBe(1700);
    expect(await total({ currencies: ['AMD', 'USD'] })).toBe(2100);
  });

  it('поиск по наименованию без учёта регистра', async () => {
    expect(await total({ q: 'ЛАТТЕ' })).toBe(1200);
    expect(await total({ q: 'прес' })).toBe(300);
  });

  it('символы шаблона в поиске ищутся как текст', async () => {
    await add('2026-10-02', 'Миша', 'кафе', '100% сок', 50);

    expect(await total({ q: '%' })).toBe(50);
    expect(await total({ q: '_' })).toBe(0);
  });

  it('границы суммы включительно', async () => {
    expect(await total({ minAmount: 400 })).toBe(1600);
    expect(await total({ maxAmount: 300 })).toBe(500);
    expect(await total({ minAmount: 300, maxAmount: 500 })).toBe(1200);
  });

  it('граничные даты периода входят в выборку', async () => {
    expect(await total({ from: '2026-10-01', to: '2026-10-01' })).toBe(800);
    expect(await total({ from: '2026-10-10', to: '2026-10-10' })).toBe(1100);
  });
});

describe('breakdown', () => {
  it('категории от самых затратных', async () => {
    expect(await service.breakdown(OCTOBER, 'category', 100)).toEqual([
      { key: 'кафе', total: 1500, count: 3, average: 500 },
      { key: 'продукты', total: 600, count: 2, average: 300 },
    ]);
  });

  it('карты', async () => {
    const rows = await service.breakdown(OCTOBER, 'card', 100);

    expect(rows.map((r) => [r.key, r.total])).toEqual([
      ['Миша', 1200],
      ['Настя', 900],
    ]);
  });

  it('наименования объединяются без учёта регистра, показывается свежее написание', async () => {
    const rows = await service.breakdown(OCTOBER, 'name', 100);

    expect(rows[0]).toEqual({ key: 'латте', total: 1200, count: 2, average: 600 });
  });

  it('дни недели: 1 понедельник … 7 воскресенье', async () => {
    const rows = await service.breakdown(OCTOBER, 'weekday', 100);

    // 1 октября 2026 четверг (4), 3 и 10 октября суббота (6)
    expect(rows.map((r) => [r.key, r.total])).toEqual([
      ['6', 1300],
      ['4', 800],
    ]);
  });

  it('валюты ввода', async () => {
    const rows = await service.breakdown(OCTOBER, 'currency', 100);

    expect(rows.map((r) => [r.key, r.total])).toEqual([
      ['AMD', 1700],
      ['USD', 400],
    ]);
  });

  it('авторы и лимит', async () => {
    expect((await service.breakdown(OCTOBER, 'createdBy', 100)).map((r) => r.key)).toEqual([
      'misha',
      'nastya',
    ]);
    expect(await service.breakdown(OCTOBER, 'category', 1)).toHaveLength(1);
  });
});

describe('timeseries', () => {
  it('по дням до сегодняшнего дня, пропуски заполнены нулями, будущие дни не добавляются', async () => {
    const points = await service.timeseries(OCTOBER, 'day');

    expect(points).toHaveLength(15);
    expect(points[0]).toEqual({ period: '2026-10-01', total: 800, count: 2 });
    expect(points[1]).toEqual({ period: '2026-10-02', total: 0, count: 0 });
    expect(points[9]).toEqual({ period: '2026-10-10', total: 1100, count: 2 });
    expect(points.at(-1)!.period).toBe('2026-10-15');
    expect(points.reduce((sum, p) => sum + p.total, 0)).toBe(2100);
  });

  it('по неделям (с понедельника) и по месяцам', async () => {
    const weeks = await service.timeseries(OCTOBER, 'week');
    const months = await service.timeseries(
      { ...NO_FILTERS, from: '2026-09-01', to: '2026-10-31' },
      'month',
    );

    expect(weeks.map((w) => [w.period, w.total])).toEqual([
      ['2026-09-28', 1000],
      ['2026-10-05', 1100],
      ['2026-10-12', 0],
    ]);
    expect(months.map((m) => [m.period, m.total])).toEqual([
      ['2026-09-01', 900],
      ['2026-10-01', 2100],
    ]);
  });

  it('с разбивкой по категории: только непустые точки', async () => {
    const points = await service.timeseries(OCTOBER, 'day', 'category');

    expect(points).toContainEqual({ period: '2026-10-01', key: 'кафе', total: 800, count: 2 });
    expect(points.every((p) => p.total > 0)).toBe(true);
  });

  it('без периода и без данных: пустой список', async () => {
    await database.query('DELETE FROM expenses');

    expect(await service.timeseries(NO_FILTERS, 'day')).toEqual([]);
  });

  it('заданный период без данных: нули за прошедшие дни', async () => {
    await database.query('DELETE FROM expenses');

    const points = await service.timeseries(OCTOBER, 'day');

    expect(points).toHaveLength(15);
    expect(points.every((p) => p.total === 0)).toBe(true);
  });
});

describe('list', () => {
  const page = (options: Partial<Parameters<AnalyticsService['list']>[1]> = {}) =>
    service.list(OCTOBER, { sort: 'date', direction: 'desc', limit: 50, offset: 0, ...options });

  it('отдаёт записи, число записей и сумму по фильтрам', async () => {
    const result = await page();

    expect(result.total).toBe(5);
    expect(result.totalAmount).toBe(2100);
    expect(result.items).toHaveLength(5);
  });

  it('сортирует по сумме в обе стороны', async () => {
    expect((await page({ sort: 'amount', direction: 'desc' })).items.map((i) => i.amount)).toEqual([
      700, 500, 400, 300, 200,
    ]);
    expect((await page({ sort: 'amount', direction: 'asc' })).items.map((i) => i.amount)).toEqual([
      200, 300, 400, 500, 700,
    ]);
  });

  it('сортирует по наименованию без учёта регистра', async () => {
    const names = (await page({ sort: 'name', direction: 'asc' })).items.map((i) => i.name);

    expect(names).toEqual(['Латте', 'латте', 'Молоко', 'Хлеб', 'Эспрессо']);
  });

  it('страницы не пересекаются и покрывают всё', async () => {
    const first = await page({ sort: 'amount', limit: 2, offset: 0 });
    const second = await page({ sort: 'amount', limit: 2, offset: 2 });
    const third = await page({ sort: 'amount', limit: 2, offset: 4 });

    expect(first.total).toBe(5);
    const ids = [...first.items, ...second.items, ...third.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.items).toHaveLength(1);
  });

  it('показывает исходную сумму в валюте, автора и источник', async () => {
    const milk = (await page()).items.find((i) => i.name === 'Молоко')!;

    expect(milk).toMatchObject({
      amount: 400,
      original: { amount: 1, currency: 'USD', rate: 400 },
      createdBy: 'misha',
      source: 'app',
      excelStatus: 'pending',
      deletedAt: null,
    });
    expect((await page()).items.find((i) => i.name === 'Хлеб')!.original).toBeNull();
  });

  it('при включённых удалённых показывает и их', async () => {
    const result = await service.list(
      { ...OCTOBER, includeDeleted: true },
      { sort: 'amount', direction: 'desc', limit: 1, offset: 0 },
    );

    expect(result.items[0]).toMatchObject({ name: 'Удалённая' });
    expect(result.items[0]!.deletedAt).not.toBeNull();
  });
});

describe('HTTP API', () => {
  const get = (url: string) => t.inject({ method: 'GET', url });

  beforeEach(async () => {
    t = await createTestApp(database);
  });

  it('требует входа', async () => {
    for (const url of ['summary', 'breakdown?by=category', 'timeseries']) {
      expect((await t.app.inject({ method: 'GET', url: `/api/analytics/${url}` })).statusCode).toBe(
        401,
      );
    }
    expect((await t.app.inject({ method: 'GET', url: '/api/expenses' })).statusCode).toBe(401);
  });

  it('summary: период и списки в адресе (повтором и через запятую)', async () => {
    const repeated = await get(
      '/api/analytics/summary?from=2026-10-01&to=2026-10-31&cards=Миша&cards=Настя',
    );
    const comma = await get(
      '/api/analytics/summary?from=2026-10-01&to=2026-10-31&cards=Миша,Настя',
    );

    expect(repeated.json().data.current.total).toBe(2100);
    expect(comma.json().data.current.total).toBe(2100);
    expect(repeated.json().data.previous.total).toBe(900);
  });

  it('breakdown и timeseries отдают данные', async () => {
    const breakdown = await get(
      '/api/analytics/breakdown?by=category&from=2026-10-01&to=2026-10-31',
    );
    const series = await get('/api/analytics/timeseries?from=2026-10-01&to=2026-10-31');

    expect(breakdown.json().data[0]).toMatchObject({ key: 'кафе', total: 1500 });
    expect(series.json().data).toHaveLength(15);
  });

  it('список: сортировка и страницы', async () => {
    const response = await get(
      '/api/expenses?from=2026-10-01&to=2026-10-31&sort=amount&direction=desc&limit=2',
    );

    const data = response.json().data;
    expect(data.items.map((i: { amount: number }) => i.amount)).toEqual([700, 500]);
    expect(data.total).toBe(5);
  });

  it('пустые значения в адресе считаются «не задано»', async () => {
    const response = await get('/api/analytics/summary?from=&q=&minAmount=');

    expect(response.statusCode).toBe(200);
    expect(response.json().data.current.total).toBe(3000);
  });

  it.each([
    ['дата не в формате', '/api/analytics/summary?from=вчера'],
    ['конец раньше начала', '/api/analytics/summary?from=2026-10-10&to=2026-10-01'],
    ['максимум меньше минимума', '/api/analytics/summary?minAmount=500&maxAmount=100'],
    ['неизвестный разрез', '/api/analytics/breakdown?by=password'],
    ['нет разреза', '/api/analytics/breakdown'],
    ['неизвестная колонка сортировки', '/api/expenses?sort=amount;DROP TABLE expenses'],
    ['слишком большой лимит', '/api/expenses?limit=100000'],
    ['неизвестная гранулярность', '/api/analytics/timeseries?granularity=year'],
  ])('%s: 400 INVALID_QUERY', async (_title, url) => {
    const response = await get(url);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_QUERY');
  });

  it('попытка SQL-инъекции в поиске и фильтрах просто ничего не находит', async () => {
    const response = await get(
      `/api/analytics/summary?q=${encodeURIComponent("'; DROP TABLE expenses; --")}&cards=${encodeURIComponent("x' OR '1'='1")}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.current.count).toBe(0);
    expect((await database.query('SELECT 1 FROM expenses')).length).toBeGreaterThan(0);
  });
});
