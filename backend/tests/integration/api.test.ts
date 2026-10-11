import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const validBody = {
  date: '2026-10-10',
  card: 'Миша',
  category: 'продукты',
  name: 'Erevan City',
  amount: 9703,
};

let database: Database;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(() => database.close());

beforeEach(async () => {
  await database.query('DELETE FROM expenses');
  await database.query('DELETE FROM idempotency_keys');
  await database.query('DELETE FROM auth_sessions');
  t = await createTestApp(database);
});

/** Отправляет расход; без явного ключа каждый вызов считается новым запросом. */
const post = (body: unknown, key: string | null = randomUUID()) =>
  t.inject({
    method: 'POST',
    url: '/api/expenses',
    payload: body as object,
    headers: key ? { 'idempotency-key': key } : {},
  });

const expenseCount = async () => (await database.query('SELECT 1 FROM expenses')).length;

describe('POST /api/expenses', () => {
  it('сохраняет расход в БД, записывает в Excel и возвращает 201', async () => {
    const response = await post(validBody);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: { ...validBody, excelStatus: 'synced' },
      message: 'Расход успешно добавлен',
    });
    const saved = await t.repository.findById(response.json().data.id);
    expect(saved).toMatchObject({ ...validBody, source: 'app', excelStatus: 'synced' });
  });

  it('обрезает пробелы в наименовании', async () => {
    const response = await post({ ...validBody, name: '  Кофе  ' });

    expect(response.json().data.name).toBe('Кофе');
  });

  it.each([
    [{ ...validBody, amount: 0 }, 'INVALID_AMOUNT', 'Стоимость должна быть больше нуля'],
    [{ ...validBody, amount: -5 }, 'INVALID_AMOUNT', 'Стоимость должна быть больше нуля'],
    [{ ...validBody, amount: 10.5 }, 'INVALID_AMOUNT', 'Стоимость должна быть целым числом'],
    [{ ...validBody, amount: '100' }, 'INVALID_AMOUNT', 'Стоимость должна быть числом'],
    [{ ...validBody, date: '2026-02-30' }, 'INVALID_DATE', 'Укажите корректную дату'],
    [{ ...validBody, name: '   ' }, 'INVALID_NAME', 'Введите наименование'],
    [{ ...validBody, name: 'x'.repeat(256) }, 'INVALID_NAME', expect.any(String)],
    [{ ...validBody, category: '' }, 'INVALID_CATEGORY', 'Выберите категорию'],
    [{ ...validBody, card: 'Вася' }, 'INVALID_CARD', 'Выберите карту из списка'],
  ])('возвращает 422 на некорректные данные %#', async (body, code, message) => {
    const response = await post(body);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ success: false, error: { code, message } });
    expect(await expenseCount()).toBe(0);
  });

  it('возвращает 400 на битый JSON', async () => {
    const response = await t.inject({
      method: 'POST',
      url: '/api/expenses',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });

  it('не раскрывает детали непредвиденных ошибок', async () => {
    await database.exec('ALTER TABLE expenses RENAME TO expenses_broken');
    try {
      const response = await post(validBody);

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('expenses_broken');
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    } finally {
      await database.exec('ALTER TABLE expenses_broken RENAME TO expenses');
    }
  });
});

describe('очередь, когда Excel недоступен', () => {
  it('расход сохраняется в БД и ждёт в очереди: ответ 201 со статусом queued', async () => {
    t.sync.excelAvailable = false;

    const response = await post(validBody);

    expect(response.statusCode).toBe(201);
    expect(response.json().data.excelStatus).toBe('queued');
    expect(response.json().message).toContain('появится позже');
    expect(await t.repository.countQueue()).toBe(1);
  });

  it('если Excel отвечает слишком долго, ответ не ждёт: расход остаётся в очереди', async () => {
    t = await createTestApp(database, { inlineExcelWaitMs: 30 });
    t.sync.delayMs = 300;

    const response = await post(validBody);

    expect(response.statusCode).toBe(201);
    expect(response.json().data.excelStatus).toBe('queued');
  });

  it('после освобождения файла очередь записывается при следующей синхронизации', async () => {
    t.sync.excelAvailable = false;
    const { id } = (await post(validBody)).json().data;

    t.sync.excelAvailable = true;
    await t.sync.requestCycle();

    expect((await t.repository.findById(id))?.excelStatus).toBe('synced');
  });
});

describe('Excel отключён (не задан ONEDRIVE_FILE_PATH)', () => {
  it('расход сохраняется в БД, синхронизация не запускается, ответ 201 со статусом disabled', async () => {
    t.sync.enabled = false;

    const response = await post(validBody);

    expect(response.statusCode).toBe(201);
    expect(response.json().data.excelStatus).toBe('disabled');
    expect(response.json().message).toBe('Расход успешно добавлен');
    expect(t.sync.cycles).toBe(0);
    // Запись остаётся в очереди: если Excel подключат позже, она допишется сама
    expect(await t.repository.countQueue()).toBe(1);
  });
});

describe('идемпотентность', () => {
  const KEY = '5df127c1-787a-4a40-8c1b-3a6a84bcaf18';

  it('повтор запроса возвращает 200 с тем же id и не создаёт второй расход', async () => {
    const first = await post(validBody, KEY);
    const second = await post(validBody, KEY);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(await expenseCount()).toBe(1);
  });

  it('повтор не запускает синхронизацию заново', async () => {
    await post(validBody, KEY);
    const cycles = t.sync.cycles;

    await post(validBody, KEY);

    expect(t.sync.cycles).toBe(cycles);
  });

  it('повтор отражает актуальное состояние Excel', async () => {
    t.sync.excelAvailable = false;
    await post(validBody, KEY);

    t.sync.excelAvailable = true;
    await t.sync.requestCycle();
    const replay = await post(validBody, KEY);

    expect(replay.json().data.excelStatus).toBe('synced');
  });

  it('два одновременных запроса с одним ключом создают один расход', async () => {
    const [a, b] = await Promise.all([post(validBody, KEY), post(validBody, KEY)]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await expenseCount()).toBe(1);
  });

  it('один и тот же расход с разными ключами — это два расхода', async () => {
    await post(validBody);
    await post(validBody);

    expect(await expenseCount()).toBe(2);
  });

  it('без заголовка возвращает 400 и ничего не пишет', async () => {
    const response = await post(validBody, null);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await expenseCount()).toBe(0);
  });

  it('отклоняет ключ в неверном формате', async () => {
    const response = await post(validBody, 'коротко');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('тот же ключ с другими данными — 422', async () => {
    await post(validBody, KEY);

    const response = await post({ ...validBody, amount: 1 }, KEY);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('невалидные данные не расходуют ключ', async () => {
    await post({ ...validBody, amount: 0 }, KEY);

    expect((await post(validBody, KEY)).statusCode).toBe(201);
  });
});

describe('синхронизация', () => {
  it('GET /api/sync/status возвращает очередь, последний результат и время сервера', async () => {
    t.sync.excelAvailable = false;
    await post(validBody);

    const response = await t.inject({ method: 'GET', url: '/api/sync/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      queued: 1,
      running: false,
      intervalMs: 300_000,
      nextRunAt: null,
      lastResult: { status: 'locked' },
    });
    expect(new Date(response.json().data.serverTime).getTime()).not.toBeNaN();
  });

  it('POST /api/sync запускает синхронизацию и возвращает состояние', async () => {
    t.sync.excelAvailable = false;
    await post(validBody);
    t.sync.excelAvailable = true;

    const response = await t.inject({ method: 'POST', url: '/api/sync' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      queued: 0,
      lastResult: { status: 'ok', written: 1 },
    });
  });
});

describe('логирование', () => {
  it('в каждом ответе есть X-Request-Id', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/health' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('справочники и health', () => {
  it('GET /api/cards', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/cards' });

    expect(response.json()).toEqual({ success: true, data: ['Миша', 'Настя'] });
  });

  it('GET /api/categories объединяет конфигурацию и БД', async () => {
    await t.repository.importFromExcel(database, [{ ...validBody, category: 'путешествия' }]);

    const response = await t.inject({ method: 'GET', url: '/api/categories' });

    expect(response.json()).toEqual({ success: true, data: ['кафе', 'продукты', 'путешествия'] });
  });

  it('GET /api/name-suggestions отдаёт наименования от самых частых, только для вошедших', async () => {
    await t.repository.importFromExcel(database, [
      { ...validBody, name: 'Хлеб', category: 'продукты' },
      { ...validBody, name: 'Латте', category: 'кафе' },
      { ...validBody, name: 'Латте', category: 'кафе' },
    ]);

    const response = await t.inject({ method: 'GET', url: '/api/name-suggestions' });

    expect(response.json()).toEqual({
      success: true,
      data: [
        { name: 'Латте', category: 'кафе', count: 2 },
        { name: 'Хлеб', category: 'продукты', count: 1 },
      ],
    });
    expect((await t.app.inject({ method: 'GET', url: '/api/name-suggestions' })).statusCode).toBe(
      401,
    );
  });

  it('GET /api/config возвращает валюту', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/config' });

    expect(response.json()).toEqual({ success: true, data: { currency: 'AMD' } });
  });

  it('GET /api/health не обращается к Excel', async () => {
    const response = await t.inject({ method: 'GET', url: '/api/health' });

    expect(response.json()).toEqual({ status: 'ok' });
    expect(t.sync.cycles).toBe(0);
  });
});

describe('запросы без тела', () => {
  it('POST /api/sync с Content-Type: application/json и пустым телом работает', async () => {
    const response = await t.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
  });

  it('битый JSON по-прежнему даёт 400', async () => {
    const response = await t.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('BAD_REQUEST');
  });
});

describe('подтверждение удалений через POST /api/sync', () => {
  const sync = (payload?: unknown) =>
    t.inject({
      method: 'POST',
      url: '/api/sync',
      headers: { 'content-type': 'application/json' },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  it('applyDeletions: true передаётся в синхронизацию', async () => {
    const response = await sync({ applyDeletions: true });

    expect(response.statusCode).toBe(200);
    expect(t.sync.lastOptions?.applyDeletions).toBe(true);
  });

  it('без тела удаления не подтверждаются', async () => {
    await sync();

    expect(t.sync.lastOptions?.applyDeletions).toBeFalsy();
  });

  it('некорректное значение игнорируется как «не подтверждено»', async () => {
    const response = await sync({ applyDeletions: 'yes' });

    expect(response.statusCode).toBe(200);
    expect(t.sync.lastOptions?.applyDeletions).toBeFalsy();
  });
});
