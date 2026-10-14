import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Items of an expense and receipt parsing by the AI (v4). The model is replaced by the fake provider. */
let database: Database;
let t: TestApp;

const NOW = new Date('2026-10-15T09:00:00Z');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const API_KEY = 'AIza-secret-test-key-9876';

const RECEIPT = {
  name: 'Carrefour',
  date: '2026-10-12',
  total: 1500,
  currency: 'AMD',
  items: [
    { name: 'Молоко', price: 450.5, quantity: 1 },
    { name: 'Сыр', price: 1049.5, quantity: 0.35 },
  ],
};

const call = (method: string, url: string, payload?: unknown, as = 'misha') =>
  t.inject({ method: method as 'GET', url, payload: payload as object }, as);

const dataOf = async (response: Promise<{ json: () => any }>) => (await response).json().data;

/** The administrator turns the AI on and gives a key, the owner turns it on for the group, the category takes photos. */
const enableAi = async () => {
  await call('PUT', '/api/admin/ai', { enabled: true });
  await call('PUT', '/api/admin/ai/key', { apiKey: API_KEY });
  await call('PUT', '/api/group/ai', { enabled: true });
  await call('PUT', '/api/group/receipts', { enabled: true, categories: ['кафе'] });
};

const addExpense = async (extra: Record<string, unknown> = {}) => {
  const response = await t.inject({
    method: 'POST',
    url: '/api/expenses',
    headers: { 'idempotency-key': `key-${Math.random().toString(36).slice(2)}-xx` },
    payload: {
      date: '2026-10-15',
      card: 'Миша',
      category: 'кафе',
      name: 'Чек',
      amount: 1500,
      nameSource: 'default',
      dateSource: 'default',
      ...extra,
    },
  });
  return response.json().data.id as string;
};

const withPhoto = async (extra: Record<string, unknown> = {}) => {
  const id = await addExpense(extra);
  const response = await t.inject({
    method: 'PUT',
    url: `/api/expenses/${id}/receipt`,
    headers: { 'content-type': 'image/jpeg' },
    payload: JPEG,
  });
  expect(response.statusCode).toBe(200);
  return id;
};

const parse = (id: string, body?: unknown, as = 'misha') =>
  call('POST', `/api/expenses/${id}/receipt/parse`, body, as);

const expenseRow = async (id: string) =>
  (
    await database.query<any>(
      `SELECT name, name_source, date::text AS date, date_source, ai_processed_at, ai_model
         FROM expenses WHERE id = $1`,
      [id],
    )
  )[0];

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    `DELETE FROM ai_usage; DELETE FROM expense_items; DELETE FROM expense_attachments; DELETE FROM expenses;
     DELETE FROM app_settings; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships;
     DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users`,
  );
  t = await createTestApp(database, {
    now: () => NOW,
    receiptsDir: mkdtempSync(path.join(tmpdir(), 'ai-receipts-')),
  });
  t.llmProvider.answers = [RECEIPT];
});

describe('включение и ключ', () => {
  it('по умолчанию выключено у всех', async () => {
    expect(await dataOf(call('GET', '/api/ai/status'))).toEqual({
      installationReady: false,
      groupEnabled: false,
      available: false,
      dailyLimit: 30,
      usedToday: 0,
      languages: ['en', 'ru'],
    });
  });

  it('в статусе виден лимит группы и сколько уже разобрано', async () => {
    await enableAi();
    await call('PUT', '/api/admin/ai', { dailyLimit: 7 });
    await parse(await withPhoto());

    expect(await dataOf(call('GET', '/api/ai/status'))).toMatchObject({
      dailyLimit: 7,
      usedToday: 1,
    });

    const [group] = await database.query<{ id: string }>('SELECT id FROM groups');
    await call('PUT', `/api/admin/groups/${group!.id}/ai-limit`, { limit: 3 });
    expect((await dataOf(call('GET', '/api/ai/status'))).dailyLimit).toBe(3);
  });

  it('настройки и ключ видит только администратор', async () => {
    for (const request of [
      call('GET', '/api/admin/ai', undefined, 'nastya'),
      call('PUT', '/api/admin/ai', { enabled: true }, 'nastya'),
      call('PUT', '/api/admin/ai/key', { apiKey: API_KEY }, 'nastya'),
      call('POST', '/api/admin/ai/test', undefined, 'nastya'),
    ]) {
      expect((await request).statusCode).toBe(403);
    }
  });

  it('ключ сохраняется зашифрованным и ни в одном ответе не возвращается', async () => {
    await call('PUT', '/api/admin/ai/key', { apiKey: API_KEY });

    const view = await call('GET', '/api/admin/ai');
    const stored = await database.query<{ value: string }>(
      "SELECT value::text AS value FROM app_settings WHERE key = 'llm.api_key'",
    );

    expect(view.body).not.toContain(API_KEY);
    expect(view.json().data).toMatchObject({
      keyConfigured: true,
      keyHint: '9876',
      keySource: 'app',
    });
    expect(stored[0]!.value).not.toContain(API_KEY);
  });

  it('ключ можно удалить', async () => {
    await call('PUT', '/api/admin/ai/key', { apiKey: API_KEY });
    await call('DELETE', '/api/admin/ai/key');

    expect((await dataOf(call('GET', '/api/admin/ai'))).keyConfigured).toBe(false);
  });

  it('группу включает только владелец, а доступно всё только при обоих переключателях и ключе', async () => {
    await call('PUT', '/api/admin/ai', { enabled: true });
    expect((await call('PUT', '/api/group/ai', { enabled: true }, 'nastya')).statusCode).toBe(403);

    await call('PUT', '/api/group/ai', { enabled: true });
    expect((await dataOf(call('GET', '/api/ai/status'))).available).toBe(false);

    await call('PUT', '/api/admin/ai/key', { apiKey: API_KEY });
    expect((await dataOf(call('GET', '/api/ai/status'))).available).toBe(true);
  });

  it('проверка ключа спрашивает провайдера с сохранённым ключом и моделью', async () => {
    await call('PUT', '/api/admin/ai/key', { apiKey: API_KEY });
    await call('PUT', '/api/admin/ai', { model: 'gemini-3.8-flash' });

    const response = await call('POST', '/api/admin/ai/test');

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ model: 'gemini-3.8-flash' });
    expect(response.json().data.message).toContain('gemini-3.8-flash');
    expect(t.llmProvider.checks).toEqual([{ apiKey: API_KEY, model: 'gemini-3.8-flash' }]);
    expect(response.body).not.toContain(API_KEY);
  });

  it('лимит и модель проверяются', async () => {
    expect((await call('PUT', '/api/admin/ai', { dailyLimit: -1 })).statusCode).toBe(422);
    expect((await call('PUT', '/api/admin/ai', { model: 'a b' })).statusCode).toBe(422);
  });
});

describe('позиции', () => {
  it('траты можно создавать с позициями, в том числе с дробными ценами в драмах', async () => {
    const id = await addExpense({ items: [{ name: 'Хлеб', price: 12.5, quantity: 2 }] });

    const items = await dataOf(call('GET', `/api/expenses/${id}/items`));

    expect(items).toMatchObject([{ name: 'Хлеб', price: 12.5, quantity: 2, source: 'manual' }]);
  });

  it('список заменяется целиком, пустой список убирает позиции', async () => {
    const id = await addExpense({ items: [{ name: 'Хлеб', price: 10, quantity: 1 }] });

    await call('PUT', `/api/expenses/${id}/items`, { items: [{ name: 'Сыр', price: 20 }] });
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toMatchObject([
      { name: 'Сыр', price: 20, quantity: 1 },
    ]);

    await call('PUT', `/api/expenses/${id}/items`, { items: [] });
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toEqual([]);
  });

  it.each([
    [{ items: [{ name: '', price: 1 }] }],
    [{ items: [{ name: 'a', price: -1 }] }],
    [{ items: [{ name: 'a', price: 1.234 }] }],
    [{ items: [{ name: 'a', price: 1, quantity: 0 }] }],
    [{ items: Array.from({ length: 101 }, () => ({ name: 'a', price: 1 })) }],
  ])('некорректные позиции отклоняются %#', async (body) => {
    const id = await addExpense();

    expect((await call('PUT', `/api/expenses/${id}/items`, body)).statusCode).toBe(422);
  });

  it('участник видит позиции трат своих карт, но чужую трату не правит', async () => {
    const id = await addExpense({ items: [{ name: 'Хлеб', price: 10 }] });

    expect((await call('GET', `/api/expenses/${id}/items`, undefined, 'nastya')).statusCode).toBe(
      200,
    );
    expect(
      (await call('PUT', `/api/expenses/${id}/items`, { items: [] }, 'nastya')).statusCode,
    ).toBe(403);
  });

  it('изменение позиций пишется в журнал', async () => {
    const id = await addExpense();
    await call('PUT', `/api/expenses/${id}/items`, { items: [{ name: 'Сыр', price: 20 }] });

    const log = await database.query<{ after: { items: unknown[] } }>(
      'SELECT after FROM expense_changes WHERE expense_id = $1',
      [id],
    );

    expect(log[0]!.after.items).toHaveLength(1);
  });
});

describe('разбор чека', () => {
  beforeEach(enableAi);

  it('заполняет название, дату и позиции, помечает всё как созданное ИИ и записывает это в базу', async () => {
    const id = await withPhoto();

    const response = await parse(id);

    expect(response.json().data).toMatchObject({
      nameFilled: true,
      dateFilled: true,
      itemsFilled: 2,
      total: 1500,
    });
    expect(await expenseRow(id)).toMatchObject({
      name: 'Carrefour',
      name_source: 'ai',
      date: '2026-10-12',
      date_source: 'ai',
      ai_model: 'test-model',
    });
    expect((await expenseRow(id)).ai_processed_at).not.toBeNull();
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toMatchObject([
      { name: 'Молоко', price: 450.5, source: 'ai' },
      { name: 'Сыр', price: 1049.5, quantity: 0.35, source: 'ai' },
    ]);
  });

  it('сумма, карта и категория остаются как были', async () => {
    const id = await withPhoto();
    await parse(id);

    const [row] = await database.query<any>(
      'SELECT amount, card_amount::float8 AS card_amount, category FROM expenses WHERE id = $1',
      [id],
    );

    expect(row).toMatchObject({ amount: 1500, card_amount: 1500, category: 'кафе' });
  });

  it('название и дату, введённые вручную, не трогает', async () => {
    const id = await withPhoto({
      name: 'Свой чек',
      nameSource: 'manual',
      date: '2026-10-01',
      dateSource: 'manual',
    });

    const response = await parse(id);

    expect(response.json().data).toMatchObject({
      nameFilled: false,
      dateFilled: false,
      itemsFilled: 2,
    });
    expect(await expenseRow(id)).toMatchObject({
      name: 'Свой чек',
      name_source: 'manual',
      date: '2026-10-01',
      date_source: 'manual',
    });
  });

  it('дату из будущего или слишком старую считает ошибкой распознавания и не применяет', async () => {
    for (const date of ['2026-12-31', '2024-01-01', '2026-02-30']) {
      t.llmProvider.answers = [{ ...RECEIPT, date }];
      const id = await withPhoto();

      const response = await parse(id);

      expect(response.json().data.dateFilled).toBe(false);
      expect((await expenseRow(id)).date).toBe('2026-10-15');
    }
  });

  it('свои позиции не заменяет, а предлагает; по просьбе заменяет', async () => {
    const id = await withPhoto({ items: [{ name: 'Моя позиция', price: 5 }] });

    const first = await parse(id);
    expect(first.json().data).toMatchObject({ itemsFilled: 0, itemsOffered: true });
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toMatchObject([
      { name: 'Моя позиция', source: 'manual' },
    ]);

    const second = await parse(id, { replaceItems: true });
    expect(second.json().data.itemsFilled).toBe(2);
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toHaveLength(2);
  });

  it('повторный разбор заменяет прежние значения ИИ', async () => {
    const id = await withPhoto();
    await parse(id);
    t.llmProvider.answers = [{ ...RECEIPT, name: 'Другой', items: [{ name: 'Чай', price: 100 }] }];

    await parse(id);

    expect((await expenseRow(id)).name).toBe('Другой');
    expect(await dataOf(call('GET', `/api/expenses/${id}/items`))).toMatchObject([{ name: 'Чай' }]);
  });

  it('правка названия или даты человеком снимает пометку ИИ', async () => {
    const id = await withPhoto();
    await parse(id);

    await call('PATCH', `/api/expenses/${id}`, { name: 'Исправил' });

    expect(await expenseRow(id)).toMatchObject({
      name: 'Исправил',
      name_source: 'manual',
      date_source: 'ai',
    });
  });

  it('при сохранении позиций неизменённая ИИ-позиция остаётся помеченной, изменённая и новая становятся ручными', async () => {
    const id = await withPhoto();
    await parse(id);
    const [milk, cheese] = await dataOf(call('GET', `/api/expenses/${id}/items`));

    await call('PUT', `/api/expenses/${id}/items`, {
      items: [
        { id: milk.id, name: milk.name, price: milk.price, quantity: milk.quantity },
        { id: cheese.id, name: cheese.name, price: 999, quantity: cheese.quantity },
        { name: 'Хлеб', price: 10 },
      ],
    });

    expect(
      (await dataOf(call('GET', `/api/expenses/${id}/items`))).map((i: any) => i.source),
    ).toEqual(['ai', 'manual', 'manual']);
  });

  it('метка источника не берётся из запроса: подделать «ИИ» нельзя', async () => {
    const id = await addExpense();

    await call('PUT', `/api/expenses/${id}/items`, {
      items: [{ name: 'Хлеб', price: 10, source: 'ai' }],
    });

    expect((await dataOf(call('GET', `/api/expenses/${id}/items`)))[0].source).toBe('manual');
  });

  it('«принять» снимает пометки, значения остаются; отметка об обработке ИИ в базе остаётся', async () => {
    const id = await withPhoto();
    await parse(id);

    expect((await call('DELETE', `/api/expenses/${id}/ai`)).statusCode).toBe(200);

    expect(await expenseRow(id)).toMatchObject({
      name: 'Carrefour',
      name_source: 'manual',
      date_source: 'manual',
    });
    expect((await expenseRow(id)).ai_processed_at).not.toBeNull();
    expect(
      (await dataOf(call('GET', `/api/expenses/${id}/items`))).every(
        (i: any) => i.source === 'manual',
      ),
    ).toBe(true);
  });

  it('список операций отдаёт число позиций, источники и отметку обработки', async () => {
    const id = await withPhoto();
    await parse(id);

    const list = await dataOf(call('GET', '/api/expenses?from=2026-10-01&to=2026-10-31'));
    const item = list.items.find((entry: any) => entry.id === id);

    expect(item).toMatchObject({
      itemsCount: 2,
      aiItemsCount: 2,
      nameSource: 'ai',
      dateSource: 'ai',
      aiProcessed: true,
    });
  });

  it('в журнал попадает запись от имени ИИ', async () => {
    const id = await withPhoto();
    await parse(id);

    const log = await database.query<{ changed_by: string }>(
      'SELECT changed_by FROM expense_changes WHERE expense_id = $1',
      [id],
    );

    expect(log.map((row) => row.changed_by)).toContain('ai');
  });
});

describe('когда разбор невозможен', () => {
  it('выключено администратором или группой: 409 и в модель ничего не уходит', async () => {
    await enableAi();
    const id = await withPhoto();

    await call('PUT', '/api/group/ai', { enabled: false });
    const off = await parse(id);

    expect(off.statusCode).toBe(409);
    expect(off.json().error.code).toBe('AI_DISABLED');
    expect(t.llmProvider.calls).toHaveLength(0);
  });

  it('нет ключа: понятная ошибка', async () => {
    await enableAi();
    const id = await withPhoto();
    await call('DELETE', '/api/admin/ai/key');

    expect((await parse(id)).json().error.code).toBe('AI_KEY_MISSING');
  });

  it('нет фото: 409', async () => {
    await enableAi();
    const id = await addExpense();

    expect((await parse(id)).json().error.code).toBe('RECEIPT_MISSING');
  });

  it('мусорный ответ модели: ошибка, данные не меняются, попытка записана', async () => {
    await enableAi();
    const id = await withPhoto();
    t.llmProvider.answers = [{ items: 'не список' }];

    const response = await parse(id);

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_BAD_RESPONSE');
    expect(await expenseRow(id)).toMatchObject({ name: 'Чек', ai_processed_at: null });
    const usage = await database.query<{ status: string }>('SELECT status FROM ai_usage');
    expect(usage).toEqual([{ status: 'error' }]);
  });

  it('битые строки отбрасываются, остальные применяются', async () => {
    await enableAi();
    const id = await withPhoto();
    t.llmProvider.answers = [
      {
        ...RECEIPT,
        items: [
          { name: 'Хлеб', price: 10 },
          { name: '', price: 5 },
          { name: 'Минус', price: -3 },
          'мусор',
        ],
      },
    ];

    const response = await parse(id);

    expect(response.json().data).toMatchObject({ itemsFilled: 1, dropped: 3 });
  });

  it('дневной лимит группы: следующий разбор отклоняется, у группы может быть свой лимит', async () => {
    await enableAi();
    await call('PUT', '/api/admin/ai', { dailyLimit: 1 });
    const first = await withPhoto();
    const second = await withPhoto();

    expect((await parse(first)).statusCode).toBe(200);
    const blocked = await parse(second);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('AI_LIMIT_REACHED');

    const [group] = await database.query<{ id: string }>('SELECT id FROM groups');
    await call('PUT', `/api/admin/groups/${group!.id}/ai-limit`, { limit: 5 });
    expect((await parse(second)).statusCode).toBe(200);
  });

  it('участник не запускает разбор чужой траты', async () => {
    await enableAi();
    const id = await withPhoto();

    expect((await parse(id, undefined, 'nastya')).statusCode).toBe(403);
  });

  it('в модель уходит только фото и инструкция, без данных пользователя', async () => {
    await enableAi();
    const id = await withPhoto();
    await parse(id);

    const { request, credentials } = t.llmProvider.calls[0]!;

    expect(request.image?.contentType).toBe('image/jpeg');
    expect(request.prompt).not.toContain('misha');
    expect(credentials).toEqual({ apiKey: API_KEY, model: 'test-model' });
  });
});

describe('разбор фото до сохранения траты', () => {
  beforeEach(enableAi);

  const draft = (body: Buffer = JPEG, as = 'misha', category = 'кафе') =>
    t.inject(
      {
        method: 'POST',
        url: `/api/ai/receipt/parse?category=${encodeURIComponent(category)}`,
        headers: { 'content-type': 'image/jpeg' },
        payload: body,
      },
      as,
    );

  it('возвращает название, дату, позиции и номер разбора, ничего не сохраняя', async () => {
    const response = await draft();

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      name: 'Carrefour',
      date: '2026-10-12',
      total: 1500,
      items: [{ name: 'Молоко', price: 450.5 }, { name: 'Сыр' }],
    });
    expect(response.json().data.parseId).toEqual(expect.any(String));
    expect(await database.query('SELECT 1 FROM expenses')).toHaveLength(0);
  });

  it('невозможную дату не отдаёт', async () => {
    t.llmProvider.answers = [{ ...RECEIPT, date: '2027-01-01' }];

    expect((await draft()).json().data.date).toBeNull();
  });

  it('не фотография: 422, выключено: 409', async () => {
    expect((await draft(Buffer.from('текст'))).statusCode).toBe(422);

    await call('PUT', '/api/group/ai', { enabled: false });
    expect((await draft()).statusCode).toBe(409);
  });

  it('сохранённая трата получает пометки только у тех значений, которые остались ответом модели', async () => {
    const { parseId } = (await draft()).json().data;

    const id = await addExpense({
      name: 'Carrefour',
      nameSource: 'manual',
      date: '2026-10-12',
      dateSource: 'manual',
      aiParseId: parseId,
      items: [
        { name: 'Молоко', price: 450.5, quantity: 1 },
        { name: 'Сыр', price: 1000, quantity: 0.35 },
        { name: 'Хлеб', price: 10 },
      ],
    });

    expect(await expenseRow(id)).toMatchObject({
      name_source: 'ai',
      date_source: 'ai',
      ai_model: 'test-model',
    });
    expect((await expenseRow(id)).ai_processed_at).not.toBeNull();
    expect(
      (await dataOf(call('GET', `/api/expenses/${id}/items`))).map((i: any) => i.source),
    ).toEqual(['ai', 'manual', 'manual']);
  });

  it('название, которое человек изменил, остаётся его, но трата всё равно отмечена как обработанная ИИ', async () => {
    const { parseId } = (await draft()).json().data;

    const id = await addExpense({ name: 'Моё название', nameSource: 'manual', aiParseId: parseId });

    expect(await expenseRow(id)).toMatchObject({ name: 'Моё название', name_source: 'manual' });
    expect((await expenseRow(id)).ai_processed_at).not.toBeNull();
  });

  it('разбор берётся один раз и только своим автором', async () => {
    const { parseId } = (await draft()).json().data;

    const first = await addExpense({ name: 'Carrefour', aiParseId: parseId });
    const second = await addExpense({ name: 'Carrefour', aiParseId: parseId });

    expect((await expenseRow(first)).name_source).toBe('ai');
    expect((await expenseRow(second)).name_source).toBe('default');
  });

  it('чужой номер разбора ничего не помечает', async () => {
    const { parseId } = (await draft()).json().data;
    const response = await t.inject(
      {
        method: 'POST',
        url: '/api/expenses',
        headers: { 'idempotency-key': 'key-another-user-1' },
        payload: {
          date: '2026-10-15',
          card: 'Настя',
          category: 'кафе',
          name: 'Carrefour',
          amount: 5,
          aiParseId: parseId,
        },
      },
      'nastya',
    );

    expect((await expenseRow(response.json().data.id)).name_source).toBe('manual');
  });

  it('попытка засчитывается в дневной лимит', async () => {
    await call('PUT', '/api/admin/ai', { dailyLimit: 1 });
    await draft();

    expect((await draft(Buffer.concat([JPEG, Buffer.from('другое фото')]))).statusCode).toBe(429);
  });

  describe('то же фото повторно (перезагрузка, приложение открыли снова)', () => {
    it('отдаёт сохранённый ответ: модель не спрашивают и лимит не тратят', async () => {
      await call('PUT', '/api/admin/ai', { dailyLimit: 1 });
      const first = (await draft()).json().data;

      const again = await draft();

      expect(again.statusCode).toBe(200);
      expect(again.json().data).toEqual(first);
      expect(t.llmProvider.calls).toHaveLength(1);
    });

    it('одновременные запросы с тем же фото делят один вызов модели', async () => {
      const [a, b] = await Promise.all([draft(), draft()]);

      expect(a.json().data.parseId).toBe(b.json().data.parseId);
      expect(t.llmProvider.calls).toHaveLength(1);
    });

    it('другое фото или другой пользователь читаются заново', async () => {
      await draft();
      await draft(Buffer.concat([JPEG, Buffer.from('другое фото')]));
      await draft(JPEG, 'nastya');

      expect(t.llmProvider.calls).toHaveLength(3);
    });

    it('разбор, который уже взяла трата, повторно не отдаётся: то же фото читается заново', async () => {
      const { parseId } = (await draft()).json().data;
      await addExpense({ name: 'Carrefour', aiParseId: parseId });

      const again = (await draft()).json().data;

      expect(again.parseId).not.toBe(parseId);
      expect(t.llmProvider.calls).toHaveLength(2);
    });

    it('после выключения ИИ сохранённый ответ не отдаётся', async () => {
      await draft();
      await call('PUT', '/api/group/ai', { enabled: false });

      expect((await draft()).statusCode).toBe(409);
    });
  });
});

describe('категории, где ИИ разрешён', () => {
  beforeEach(async () => {
    await enableAi();
    await call('PUT', '/api/group/receipts', {
      enabled: true,
      categories: ['кафе', 'продукты'],
      aiCategories: ['кафе'],
    });
  });

  it('настройка читается всеми и сохраняется владельцем; без поля остаётся как была', async () => {
    const settings = await dataOf(call('GET', '/api/receipts/settings', undefined, 'nastya'));
    expect(settings.aiCategories).toEqual(['кафе']);

    await call('PUT', '/api/group/receipts', { enabled: true, categories: ['кафе', 'продукты'] });

    expect((await dataOf(call('GET', '/api/receipts/settings'))).aiCategories).toEqual(['кафе']);
  });

  it('по умолчанию ИИ разрешён во всех категориях', async () => {
    await database.exec('UPDATE categories SET ai_allowed = true');

    const settings = await dataOf(call('GET', '/api/receipts/settings'));

    expect(settings.aiCategories).toEqual(expect.arrayContaining(['кафе', 'продукты']));
  });

  it('разбор до сохранения: в запрещённой категории 409 и в модель ничего не уходит', async () => {
    const response = await t.inject({
      method: 'POST',
      url: '/api/ai/receipt/parse?category=' + encodeURIComponent('продукты'),
      headers: { 'content-type': 'image/jpeg' },
      payload: JPEG,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AI_CATEGORY_OFF');
    expect(t.llmProvider.calls).toHaveLength(0);
  });

  it('разбор сохранённой траты в запрещённой категории тоже отклоняется, а фото прикрепить можно', async () => {
    const id = await withPhoto({ category: 'продукты' });

    const response = await parse(id);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AI_CATEGORY_OFF');
  });
});

describe('чек без выбранной категории: ИИ выбирает сам', () => {
  const noCategory = () =>
    t.inject({
      method: 'POST',
      url: '/api/ai/receipt/parse',
      headers: { 'content-type': 'image/jpeg' },
      payload: JPEG,
    });

  beforeEach(async () => {
    await enableAi();
    await call('PUT', '/api/group/receipts', {
      enabled: true,
      categories: ['кафе', 'продукты'],
      aiCategories: ['кафе', 'продукты'],
    });
  });

  it('модель выбирает одну из категорий, где разрешены и фото, и ИИ', async () => {
    await call('PUT', '/api/group/receipts', {
      enabled: true,
      categories: ['кафе', 'продукты'],
      aiCategories: ['продукты'],
    });
    t.llmProvider.answers = [{ ...RECEIPT, category: 'продукты' }];

    const response = await noCategory();

    expect(response.statusCode).toBe(200);
    expect(response.json().data.category).toBe('продукты');
    const { request } = t.llmProvider.calls[0]!;
    expect((request.schema as any).properties.category.enum).toEqual(['продукты']);
    expect(request.prompt).toContain('"продукты"');
  });

  it('название категории от модели принимается только точное из предложенных', async () => {
    t.llmProvider.answers = [{ ...RECEIPT, category: 'жилье' }];

    expect((await noCategory()).json().data.category).toBeNull();
  });

  it('когда категория выбрана, модель всё равно называет свою: это только подсказка', async () => {
    t.llmProvider.answers = [{ ...RECEIPT, category: 'продукты' }];

    const response = await draftWithCategory();

    expect(response.json().data.category).toBe('продукты');
    const { request } = t.llmProvider.calls[0]!;
    expect((request.schema as any).properties.category.enum).toEqual(['кафе', 'продукты']);
  });

  it('если подходящих категорий нет, а категория выбрана, разбор идёт без подсказки', async () => {
    await call('PUT', '/api/group/receipts', { enabled: true, categories: [], aiCategories: [] });

    const response = await draftWithCategory();

    expect(response.statusCode).toBe(409);
  });

  it('фото выключены или нет подходящих категорий: 409, в модель ничего не уходит', async () => {
    await call('PUT', '/api/group/receipts', { enabled: false, categories: ['кафе'] });

    const response = await noCategory();

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AI_CATEGORY_OFF');
    expect(t.llmProvider.calls).toHaveLength(0);
  });

  it('трата с категорией от ИИ сохраняется и фото к ней прикрепляется', async () => {
    t.llmProvider.answers = [{ ...RECEIPT, category: 'продукты' }];
    const { parseId, category } = (await noCategory()).json().data;

    const id = await withPhoto({ category, name: 'Carrefour', aiParseId: parseId });

    expect((await expenseRow(id)).ai_processed_at).not.toBeNull();
  });
});

const draftWithCategory = () =>
  t.inject({
    method: 'POST',
    url: `/api/ai/receipt/parse?category=${encodeURIComponent('кафе')}`,
    headers: { 'content-type': 'image/jpeg' },
    payload: JPEG,
  });

describe('языки названий', () => {
  beforeEach(enableAi);

  it('по умолчанию разрешены английский и русский; владелец меняет, участник нет', async () => {
    expect((await dataOf(call('GET', '/api/ai/status'))).languages).toEqual(['en', 'ru']);

    expect((await call('PUT', '/api/group/ai', { languages: ['ru'] }, 'nastya')).statusCode).toBe(
      403,
    );
    expect((await call('PUT', '/api/group/ai', { languages: ['ru'] })).statusCode).toBe(200);

    expect((await dataOf(call('GET', '/api/ai/status', undefined, 'nastya'))).languages).toEqual([
      'ru',
    ]);
    expect((await dataOf(call('GET', '/api/ai/status'))).groupEnabled).toBe(true);
  });

  it.each([[[]], [['de']], [{}], [['ru', 5]]])(
    'некорректный список языков отклоняется %#',
    async (languages) => {
      expect((await call('PUT', '/api/group/ai', { languages })).statusCode).toBe(422);
      expect((await dataOf(call('GET', '/api/ai/status'))).languages).toEqual(['en', 'ru']);
    },
  );

  it('повторы в списке убираются', async () => {
    await call('PUT', '/api/group/ai', { languages: ['ru', 'ru'] });

    expect((await dataOf(call('GET', '/api/ai/status'))).languages).toEqual(['ru']);
  });

  it('разбор чека просит язык, разрешённый группой', async () => {
    await call('PUT', '/api/group/ai', { languages: ['ru'] });
    const id = await withPhoto();

    await parse(id);

    expect(t.llmProvider.calls[0]!.request.prompt).toContain('Write ALL text values in Russian');
  });
});
