import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ImportLogRepository } from '../../src/modules/bank-import/import-log.repository.ts';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Apple Wallet through the same endpoint: the whole request is logged, and one purchase from two sources is one expense. */
let database: Database;
let t: TestApp;

const BANK = {
  source: 'idbank',
  title: 'IDBank: GNUM',
  body: '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40',
};
const wallet = (extra: Record<string, unknown> = {}) => ({
  source: 'apple_wallet',
  title: 'Urartu Zaqyan',
  body: 'Urartu Zaqyan — 1540 AMD',
  merchant: 'Urartu Zaqyan',
  amount: '1540 AMD',
  receivedAt: '2026-10-16T20:41:00+04:00',
  ...extra,
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);
const send = (key: string, payload: unknown) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/transactions/import',
    headers: { authorization: `Bearer ${key}` },
    payload: payload as object,
  });
const expenses = () =>
  database.query<{ id: string; name: string; amount: number; card: string; date: string }>(
    'SELECT id, name, amount, card, date::text AS date FROM expenses WHERE deleted_at IS NULL',
  );
const logRows = () =>
  database.query<{
    source: string;
    status: string;
    raw_payload: Record<string, unknown>;
    parsed: Record<string, unknown> | null;
    match: Record<string, unknown> | null;
    expense_id: string | null;
  }>(
    'SELECT source, status, raw_payload, parsed, match, expense_id FROM import_log ORDER BY received_at',
  );

const BANK_AT = (time: string) => ({ ...BANK, body: BANK.body.replace('20:40', time) });

let key: string;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM import_log; DELETE FROM bank_imports; DELETE FROM api_keys; DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  const cards = await database.query<{ id: string; name: string }>('SELECT id, name FROM cards');
  const mine = cards.find((card) => card.name === 'Миша')!;
  await call('PATCH', `/api/group/cards/${mine.id}`, 'misha', { last4: '5386' });
  key = (await call('POST', '/api/group/api-keys', 'misha', { name: 'iPhone — Wallet' })).json()
    .data.key;
});

describe('Apple Wallet: приём и журнал', () => {
  it('пример из задания: расход создаётся, карта по cardLast4, весь запрос с device и неизвестными полями в журнале', async () => {
    const payload = wallet({
      title: 'Food Court4 Kiosk 4',
      body: 'Food Court4 Kiosk 4 — 1950 AMD',
      transaction: 'Food Court4 Kiosk 4, 1950 AMD',
      merchant: 'Food Court4 Kiosk 4',
      amount: '1950 AMD',
      card: 'IDBank Visa',
      cardLast4: '5386',
      name: 'Food Court4 Kiosk 4',
      receivedAt: '2026-10-17T13:14:00+04:00',
      device: { name: 'iPhone Миши', model: 'iPhone17,1', os: '27.0' },
      someUnknownField: 'Some value',
    });

    const response = await send(key, payload);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ success: true, status: 'created' });
    expect(await expenses()).toEqual([
      expect.objectContaining({
        name: 'Food Court4 Kiosk 4',
        amount: 1950,
        card: 'Миша',
        date: '2026-10-17',
      }),
    ]);
    const [entry] = await logRows();
    expect(entry).toMatchObject({ source: 'apple_wallet', status: 'created' });
    expect(entry!.raw_payload).toEqual(payload);
    expect(entry!.parsed).toMatchObject({ amount: 1950, currency: 'AMD', cardLast4: '5386' });
  });

  it('только название карты из Wallet: подходит, если она однозначно совпала с картой приложения', async () => {
    const response = await send(key, wallet({ card: 'Миша' }));

    expect(response.json().status).toBe('created');
    expect((await expenses())[0]!.card).toBe('Миша');
  });

  it('карту определить нельзя: 200 unrecognized с номером записи, расход не создаётся, запрос сохранён', async () => {
    const payload = wallet({ card: 'IDBank Visa' });

    const response = await send(key, payload);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      status: 'unrecognized',
      importId: expect.any(String),
    });
    expect(await expenses()).toHaveLength(0);
    expect(await logRows()).toEqual([
      expect.objectContaining({ status: 'unrecognized', raw_payload: payload }),
    ]);
  });

  it('дата в том виде, как её показывает телефон («17 окт. 2026 г., 15:26»), читается', async () => {
    const response = await send(
      key,
      wallet({ cardLast4: '5386', receivedAt: '17 окт. 2026 г., 15:26', amount: '2 150,00 AMD' }),
    );

    expect(response.json().status).toBe('created');
    expect((await expenses())[0]).toMatchObject({ amount: 2150, date: '2026-10-17' });
    expect((await logRows())[0]!.parsed).toMatchObject({ occurredAt: '2026-10-17T11:26:00.000Z' });
  });

  it('нет суммы или валюты: тоже unrecognized, ничего не создаётся', async () => {
    const noAmount = await send(key, { source: 'apple_wallet', title: 'Shop', body: 'без суммы' });
    const noCurrency = await send(key, wallet({ amount: '1950', body: 'x', transaction: 'y' }));

    expect(noAmount.json().status).toBe('unrecognized');
    expect(noCurrency.json().status).toBe('unrecognized');
    expect(await expenses()).toHaveLength(0);
    expect(await logRows()).toHaveLength(2);
  });

  it('тот же запрос ещё раз: duplicate без второго расхода, журнал хранит оба запроса', async () => {
    const payload = wallet({ cardLast4: '5386' });
    const first = (await send(key, payload)).json();

    const again = await send(key, payload);

    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      success: true,
      status: 'duplicate',
      transactionId: first.transactionId,
    });
    expect(await expenses()).toHaveLength(1);
    expect((await logRows()).map((row) => row.status)).toEqual(['created', 'duplicate']);
  });

  it('transactionId от Wallet отличает операции с одинаковой суммой и временем', async () => {
    await send(key, wallet({ cardLast4: '5386', transactionId: 'A' }));
    await send(key, wallet({ cardLast4: '5386', transactionId: 'B', merchant: 'Другое место' }));

    expect(await expenses()).toHaveLength(2);
  });

  it('категория Wallet применяется, только если в группе есть категория с таким названием', async () => {
    await send(key, wallet({ cardLast4: '5386', category: 'продукты' }));
    await send(
      key,
      wallet({
        cardLast4: '5386',
        merchant: 'Shop 2',
        receivedAt: '2026-10-17T10:00:00+04:00',
        category: 'Еда и напитки',
      }),
    );

    const rows = await database.query<{ name: string; category: string }>(
      'SELECT name, category FROM expenses ORDER BY created_at',
    );
    expect(rows.map((row) => row.category)).toEqual(['продукты', 'кафе']);
  });

  it('неизвестный источник: 400, запрос всё равно сохранён', async () => {
    const response = await send(key, { source: 'something', title: 'x', body: 'y' });

    expect(response.statusCode).toBe(400);
    expect((await logRows()).map((row) => row.status)).toEqual(['unknown_source']);
  });

  it('в журнал не попадает ничего, похожее на ключ; длинные значения обрезаются', async () => {
    await send(key, wallet({ note: `мой ключ ${key}`, long: 'x'.repeat(5000), cardLast4: '5386' }));

    const raw = (await logRows())[0]!.raw_payload as { note: string; long: string };
    expect(raw.note).not.toContain('etk_');
    expect(JSON.stringify(await logRows())).not.toContain(key);
    expect(raw.long.length).toBeLessThan(2100);
  });
});

describe('одна покупка из двух источников', () => {
  it('сначала IDBank, потом Wallet: один расход, название от Wallet, связь видна в журнале', async () => {
    const first = (await send(key, BANK)).json();

    const second = await send(key, wallet());

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      success: true,
      status: 'duplicate',
      transactionId: first.transactionId,
    });
    expect(await expenses()).toEqual([
      expect.objectContaining({ name: 'Urartu Zaqyan', card: 'Миша', amount: 1540 }),
    ]);
    const entry = (await logRows()).find((row) => row.source === 'apple_wallet')!;
    expect(entry.status).toBe('duplicate');
    expect(entry.match).toMatchObject({
      reason: 'merchant',
      source: 'idbank',
      renamed: { from: 'URARTU ZAQYAN', to: 'Urartu Zaqyan' },
    });
  });

  it('если название расхода уже изменили вручную, Wallet его не переписывает', async () => {
    const first = (await send(key, BANK)).json();
    await database.query('UPDATE expenses SET name = $2 WHERE id = $1', [
      first.transactionId,
      'Моё название',
    ]);

    await send(key, wallet());

    expect((await expenses())[0]!.name).toBe('Моё название');
  });

  it('сначала Wallet без карты (unrecognized), потом IDBank: расход создаётся с названием Wallet, запрос Wallet помечен merged', async () => {
    const pending = await send(key, wallet());
    expect(pending.json().status).toBe('unrecognized');

    const bank = await send(key, BANK);

    expect(bank.json().status).toBe('created');
    expect(await expenses()).toEqual([
      expect.objectContaining({ name: 'Urartu Zaqyan', card: 'Миша', amount: 1540 }),
    ]);
    const rows = await logRows();
    expect(rows.map((row) => row.status)).toEqual(['merged', 'created']);
    // Запрос Wallet стал «merged» и ссылается на созданный расход
    const merged = await database.query<{ status: string; expense_id: string }>(
      "SELECT status, expense_id FROM import_log WHERE source = 'apple_wallet'",
    );
    expect(merged[0]!.status).toBe('merged');
    expect(merged[0]!.expense_id).toBe(bank.json().transactionId);
  });

  it('сначала Wallet с картой (создан), потом IDBank: duplicate, название Wallet остаётся', async () => {
    const first = (await send(key, wallet({ cardLast4: '5386' }))).json();

    const bank = await send(key, BANK);

    expect(bank.json()).toEqual({
      success: true,
      status: 'duplicate',
      transactionId: first.transactionId,
    });
    expect(await expenses()).toEqual([expect.objectContaining({ name: 'Urartu Zaqyan' })]);
  });

  it('разные покупки не склеиваются: другая сумма, другое время, другой магазин на другой карте', async () => {
    await send(key, BANK);

    const otherAmount = await send(key, wallet({ amount: '1541 AMD', cardLast4: '5386' }));
    const later = await send(
      key,
      wallet({ cardLast4: '5386', receivedAt: '2026-10-16T22:00:00+04:00' }),
    );
    const otherShopOtherCard = await send(
      key,
      wallet({ merchant: 'Совсем другое', title: 'Совсем другое', card: 'Настя' }),
    );

    expect(otherAmount.json().status).toBe('created');
    expect(later.json().status).toBe('created');
    expect(otherShopOtherCard.json().status).toBe('created');
    expect(await expenses()).toHaveLength(4);
  });

  it('удалённый расход не считается: та же покупка из Wallet создаётся заново', async () => {
    const first = (await send(key, BANK)).json();
    await database.query(
      "UPDATE expenses SET deleted_at = now(), deleted_reason = 'app' WHERE id = $1",
      [first.transactionId],
    );

    const again = await send(key, wallet({ cardLast4: '5386' }));

    expect(again.json().status).toBe('created');
  });
});

describe('приложение учится на исправлениях', () => {
  it('название и категория, которые человек выбрал для магазина, берутся при следующем импорте', async () => {
    const first = (await send(key, BANK)).json();
    await database.query(
      "UPDATE expenses SET name = 'Урарту', category = 'продукты' WHERE id = $1",
      [first.transactionId],
    );

    await send(key, BANK_AT('21:30'));

    const rows = await database.query<{ name: string; category: string }>(
      'SELECT name, category FROM expenses ORDER BY created_at',
    );
    expect(rows).toEqual([
      { name: 'Урарту', category: 'продукты' },
      { name: 'Урарту', category: 'продукты' },
    ]);
  });

  it('похожее название получает категорию, но не имя (это может быть другой филиал)', async () => {
    const first = (await send(key, BANK)).json();
    await database.query(
      "UPDATE expenses SET name = 'Урарту', category = 'продукты' WHERE id = $1",
      [first.transactionId],
    );

    await send(
      key,
      BANK_AT('21:30').body === undefined
        ? BANK
        : {
            ...BANK_AT('21:30'),
            body: BANK_AT('21:30').body.replace('URARTU ZAQYAN', 'URARTU ZAQYAN BRANCH 2'),
          },
    );

    const rows = await database.query<{ name: string; category: string }>(
      "SELECT name, category FROM expenses WHERE name <> 'Урарту'",
    );
    expect(rows).toEqual([{ name: 'URARTU ZAQYAN BRANCH 2', category: 'продукты' }]);
  });

  it('то же для Wallet: исправленное имя применяется к следующей покупке в том же месте', async () => {
    const first = (await send(key, wallet({ cardLast4: '5386' }))).json();
    await database.query(
      "UPDATE expenses SET name = 'Автобус', category = 'продукты' WHERE id = $1",
      [first.transactionId],
    );

    await send(key, wallet({ cardLast4: '5386', receivedAt: '2026-10-17T10:00:00+04:00' }));

    const rows = await database.query<{ name: string; category: string }>(
      'SELECT name, category FROM expenses ORDER BY created_at',
    );
    expect(rows.map((row) => row.name)).toEqual(['Автобус', 'Автобус']);
  });
});

describe('журнал: доступ и срок хранения', () => {
  it('смотреть может только владелец группы; можно отфильтровать по источнику', async () => {
    await send(key, BANK);
    await send(key, wallet({ card: 'IDBank Visa', receivedAt: '2026-10-17T09:00:00+04:00' }));

    expect((await call('GET', '/api/group/import-log', 'nastya')).statusCode).toBe(403);
    const all = (await call('GET', '/api/group/import-log', 'misha')).json().data;
    const onlyWallet = (
      await call('GET', '/api/group/import-log?source=apple_wallet', 'misha')
    ).json().data;

    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ keyName: 'iPhone — Wallet' });
    expect(onlyWallet.map((row: { source: string }) => row.source)).toEqual(['apple_wallet']);
    expect(onlyWallet[0].rawPayload).toMatchObject({ card: 'IDBank Visa' });
  });

  it('записи старше 30 дней удаляются при обслуживании', async () => {
    await send(key, BANK);
    await database.query("UPDATE import_log SET received_at = now() - interval '31 days'");
    await send(
      key,
      wallet({ cardLast4: '5386', merchant: 'New', receivedAt: '2026-10-17T10:00:00+04:00' }),
    );

    const removed = await new ImportLogRepository(database).deleteOlderThan(
      new Date(Date.now() - 30 * 86_400_000),
    );

    expect(removed).toBe(1);
    expect(await logRows()).toHaveLength(1);
  });
});
