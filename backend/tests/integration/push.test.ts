import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** Web Push on the server side: devices, who gets what, privacy, and what happens when a device is gone. */
let database: Database;
let t: TestApp;
let key: string;

const BANK = {
  source: 'idbank',
  title: 'IDBank: GNUM',
  body: '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40',
};
const KEYS = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
) =>
  t.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) }, as);
const subscribe = (as: string, name: string, extra: Record<string, unknown> = {}) =>
  call('POST', '/api/push/subscriptions', as, { endpoint: endpoint(name), keys: KEYS, ...extra });
const send = (payload: unknown = BANK) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/transactions/import',
    headers: { authorization: `Bearer ${key}` },
    payload: payload as object,
  });
const sentTo = () => t.pushSender.sent.map((item) => item.target.endpoint);

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM push_subscriptions; DELETE FROM notification_settings; DELETE FROM notifications; DELETE FROM import_log; DELETE FROM bank_imports; DELETE FROM api_keys; DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  const [mine] = await database.query<{ id: string }>("SELECT id FROM cards WHERE name = 'Миша'");
  await call('PATCH', `/api/group/cards/${mine!.id}`, 'misha', { last4: '5386' });
  key = (await call('POST', '/api/group/api-keys', 'misha', { name: 'iPhone' })).json().data.key;
});

describe('устройства', () => {
  it('настройка для приложения: включено ли и открытый ключ', async () => {
    const response = await call('GET', '/api/push/config', 'misha');

    expect(response.json().data).toEqual({ enabled: true, publicKey: 'test-public-key' });
  });

  it('подписка сохраняется, в списке только название и даты, адрес и ключи не отдаются', async () => {
    const created = await subscribe('misha', 'one', { label: 'iPhone · Safari (приложение)' });

    expect(created.statusCode).toBe(201);
    const list = (await call('GET', '/api/push/subscriptions', 'misha')).json().data;
    expect(list).toEqual([
      expect.objectContaining({
        id: created.json().data.id,
        label: 'iPhone · Safari (приложение)',
      }),
    ]);
    expect(JSON.stringify(list)).not.toContain('fcm.googleapis.com');
    expect(JSON.stringify(list)).not.toContain(KEYS.auth);
  });

  it('без названия оно берётся из браузера', async () => {
    const response = await t.inject(
      {
        method: 'POST',
        url: '/api/push/subscriptions',
        payload: { endpoint: endpoint('ua'), keys: KEYS },
        headers: {
          'user-agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1',
        },
      },
      'misha',
    );

    expect(response.statusCode).toBe(201);
    expect((await call('GET', '/api/push/subscriptions', 'misha')).json().data[0].label).toBe(
      'iPhone · Safari',
    );
  });

  it('адрес не от известной службы отвергается (иначе сервер ходил бы по чужим адресам)', async () => {
    for (const bad of [
      'https://example.com/push',
      'https://169.254.169.254/latest',
      'http://fcm.googleapis.com/x',
    ]) {
      const response = await call('POST', '/api/push/subscriptions', 'misha', {
        endpoint: bad,
        keys: KEYS,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error?.code ?? response.json().code).toBe('INVALID_ENDPOINT');
    }
    expect(await database.query('SELECT 1 FROM push_subscriptions')).toHaveLength(0);
  });

  it('некорректное тело запроса: 422', async () => {
    expect(
      (await call('POST', '/api/push/subscriptions', 'misha', { endpoint: endpoint('x') }))
        .statusCode,
    ).toBe(422);
  });

  it('повторная подписка того же устройства не плодит записи; под другим человеком устройство переходит к нему', async () => {
    await subscribe('misha', 'shared');
    await subscribe('misha', 'shared');
    expect(await database.query('SELECT 1 FROM push_subscriptions')).toHaveLength(1);

    await subscribe('nastya', 'shared');

    expect((await call('GET', '/api/push/subscriptions', 'misha')).json().data).toEqual([]);
    expect((await call('GET', '/api/push/subscriptions', 'nastya')).json().data).toHaveLength(1);
  });

  it('удалять можно только свои устройства', async () => {
    const id = (await subscribe('misha', 'mine')).json().data.id;

    expect((await call('DELETE', `/api/push/subscriptions/${id}`, 'nastya')).statusCode).toBe(404);
    expect((await call('DELETE', `/api/push/subscriptions/${id}`, 'misha')).statusCode).toBe(200);
    expect(await database.query('SELECT 1 FROM push_subscriptions')).toHaveLength(0);
  });

  it('выход: устройство перестаёт получать уведомления этого человека', async () => {
    await subscribe('misha', 'phone');

    await call('POST', '/api/push/subscriptions/unsubscribe', 'misha', {
      endpoint: endpoint('phone'),
    });
    await send();
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(0);
  });

  it('не больше десяти устройств на человека', async () => {
    for (let index = 0; index < 10; index += 1) await subscribe('misha', `d${index}`);

    const extra = await subscribe('misha', 'd10');

    expect(extra.statusCode).toBe(409);
    // уже известное устройство обновить можно
    expect((await subscribe('misha', 'd3')).statusCode).toBe(201);
  });

  it('без входа нельзя', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/push/subscriptions' });

    expect(response.statusCode).toBe(401);
  });
});

describe('кому и что отправляется', () => {
  it('расход из банка уходит на устройства всех, кто его видит; тексты те же, что в ленте', async () => {
    await subscribe('misha', 'm1');
    await subscribe('misha', 'm2');
    await subscribe('nastya', 'n1');

    await send();
    await t.push.flush();

    expect(sentTo().sort()).toEqual([endpoint('m1'), endpoint('m2'), endpoint('n1')]);
    const first = t.pushSender.sent[0]!.payload;
    expect(first).toMatchObject({
      type: 'expense_imported',
      title: 'Расход добавлен',
      url: '/analytics/operations',
      unread: 1,
    });
    expect(first.body).toMatch(/1\s540 AMD · URARTU ZAQYAN · Миша · из IDBank/);
    expect(first.id).toEqual(expect.any(String));
  });

  it('одна покупка из двух источников: один push на устройство', async () => {
    await subscribe('misha', 'm1');

    await send();
    await send({
      source: 'apple_wallet',
      title: 'Urartu Zaqyan',
      merchant: 'Urartu Zaqyan',
      amount: '1540 AMD',
      receivedAt: '2026-10-16T20:41:00+04:00',
    });
    await send();
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(1);
  });

  it('ошибки импорта получают только владельцы', async () => {
    await subscribe('misha', 'owner');
    await subscribe('nastya', 'member');

    await send({ source: 'apple_wallet', title: 'Kiosk', body: 'нет суммы' });
    await t.push.flush();

    expect(sentTo()).toEqual([endpoint('owner')]);
    expect(t.pushSender.sent[0]!.payload.type).toBe('import_problem');
  });

  it('по умолчанию распознанный чек не пушится, но в ленте остаётся', async () => {
    await subscribe('misha', 'm1');
    await t.push.deliver([
      {
        id: 'x',
        userId: (
          await database.query<{ id: string }>("SELECT id FROM users WHERE username='misha'")
        )[0]!.id,
        type: 'receipt_parsed',
        title: 'Чек распознан',
        body: '1 500 AMD',
        createdAt: new Date(),
        unread: 1,
      },
    ]);
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(0);
  });

  it('человек выбирает, что присылать: отключённый тип не приходит, включённый приходит', async () => {
    await subscribe('misha', 'm1');
    await call('PUT', '/api/notifications/settings', 'misha', {
      push: { types: { expense_imported: false } },
    });

    await send();
    await t.push.flush();
    expect(t.pushSender.sent).toHaveLength(0);

    await call('PUT', '/api/notifications/settings', 'misha', {
      push: { types: { expense_imported: true } },
    });
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30') });
    await t.push.flush();
    expect(t.pushSender.sent).toHaveLength(1);
  });

  it('приватный режим: на экране блокировки нет суммы и магазина, в ленте всё есть', async () => {
    await subscribe('misha', 'm1');
    await call('PUT', '/api/notifications/settings', 'misha', { push: { hideAmounts: true } });

    await send();
    await t.push.flush();

    const payload = t.pushSender.sent[0]!.payload;
    expect(payload.body).toBe('Из IDBank');
    expect(JSON.stringify(payload)).not.toContain('URARTU');
    expect(JSON.stringify(payload)).not.toContain('1 540');
    const feed = (await call('GET', '/api/notifications', 'misha')).json().data.items[0];
    expect(feed.body).toContain('URARTU ZAQYAN');
  });

  it('число непрочитанных в сообщении растёт', async () => {
    await subscribe('misha', 'm1');

    await send();
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30') });
    await t.push.flush();

    expect(t.pushSender.sent.map((item) => item.payload.unread)).toEqual([1, 2]);
  });

  it('не больше десяти сообщений в минуту на человека, остальное только в ленте', async () => {
    await subscribe('misha', 'm1');

    for (let index = 0; index < 12; index += 1) {
      const minute = String(10 + index).padStart(2, '0');
      await send({ ...BANK, body: BANK.body.replace('20:40', `19:${minute}`) });
    }
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(10);
    expect((await call('GET', '/api/notifications', 'misha')).json().data.unread).toBe(12);
  });

  it('push не ломает импорт: если отправитель падает, расход создан и запись в ленте есть', async () => {
    await subscribe('misha', 'm1');
    t.pushSender.answers.set(endpoint('m1'), [{ ok: false, status: 500 }]);

    const response = await send();
    await t.push.flush();

    expect(response.statusCode).toBe(201);
    expect((await call('GET', '/api/notifications', 'misha')).json().data.items).toHaveLength(1);
  });
});

describe('устройство пропало или не отвечает', () => {
  it('410 и 404: подписка удаляется сразу, без повторов', async () => {
    await subscribe('misha', 'gone');
    t.pushSender.answers.set(endpoint('gone'), [{ ok: false, status: 410 }]);

    await send();
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(1);
    expect(await database.query('SELECT 1 FROM push_subscriptions')).toHaveLength(0);
  });

  it('занято (429, 5xx, нет связи): повторы, потом успех', async () => {
    await subscribe('misha', 'busy');
    t.pushSender.answers.set(endpoint('busy'), [
      { ok: false, status: 503 },
      { ok: false, status: null },
      { ok: true },
    ]);

    await send();
    await t.push.flush();

    expect(t.pushSender.sent).toHaveLength(3);
    const [row] = await database.query<{ failures: number; last_success_at: Date | null }>(
      'SELECT failures, last_success_at FROM push_subscriptions',
    );
    expect(row).toMatchObject({ failures: 0 });
    expect(row!.last_success_at).not.toBeNull();
  });

  it('постоянная ошибка считается; после десяти подряд устройство удаляется', async () => {
    await subscribe('misha', 'bad');
    t.pushSender.answers.set(endpoint('bad'), [{ ok: false, status: 403 }]);

    for (let index = 0; index < 10; index += 1) {
      await send({ ...BANK, body: BANK.body.replace('20:40', `18:${10 + index}`) });
      await t.push.flush();
      if (index === 8) {
        const [row] = await database.query<{ failures: number }>(
          'SELECT failures FROM push_subscriptions',
        );
        expect(row!.failures).toBe(9);
      }
    }

    expect(await database.query('SELECT 1 FROM push_subscriptions')).toHaveLength(0);
  });

  it('список показывает, что устройство не отвечает', async () => {
    await subscribe('misha', 'bad');
    t.pushSender.answers.set(endpoint('bad'), [{ ok: false, status: 403 }]);

    await send();
    await t.push.flush();

    expect((await call('GET', '/api/push/subscriptions', 'misha')).json().data[0].failures).toBe(1);
  });
});

describe('тестовое уведомление', () => {
  it('уходит на устройства человека; чужое устройство по номеру недоступно', async () => {
    const mine = (await subscribe('misha', 'm1')).json().data.id;
    await subscribe('nastya', 'n1');

    const response = await call('POST', '/api/push/test', 'misha', {});
    const other = await call('POST', '/api/push/test', 'nastya', { id: mine });

    expect(response.json().data).toEqual({ sent: 1, removed: 0 });
    expect(sentTo()).toEqual([endpoint('m1')]);
    expect(t.pushSender.sent[0]!.payload).toMatchObject({ title: 'Тестовое уведомление' });
    expect(other.statusCode).toBe(404);
  });

  it('не чаще пяти раз в минуту', async () => {
    await subscribe('misha', 'm1');

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await call('POST', '/api/push/test', 'misha', {})).statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('настройки уведомлений', () => {
  it('по умолчанию: расходы и ошибки да, чек нет, суммы показываются; сохраняется частями', async () => {
    const initial = (await call('GET', '/api/notifications/settings', 'misha')).json().data;
    expect(initial).toEqual({
      push: {
        types: { expense_imported: true, import_problem: true, receipt_parsed: false },
        hideAmounts: false,
      },
    });

    const saved = await call('PUT', '/api/notifications/settings', 'misha', {
      push: { types: { receipt_parsed: true }, hideAmounts: true },
    });

    expect(saved.json().data.push).toEqual({
      types: { expense_imported: true, import_problem: true, receipt_parsed: true },
      hideAmounts: true,
    });
    // У другого человека свои
    expect(
      (await call('GET', '/api/notifications/settings', 'nastya')).json().data.push.hideAmounts,
    ).toBe(false);
  });

  it('неизвестные поля и значения отвергаются', async () => {
    expect(
      (
        await call('PUT', '/api/notifications/settings', 'misha', {
          push: { types: { nope: true } },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await call('PUT', '/api/notifications/settings', 'misha', { other: 1 })).statusCode,
    ).toBe(422);
  });
});
