import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Expenses from bank push notifications: keys of a group, the import endpoint, duplicates, errors. */
let database: Database;
let t: TestApp;

const TITLE = 'IDBank: GNUM';
const BODY =
  '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40';

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);

/** The request of iOS Shortcuts: a key in a header, no cookies, no Origin. */
const send = (key: string | undefined, payload: unknown, extra: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/transactions/import',
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra },
    payload: payload as object,
  });
const notification = (body = BODY, title = TITLE, source = 'idbank') => ({ source, title, body });

const createKey = async (as = 'misha', name = 'iPhone — IDBank') => {
  const response = await call('POST', '/api/group/api-keys', as, { name });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; key: string };
};
const cardId = async (name: string) =>
  (await database.query<{ id: string }>('SELECT id FROM cards WHERE name = $1', [name]))[0]!.id;
const setLast4 = async (card: string, last4: string | null) => {
  const response = await call('PATCH', `/api/group/cards/${await cardId(card)}`, 'misha', {
    last4,
  });
  expect(response.statusCode).toBe(200);
};
const expenses = () =>
  database.query<{
    name: string;
    amount: number;
    card: string;
    category: string;
    date: string;
    created_by: string;
  }>(
    'SELECT name, amount, card, category, date::text AS date, created_by FROM expenses WHERE deleted_at IS NULL',
  );

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM bank_imports; DELETE FROM api_keys; DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  await setLast4('Миша', '5386');
});

describe('ключи группы', () => {
  it('ключ показывается один раз, в списке только название, начало, даты и статус', async () => {
    const { id, key } = await createKey();

    const list = (await call('GET', '/api/group/api-keys', 'misha')).json().data;

    expect(key).toMatch(/^etk_[\w-]{43}$/);
    expect(list).toEqual([
      expect.objectContaining({
        id,
        name: 'iPhone — IDBank',
        prefix: key.slice(0, 10),
        revokedAt: null,
      }),
    ]);
    expect(JSON.stringify(list)).not.toContain(key);
    expect(JSON.stringify(await database.query('SELECT * FROM api_keys'))).not.toContain(key);
  });

  it('создают и отзывают только владельцы; название обязательно', async () => {
    expect((await call('POST', '/api/group/api-keys', 'nastya', { name: 'x' })).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/api/group/api-keys', 'nastya')).statusCode).toBe(403);
    expect((await call('POST', '/api/group/api-keys', 'misha', { name: '  ' })).statusCode).toBe(
      422,
    );
    const { id } = await createKey();

    expect((await call('DELETE', `/api/group/api-keys/${id}`, 'nastya')).statusCode).toBe(403);
    expect((await call('DELETE', `/api/group/api-keys/${id}`, 'misha')).statusCode).toBe(200);
    expect((await call('GET', '/api/group/api-keys', 'misha')).json().data[0].revokedAt).toEqual(
      expect.any(String),
    );
  });

  it('несколько ключей в одной группе', async () => {
    await createKey('misha', 'iPhone — IDBank');
    await createKey('misha', 'iPhone — Т-Банк');

    expect((await call('GET', '/api/group/api-keys', 'misha')).json().data).toHaveLength(2);
  });
});

describe('импорт уведомления IDBank', () => {
  it('создаёт расход обычным путём: карта по последним цифрам, дата и продавец с чека', async () => {
    const { key } = await createKey();

    const response = await send(key, notification());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      success: true,
      status: 'created',
      transactionId: expect.any(String),
    });
    expect(await expenses()).toEqual([
      {
        name: 'URARTU ZAQYAN',
        amount: 1540,
        card: 'Миша',
        category: 'кафе',
        date: '2026-10-16',
        created_by: 'misha',
      },
    ]);
  });

  it('расход из банка помечен в списке операций, введённый вручную нет', async () => {
    const { key } = await createKey();
    await send(key, notification());
    await database.query(
      "INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by, group_id) SELECT gen_random_uuid(), '2026-10-16', 'Миша', 'кафе', 'Вручную', 5, 'app', 'pending', 'misha', id FROM groups",
    );

    const items = (await call('GET', '/api/expenses', 'misha')).json().data.items as {
      name: string;
      fromBank: boolean;
      importKeyName: string | null;
    }[];

    expect(items.find((item) => item.name === 'URARTU ZAQYAN')).toMatchObject({
      fromBank: true,
      importKeyName: 'iPhone — IDBank',
      importSource: 'idbank',
    });
    expect(items.find((item) => item.name === 'Вручную')?.fromBank).toBe(false);
  });

  it('повторная отправка того же уведомления: успех без второго расхода', async () => {
    const { key } = await createKey();
    const first = (await send(key, notification())).json();

    const again = await send(key, notification());

    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      success: true,
      status: 'duplicate',
      transactionId: first.transactionId,
    });
    expect(await expenses()).toHaveLength(1);
  });

  it('две настоящие покупки на ту же сумму у того же продавца в разное время не дубликаты', async () => {
    const { key } = await createKey();

    await send(key, notification());
    const second = await send(key, notification(BODY.replace('20:40', '21:15')));

    expect(second.json().status).toBe('created');
    expect(await expenses()).toHaveLength(2);
  });

  it('категория: прежняя у этого продавца, иначе «другое» или первая категория группы', async () => {
    const { key } = await createKey();
    await database.query(
      "INSERT INTO categories (group_id, name, position) SELECT id, 'другое', 9 FROM groups",
    );

    await send(key, notification());
    expect((await expenses())[0]!.category).toBe('другое');

    await database.query(
      "INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by, group_id) SELECT gen_random_uuid(), '2026-10-02', 'Миша', 'продукты', 'NEW SHOP', 5, 'app', 'pending', 'misha', id FROM groups",
    );
    await send(
      key,
      notification('700.00 AMD\nVISA **5386 - M: 1.00 AMD\nNEW SHOP, AM 17.10.2026 10:00'),
    );
    const imported = (await expenses()).find((row) => row.amount === 700);
    expect(imported?.category).toBe('продукты');
  });

  it('категория по похожему названию: «Urartu» и «URARTU ZAQYAN» один магазин', async () => {
    const { key } = await createKey();
    await database.query(
      "INSERT INTO categories (group_id, name, position) SELECT id, 'бытовые расходы', 9 FROM groups",
    );
    await database.query(
      "INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by, group_id) SELECT gen_random_uuid(), '2026-10-02', 'Миша', 'бытовые расходы', 'Urartu', 400, 'app', 'pending', 'misha', id FROM groups",
    );

    await send(key, notification());

    expect((await expenses()).find((row) => row.name === 'URARTU ZAQYAN')?.category).toBe(
      'бытовые расходы',
    );
  });

  it('другая валюта сохраняется в своей валюте', async () => {
    const { key } = await createKey();

    const response = await send(
      key,
      notification('12.50 USD\nVISA **5386 - M: 1.00 AMD\nSHOP, US 17.10.2026 10:00'),
    );

    expect(response.statusCode).toBe(201);
    const rows = await database.query<{ original_currency: string | null }>(
      'SELECT original_currency FROM expenses WHERE amount IS NOT NULL ORDER BY created_at DESC LIMIT 1',
    );
    expect(rows[0]!.original_currency).toBe('USD');
  });
});

describe('категория по умолчанию у ключа', () => {
  it('задаётся при создании и меняется; применяется, когда по продавцу ничего не известно', async () => {
    const created = await call('POST', '/api/group/api-keys', 'misha', {
      name: 'iPhone',
      defaultCategory: 'продукты',
    });
    const { id, key } = created.json().data;

    expect((await call('GET', '/api/group/api-keys', 'misha')).json().data[0].defaultCategory).toBe(
      'продукты',
    );
    await send(key, notification());
    expect((await expenses())[0]!.category).toBe('продукты');

    expect(
      (await call('PATCH', `/api/group/api-keys/${id}`, 'misha', { defaultCategory: 'кафе' }))
        .statusCode,
    ).toBe(200);
    await send(
      key,
      notification(BODY.replace('20:40', '21:00').replace('URARTU ZAQYAN', 'ANOTHER PLACE')),
    );
    expect((await expenses()).map((row) => row.category).sort()).toEqual(['кафе', 'продукты']);

    await call('PATCH', `/api/group/api-keys/${id}`, 'misha', { defaultCategory: null });
    expect((await call('GET', '/api/group/api-keys', 'misha')).json().data[0].defaultCategory).toBe(
      null,
    );
  });

  it('прежняя категория продавца важнее категории ключа', async () => {
    const { key } = (
      await call('POST', '/api/group/api-keys', 'misha', { name: 'k', defaultCategory: 'продукты' })
    ).json().data;
    await database.query(
      "INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by, group_id) SELECT gen_random_uuid(), '2026-10-02', 'Миша', 'кафе', 'Urartu', 400, 'app', 'pending', 'misha', id FROM groups",
    );

    await send(key, notification());

    expect((await expenses()).find((row) => row.name === 'URARTU ZAQYAN')?.category).toBe('кафе');
  });

  it('неизвестная категория отвергается, менять может только владелец', async () => {
    expect(
      (
        await call('POST', '/api/group/api-keys', 'misha', {
          name: 'k',
          defaultCategory: 'нет такой',
        })
      ).statusCode,
    ).toBe(422);
    const { id } = await createKey();

    expect(
      (await call('PATCH', `/api/group/api-keys/${id}`, 'nastya', { defaultCategory: 'кафе' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/group/api-keys/${id}`, 'misha', { defaultCategory: 'нет такой' }))
        .statusCode,
    ).toBe(422);
  });
});

describe('ключ и права', () => {
  it('без ключа, с чужим ключом и с отозванным: 401, расход не создаётся', async () => {
    const { id, key } = await createKey();

    expect((await send(undefined, notification())).statusCode).toBe(401);
    expect((await send('etk_wrong', notification())).statusCode).toBe(401);
    expect((await send(`${key}x`, notification())).statusCode).toBe(401);
    await call('DELETE', `/api/group/api-keys/${id}`, 'misha');
    const revoked = await send(key, notification());

    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({ success: false, status: 'unauthorized' });
    expect(await expenses()).toHaveLength(0);
  });

  it('ключ годится только для импорта: другие маршруты по нему недоступны', async () => {
    const { key } = await createKey();
    const headers = { authorization: `Bearer ${key}` };

    for (const url of ['/api/expenses', '/api/group', '/api/group/api-keys', '/api/templates']) {
      expect((await t.app.inject({ method: 'GET', url, headers })).statusCode).toBe(401);
    }
  });

  it('последнее использование обновляется', async () => {
    const { key } = await createKey();

    await send(key, notification());

    expect((await call('GET', '/api/group/api-keys', 'misha')).json().data[0].lastUsedAt).toEqual(
      expect.any(String),
    );
  });

  it('ключ группы не пишет в чужую группу: расход всегда в группе ключа', async () => {
    const { key } = await createKey();

    await send(key, notification());

    const rows = await database.query<{ same: boolean }>(
      `SELECT e.group_id = k.group_id AS same FROM expenses e, api_keys k`,
    );
    expect(rows.every((row) => row.same)).toBe(true);
  });

  it('частота запросов ограничена: по ключу и по адресу при неверных ключах', async () => {
    t = await createTestApp(database, { importLimits: { perKey: 2, badKeysPerAddress: 2 } });
    await setLast4('Миша', '5386');
    const { key } = await createKey();

    const statuses = [];
    for (let index = 0; index < 4; index += 1) {
      statuses.push((await send(key, notification('x'))).statusCode);
    }
    expect(statuses).toEqual([422, 422, 429, 429]);

    const bad = [];
    for (let index = 0; index < 4; index += 1) bad.push((await send('etk_bad', {})).statusCode);
    expect(bad).toEqual([401, 401, 429, 429]);
  });
});

describe('что не создаёт расход', () => {
  it('неизвестный банк: 400', async () => {
    const { key } = await createKey();

    const response = await send(key, notification(BODY, TITLE, 'unknown-bank'));

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('unknown_source');
  });

  it('другой вид уведомления и нечитаемый текст: 422, ничего не создаётся, попытка записана', async () => {
    const { key } = await createKey();

    const other = await send(key, notification(BODY, 'IDBank: MTUM'));
    const broken = await send(key, notification('что-то непонятное'));

    expect(other.statusCode).toBe(422);
    expect(other.json()).toMatchObject({ success: false, status: 'unsupported' });
    expect(broken.statusCode).toBe(422);
    expect(broken.json()).toMatchObject({ success: false, status: 'parse_error' });
    expect(await expenses()).toHaveLength(0);
    const history = (await call('GET', '/api/group/imports', 'misha')).json().data;
    expect(history.map((row: { status: string }) => row.status).sort()).toEqual([
      'parse_error',
      'unsupported',
    ]);
  });

  it('карты с такими цифрами нет: карту не выбирают наугад', async () => {
    await setLast4('Миша', null);
    const { key } = await createKey();

    const response = await send(key, notification());

    expect(response.statusCode).toBe(422);
    expect(response.json().status).toBe('card_not_found');
    expect(await expenses()).toHaveLength(0);
  });

  it('несколько карт с такими цифрами: неоднозначно, расход не создаётся', async () => {
    await setLast4('Настя', '5386');
    const { key } = await createKey();

    const response = await send(key, notification());

    expect(response.statusCode).toBe(422);
    expect(response.json().status).toBe('card_ambiguous');
    expect(await expenses()).toHaveLength(0);
  });

  it('карта, на которую у автора ключа нет права добавлять, не подходит', async () => {
    const { key } = await createKey('misha');
    await database.query(
      "UPDATE memberships SET role = 'member' WHERE user_id = (SELECT id FROM users WHERE username = 'misha')",
    );
    await database.query(
      "DELETE FROM card_access WHERE user_id = (SELECT id FROM users WHERE username = 'misha')",
    );

    const response = await send(key, notification());

    expect(response.statusCode).toBe(422);
    expect(response.json().status).toBe('card_not_found');
  });

  it('валюта, которой нет в приложении: ошибка, без расхода', async () => {
    const { key } = await createKey();

    const response = await send(
      key,
      notification('100.00 JPY\nVISA **5386 - M: 1.00 AMD\nSHOP, JP 17.10.2026 10:00'),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().status).toBe('error');
    expect(await expenses()).toHaveLength(0);
  });

  it('пустое или слишком длинное тело запроса отвергается', async () => {
    const { key } = await createKey();

    expect((await send(key, { source: 'idbank', title: TITLE, body: '' })).statusCode).toBe(400);
    expect(
      (await send(key, { source: 'idbank', title: TITLE, body: 'x'.repeat(5000) })).statusCode,
    ).toBe(400);
    expect((await send(key, { title: TITLE })).statusCode).toBe(400);
  });
});

describe('последние цифры карты', () => {
  it('сохраняются, читаются в настройках группы и проверяются', async () => {
    const group = (await call('GET', '/api/group', 'misha')).json().data;
    expect(group.cards.find((card: { name: string }) => card.name === 'Миша').last4).toBe('5386');

    const bad = await call('PATCH', `/api/group/cards/${await cardId('Миша')}`, 'misha', {
      last4: '12a4',
    });
    expect(bad.statusCode).toBe(422);
    await setLast4('Миша', null);
    expect(
      (await call('GET', '/api/group', 'misha'))
        .json()
        .data.cards.find((card: { name: string }) => card.name === 'Миша').last4,
    ).toBeNull();
  });
});
