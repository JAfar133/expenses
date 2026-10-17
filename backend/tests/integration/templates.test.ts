import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Quick-action templates: personal and group ones, rights, hiding, order, and the card the expense goes to. */
let database: Database;
let t: TestApp;

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);

const body = (extra: Record<string, unknown> = {}) => ({
  scope: 'personal',
  name: 'Кофе',
  category: 'кафе',
  expenseName: 'Кофе',
  ...extra,
});
const create = async (as: string, extra: Record<string, unknown> = {}) => {
  const response = await call('POST', '/api/templates', as, body(extra));
  expect(response.statusCode).toBe(201);
  return response.json().data.id as string;
};
const list = async (as: string) =>
  (await call('GET', '/api/templates', as)).json().data as {
    id: string;
    name: string;
    scope: string;
    pending: boolean;
    effectiveCard: string | null;
    card: string | null;
    amount: number | null;
    currency: string | null;
    editable: boolean;
    author: string;
    updatedBy: string | null;
    updatedAt: string | null;
    hidden: boolean;
    unavailable: boolean;
  }[];

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
});

describe('личные шаблоны', () => {
  it('создаются, читаются и видны только автору', async () => {
    await create('misha', { amount: 1200, currency: 'AMD', emoji: '☕' });

    const mine = await list('misha');
    expect(mine).toMatchObject([
      { name: 'Кофе', scope: 'personal', amount: 1200, currency: 'AMD', editable: true },
    ]);
    expect(await list('nastya')).toEqual([]);
  });

  it('если карта по умолчанию не карта группы, карта шаблона не определена (null)', async () => {
    await create('nastya');
    await database.query("UPDATE users SET custom_card = 'Нет такой' WHERE username = 'nastya'");

    expect((await list('nastya'))[0]).toMatchObject({ card: null, effectiveCard: null });
  });

  it('без карты берётся карта пользователя по умолчанию', async () => {
    await create('misha');
    await create('nastya');

    expect((await list('misha'))[0]).toMatchObject({ card: null, effectiveCard: 'Миша' });
    expect((await list('nastya'))[0]).toMatchObject({ card: null, effectiveCard: 'Настя' });
  });

  it('валюта без суммы не сохраняется', async () => {
    await create('misha', { currency: 'USD' });

    expect((await list('misha'))[0]).toMatchObject({ amount: null, currency: null });
  });

  it('неверные данные отвергаются с понятным кодом', async () => {
    const codes = [
      { category: 'нет такой' },
      { category: '' },
      { card: 'Чужая' },
      { name: '' },
      { amount: 0 },
      { amount: 10.555 },
      { amount: 5, currency: 'XXX' },
      { scope: 'all' },
    ].map(async (extra) => (await call('POST', '/api/templates', 'misha', body(extra))).json());

    const results = await Promise.all(codes);
    expect(results.map((r) => r.error.code)).toEqual([
      'INVALID_CATEGORY',
      'INVALID_CATEGORY',
      'INVALID_CARD',
      'INVALID_NAME',
      'INVALID_AMOUNT',
      'INVALID_AMOUNT',
      'INVALID_CURRENCY',
      'INVALID_SCOPE',
    ]);
  });

  it('чужой личный шаблон выглядит как несуществующий', async () => {
    const id = await create('misha');

    const attempts = [
      await call('PUT', `/api/templates/${id}`, 'nastya', body()),
      await call('DELETE', `/api/templates/${id}`, 'nastya'),
      await call('PUT', `/api/templates/${id}/hidden`, 'nastya', { hidden: true }),
    ];

    expect(attempts.map((r) => r.statusCode)).toEqual([404, 404, 404]);
  });

  it('удаление архивирует: строка остаётся, в списке её нет', async () => {
    const id = await create('misha');

    expect((await call('DELETE', `/api/templates/${id}`, 'misha')).statusCode).toBe(200);

    expect(await list('misha')).toEqual([]);
    const rows = await database.query('SELECT 1 FROM expense_templates WHERE id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('карта, на которую нет права добавлять, заменяется картой по умолчанию, а если и её нет, остаётся не определённой', async () => {
    await create('nastya', { card: 'Миша' });
    expect((await list('nastya'))[0]).toMatchObject({ card: 'Миша', effectiveCard: 'Миша' });

    await database.query(
      "UPDATE card_access SET level = 'view' WHERE user_id = (SELECT id FROM users WHERE username = 'nastya')",
    );

    // Права добавлять нет ни на какую карту: определить карту нельзя
    expect((await list('nastya'))[0]).toMatchObject({ card: 'Миша', effectiveCard: null });
  });

  it('шаблон архивной категории помечен как недоступный', async () => {
    await create('misha');
    await database.query("UPDATE categories SET archived_at = now() WHERE name = 'кафе'");

    expect((await list('misha'))[0]!.unavailable).toBe(true);
  });
});

describe('групповые шаблоны и предложения', () => {
  const share = (as: string, id: string) => call('POST', `/api/templates/${id}/share`, as);
  const approve = (as: string, id: string) => call('POST', `/api/templates/${id}/approve`, as);
  const byName = async (as: string, name: string) =>
    (await list(as)).filter((x) => x.name === name);

  it('участник не создаёт групповой шаблон напрямую, владелец создаёт', async () => {
    const member = await call('POST', '/api/templates', 'nastya', body({ scope: 'group' }));
    const owner = await call('POST', '/api/templates', 'misha', body({ scope: 'group' }));

    expect(member.statusCode).toBe(403);
    expect(owner.statusCode).toBe(201);
    expect((await list('nastya'))[0]).toMatchObject({ scope: 'group', pending: false });
  });

  it('предложение участника группа не видит, пока владелец его не включит', async () => {
    const id = await create('nastya', { name: 'Автобус' });

    expect((await share('nastya', id)).json().data).toEqual({ status: 'proposed' });

    // Автор видит и своё, и предложение; владелец видит предложение; другие ничего
    expect((await byName('nastya', 'Автобус')).map((x) => [x.scope, x.pending])).toEqual([
      ['personal', false],
      ['group', true],
    ]);
    expect((await byName('misha', 'Автобус')).map((x) => [x.scope, x.pending, x.editable])).toEqual(
      [['group', true, true]],
    );
  });

  it('у предложения указан автор: владелец решает, глядя на него', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);

    expect((await byName('misha', 'Автобус'))[0]!.author).toEqual(expect.any(String));
    expect((await byName('misha', 'Автобус'))[0]!.author).toBe(
      (await byName('nastya', 'Автобус'))[0]!.author,
    );
  });

  it('кто и когда изменил групповой шаблон последним: до правки пусто, после видно кто', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;
    await approve('misha', proposal.id);
    expect((await byName('nastya', 'Автобус')).find((x) => x.scope === 'group')).toMatchObject({
      updatedBy: null,
      updatedAt: null,
    });

    await call(
      'PUT',
      `/api/templates/${proposal.id}`,
      'misha',
      body({ name: 'Автобус', amount: 99 }),
    );

    const changed = (await byName('nastya', 'Автобус')).find((x) => x.scope === 'group')!;
    expect(changed.updatedBy).toBe('Миша');
    expect(changed.author).toBe('Настя');
    expect(changed.updatedAt).toEqual(expect.any(String));
  });

  it('после включения шаблон виден всей группе, у автора остаётся и личный', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;

    expect((await approve('misha', proposal.id)).statusCode).toBe(200);

    expect((await byName('misha', 'Автобус'))[0]).toMatchObject({ scope: 'group', pending: false });
    expect((await byName('nastya', 'Автобус')).map((x) => [x.scope, x.pending])).toEqual([
      ['group', false],
      ['personal', false],
    ]);
  });

  it('владелец меняет групповой шаблон, личный шаблон автора не меняется', async () => {
    const id = await create('nastya', { name: 'Автобус', amount: 150, currency: 'AMD' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;
    await approve('misha', proposal.id);

    await call(
      'PUT',
      `/api/templates/${proposal.id}`,
      'misha',
      body({ name: 'Автобус', amount: 300, currency: 'AMD' }),
    );

    const mine = (await byName('nastya', 'Автобус')).find((x) => x.scope === 'personal');
    const group = (await byName('nastya', 'Автобус')).find((x) => x.scope === 'group');
    expect([mine!.amount, group!.amount]).toEqual([150, 300]);
  });

  it('автор меняет и удаляет свой групповой шаблон после включения, чужой участник нет', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;
    await approve('misha', proposal.id);

    const edit = await call(
      'PUT',
      `/api/templates/${proposal.id}`,
      'nastya',
      body({ name: 'Автобус', amount: 200 }),
    );

    expect(edit.statusCode).toBe(200);
    expect((await byName('misha', 'Автобус')).find((x) => x.scope === 'group')).toMatchObject({
      amount: 200,
      editable: true,
    });
    expect((await call('DELETE', `/api/templates/${proposal.id}`, 'nastya')).statusCode).toBe(200);
    expect((await byName('misha', 'Автобус')).find((x) => x.scope === 'group')).toBeUndefined();
  });

  it('пока предложение ждёт, автор может его отозвать, и тогда поделиться можно снова', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('nastya', 'Автобус')).find((x) => x.scope === 'group')!;
    expect(proposal.editable).toBe(true);

    expect((await call('DELETE', `/api/templates/${proposal.id}`, 'nastya')).statusCode).toBe(200);

    expect(await byName('misha', 'Автобус')).toEqual([]);
    expect((await share('nastya', id)).statusCode).toBe(201);
  });

  it('владелец отклоняет предложение: оно архивируется, личный шаблон остаётся', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;

    await call('DELETE', `/api/templates/${proposal.id}`, 'misha');

    expect((await byName('nastya', 'Автобус')).map((x) => x.scope)).toEqual(['personal']);
    const rows = await database.query('SELECT 1 FROM expense_templates WHERE id = $1', [
      proposal.id,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('повторно поделиться нельзя: пока ждёт и после включения', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    expect((await share('nastya', id)).json().error.code).toBe('TEMPLATE_ALREADY_PROPOSED');

    await approve('misha', (await byName('misha', 'Автобус'))[0]!.id);

    expect((await share('nastya', id)).json().error.code).toBe('TEMPLATE_ALREADY_SHARED');
  });

  it('владелец делится личным шаблоном: групповой копия включена сразу, личный остаётся', async () => {
    const id = await create('misha', { name: 'Автобус' });

    expect((await share('misha', id)).json().data).toEqual({ status: 'active' });

    expect((await byName('nastya', 'Автобус')).map((x) => [x.scope, x.pending])).toEqual([
      ['group', false],
    ]);
    expect((await byName('misha', 'Автобус')).map((x) => x.scope)).toEqual(['group', 'personal']);
  });

  it('делиться можно только своим личным шаблоном', async () => {
    const own = await create('misha');
    const group = await create('misha', { scope: 'group' });

    expect((await share('nastya', own)).statusCode).toBe(404);
    expect((await share('misha', group)).statusCode).toBe(403);
  });

  it('включить предложение может только владелец, и только предложение', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;
    const active = await create('misha', { scope: 'group', name: 'Аренда' });

    expect((await approve('nastya', proposal.id)).statusCode).toBe(403);
    expect((await approve('misha', active)).statusCode).toBe(422);
  });

  it('предложение нельзя скрыть: скрываются только включённые групповые', async () => {
    const id = await create('nastya', { name: 'Автобус' });
    await share('nastya', id);
    const proposal = (await byName('misha', 'Автобус'))[0]!;

    const response = await call('PUT', `/api/templates/${proposal.id}/hidden`, 'misha', {
      hidden: true,
    });

    expect(response.statusCode).toBe(422);
  });

  it('участник не правит групповой шаблон владельца', async () => {
    const id = await create('misha', { scope: 'group' });

    const edit = await call('PUT', `/api/templates/${id}`, 'nastya', body({ scope: 'group' }));
    const remove = await call('DELETE', `/api/templates/${id}`, 'nastya');

    expect([edit.statusCode, remove.statusCode]).toEqual([403, 403]);
    expect((await list('nastya'))[0]).toMatchObject({ editable: false });
  });

  it('скрытие личное: у других шаблон остаётся', async () => {
    const id = await create('misha', { scope: 'group' });

    await call('PUT', `/api/templates/${id}/hidden`, 'nastya', { hidden: true });

    expect((await list('nastya'))[0]!.hidden).toBe(true);
    expect((await list('misha'))[0]!.hidden).toBe(false);

    await call('PUT', `/api/templates/${id}/hidden`, 'nastya', { hidden: false });
    expect((await list('nastya'))[0]!.hidden).toBe(false);
  });

  it('личный шаблон скрыть нельзя', async () => {
    const id = await create('misha');

    const response = await call('PUT', `/api/templates/${id}/hidden`, 'misha', { hidden: true });

    expect(response.statusCode).toBe(422);
  });

  it('шаблон другой группы не виден и не меняется', async () => {
    const [group] = await database.query<{ id: string }>(
      "INSERT INTO groups (name, reporting_currency, timezone) VALUES ('B', 'AMD', 'UTC') RETURNING id",
    );
    const [user] = await database.query<{ id: string }>(
      "INSERT INTO users (id, username, display_name, card) VALUES (gen_random_uuid(), 'ivan', 'Иван', 'Иван') RETURNING id",
    );
    const [category] = await database.query<{ id: string }>(
      "INSERT INTO categories (group_id, name) VALUES ($1, 'чужая') RETURNING id",
      [group!.id],
    );
    const [foreign] = await database.query<{ id: string }>(
      `INSERT INTO expense_templates (group_id, owner_id, scope, name, category_id, expense_name)
       VALUES ($1, $2, 'group', 'Чужой', $3, 'Чужой') RETURNING id`,
      [group!.id, user!.id, category!.id],
    );

    expect(await list('misha')).toEqual([]);
    const edit = await call('PUT', `/api/templates/${foreign!.id}`, 'misha', body());
    const hide = await call('PUT', `/api/templates/${foreign!.id}/hidden`, 'misha', {
      hidden: true,
    });
    expect([edit.statusCode, hide.statusCode]).toEqual([404, 404]);
  });
});

describe('порядок', () => {
  it('по умолчанию групповые идут раньше личных (у них приоритет)', async () => {
    await create('misha', { name: 'А' });
    await create('misha', { name: 'Группа', scope: 'group' });

    expect((await list('misha')).map((x) => x.name)).toEqual(['Группа', 'А']);
  });

  it('у каждого свой порядок: можно поставить свой шаблон выше группового, у других не меняется', async () => {
    const group = await create('misha', { name: 'Группа', scope: 'group' });
    const mine = await create('nastya', { name: 'Моё' });
    const other = await create('nastya', { name: 'Моё второе' });

    const response = await call('PUT', '/api/templates/order', 'nastya', {
      ids: [other, mine, group],
    });

    expect(response.statusCode).toBe(200);
    expect((await list('nastya')).map((x) => x.name)).toEqual(['Моё второе', 'Моё', 'Группа']);
    expect((await list('misha')).map((x) => x.name)).toEqual(['Группа']);
  });

  it('новый групповой шаблон у того, кто расставил порядок, встаёт наверх, новый личный в конец', async () => {
    const mine = await create('nastya', { name: 'Моё' });
    const group = await create('misha', { name: 'Группа', scope: 'group' });
    await call('PUT', '/api/templates/order', 'nastya', { ids: [mine, group] });

    await create('misha', { name: 'Новая группа', scope: 'group' });
    await create('nastya', { name: 'Новое моё' });

    expect((await list('nastya')).map((x) => x.name)).toEqual([
      'Новая группа',
      'Моё',
      'Группа',
      'Новое моё',
    ]);
  });

  it('чужие и неподходящие шаблоны в порядке игнорируются', async () => {
    const mine = await create('nastya', { name: 'Моё' });
    const others = await create('misha', { name: 'Личное Миши' });
    const original = await create('nastya', { name: 'Предложение' });
    await call('POST', `/api/templates/${original}/share`, 'nastya');
    const proposal = (await list('misha')).find((x) => x.name === 'Предложение' && x.pending)!;

    const response = await call('PUT', '/api/templates/order', 'nastya', {
      ids: [others, proposal.id, mine],
    });

    expect(response.statusCode).toBe(200);
    const saved = await database.query<{ template_id: string }>(
      'SELECT template_id FROM template_order',
    );
    expect(saved.map((row) => row.template_id)).toEqual([mine]);
  });

  it('порядок групповых по умолчанию задаёт только владелец', async () => {
    const first = await create('misha', { name: 'Первый', scope: 'group' });
    const second = await create('misha', { name: 'Второй', scope: 'group' });

    const forbidden = await call('PUT', '/api/templates/group-order', 'nastya', {
      ids: [second, first],
    });
    const allowed = await call('PUT', '/api/templates/group-order', 'misha', {
      ids: [second, first],
    });

    expect(forbidden.statusCode).toBe(403);
    expect(allowed.statusCode).toBe(200);
    expect((await list('nastya')).map((x) => x.name)).toEqual(['Второй', 'Первый']);
  });
});

describe('доступ', () => {
  it('без входа нельзя', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/templates' });

    expect(response.statusCode).toBe(401);
  });

  it('шаблон из списка можно применить обычным расходом', async () => {
    await create('nastya', { amount: 1200, currency: 'AMD' });
    const [template] = await list('nastya');

    const response = await t.inject(
      {
        method: 'POST',
        url: '/api/expenses',
        headers: { 'idempotency-key': 'template-key-12345678' },
        payload: {
          date: '2026-10-15',
          card: template!.effectiveCard,
          category: 'кафе',
          name: 'Кофе',
          amount: template!.amount,
          currency: template!.currency,
        },
      },
      'nastya',
    );

    expect(response.statusCode).toBe(201);
  });
});
