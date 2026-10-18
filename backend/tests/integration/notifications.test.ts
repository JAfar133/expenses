import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, TEST_ORIGIN, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** The bell: who is told what, no duplicates, only your own feed. */
let database: Database;
let t: TestApp;
let key: string;

const BANK = {
  source: 'idbank',
  title: 'IDBank: GNUM',
  body: '1,540.00 AMD\nVISA **5386 - MNACORD: 3,238.96 AMD\nURARTU ZAQYAN, AM 16.10.2026 20:40',
};
const wallet = (extra: Record<string, unknown> = {}) => ({
  source: 'apple_wallet',
  title: 'Urartu Zaqyan',
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
const send = (payload: unknown) =>
  t.app.inject({
    method: 'POST',
    url: '/api/v1/transactions/import',
    headers: { authorization: `Bearer ${key}` },
    payload: payload as object,
  });
const feed = async (as: string) =>
  (await call('GET', '/api/notifications', as)).json().data as {
    items: {
      id: string;
      type: string;
      title: string;
      body: string;
      read: boolean;
      link: string | null;
    }[];
    unread: number;
  };

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM notifications; DELETE FROM import_log; DELETE FROM bank_imports; DELETE FROM api_keys; DELETE FROM template_order; DELETE FROM template_hidden; DELETE FROM expense_templates; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  t = await createTestApp(database);
  const [mine] = await database.query<{ id: string }>("SELECT id FROM cards WHERE name = 'Миша'");
  await call('PATCH', `/api/group/cards/${mine!.id}`, 'misha', { last4: '5386' });
  key = (await call('POST', '/api/group/api-keys', 'misha', { name: 'iPhone' })).json().data.key;
});

describe('расход из банка', () => {
  it('все, кто видит карту, получают «Расход добавлен» со всеми данными и ссылкой', async () => {
    await send(BANK);

    for (const user of ['misha', 'nastya']) {
      const { items, unread } = await feed(user);
      expect(unread).toBe(1);
      expect(items).toEqual([
        expect.objectContaining({
          type: 'expense_imported',
          title: 'Расход добавлен',
          body: expect.stringMatching(/1\s540 AMD · URARTU ZAQYAN · Миша · из IDBank/),
          link: expect.stringMatching(/^\/analytics\/operations\?expense=[\w-]+&date=2026-10-16$/),
          read: false,
        }),
      ]);
    }
  });

  it('участник без доступа к карте не получает уведомление, владелец получает всегда', async () => {
    await database.query(
      "DELETE FROM card_access WHERE user_id = (SELECT id FROM users WHERE username = 'nastya')",
    );

    await send(BANK);

    expect((await feed('misha')).items).toHaveLength(1);
    expect((await feed('nastya')).items).toHaveLength(0);
  });

  it('та же покупка из IDBank и Wallet: одно уведомление, дубликат и повтор запроса не добавляют новых', async () => {
    await send(BANK);
    await send(wallet());
    await send(BANK);

    expect((await feed('misha')).items).toHaveLength(1);
  });

  it('другая покупка даёт новое уведомление, лента идёт от новых к старым', async () => {
    await send(BANK);
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30').replace('1,540', '999') });

    const { items } = await feed('misha');

    expect(items).toHaveLength(2);
    expect(items[0]!.body).toContain('999 AMD');
  });
});

describe('проблемы импорта', () => {
  it('только владельцы узнают, что запрос не создал расход; другие виды уведомлений не шумят', async () => {
    await send(wallet({ card: 'Неизвестная карта' }));
    await send({ ...BANK, title: 'IDBank: MTUM' });

    const owner = await feed('misha');
    expect(owner.items).toEqual([
      expect.objectContaining({
        type: 'import_problem',
        title: 'Не удалось добавить расход',
        body: expect.stringContaining('Wallet:'),
        link: '/group/integrations',
      }),
    ]);
    expect((await feed('nastya')).items).toHaveLength(0);
  });

  it('запрос, который нельзя принять, тоже виден владельцам', async () => {
    await send({ source: 'idbank', title: 'IDBank', body: '' });

    expect((await feed('misha')).items[0]).toMatchObject({ type: 'import_problem' });
  });

  it('Wallet без карты, потом банк создал расход: «проблема» снимается, остаётся «Расход добавлен»', async () => {
    await send(wallet());
    expect((await feed('misha')).items.map((item) => item.type)).toEqual(['import_problem']);

    await send(BANK);

    expect((await feed('misha')).items.map((item) => item.type)).toEqual(['expense_imported']);
  });
});

describe('лента: чтение и права', () => {
  it('без входа нельзя', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
  });

  it('счётчик, отметка прочитанным по номерам и «всё прочитано»; чужие не затрагиваются', async () => {
    await send(BANK);
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30') });
    const mine = await feed('misha');
    expect((await call('GET', '/api/notifications/unread-count', 'misha')).json().data.unread).toBe(
      2,
    );

    await call('POST', '/api/notifications/read', 'misha', { ids: [mine.items[0]!.id] });
    expect((await feed('misha')).unread).toBe(1);
    expect((await feed('nastya')).unread).toBe(2);

    // Чужой номер ничего не отмечает
    await call('POST', '/api/notifications/read', 'nastya', { ids: [mine.items[1]!.id] });
    expect((await feed('misha')).unread).toBe(1);

    await call('POST', '/api/notifications/read', 'misha', {});
    expect((await feed('misha')).unread).toBe(0);
    expect((await feed('misha')).items.every((item) => item.read)).toBe(true);
    expect((await feed('nastya')).unread).toBe(2);
  });

  it('лента постраничная: limit и before', async () => {
    for (const time of ['20:10', '20:20', '20:30']) {
      await send({ ...BANK, body: BANK.body.replace('20:40', time) });
    }

    const first = await call('GET', '/api/notifications?limit=2', 'misha');
    const items = first.json().data.items as { createdAt: string }[];
    const rest = await call(
      'GET',
      `/api/notifications?limit=2&before=${encodeURIComponent(items[1]!.createdAt)}`,
      'misha',
    );

    expect(items).toHaveLength(2);
    expect(rest.json().data.items).toHaveLength(1);
  });

  it('старые записи удаляются при обслуживании: прочитанные через 30 дней, непрочитанные через 90', async () => {
    await send(BANK);
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30') });
    await database.query(
      "UPDATE notifications SET created_at = now() - interval '31 days', read_at = now() WHERE id = (SELECT id FROM notifications WHERE user_id = (SELECT id FROM users WHERE username = 'misha') ORDER BY created_at LIMIT 1)",
    );
    await database.query(
      "UPDATE notifications SET created_at = now() - interval '31 days' WHERE user_id = (SELECT id FROM users WHERE username = 'nastya')",
    );

    const { NotificationsService } =
      await import('../../src/modules/notifications/notifications.service.ts');
    const { NotificationsRepository } =
      await import('../../src/modules/notifications/notifications.repository.ts');
    const removed = await new NotificationsService(
      new NotificationsRepository(database),
    ).deleteOld();

    expect(removed).toBe(1);
  });
});

describe('скрыть уведомления', () => {
  it('одно или все: скрытое не видно и не считается; новые события приходят как обычно', async () => {
    await send(BANK);
    await send({ ...BANK, body: BANK.body.replace('20:40', '21:30') });
    await send({ ...BANK, body: BANK.body.replace('20:40', '22:10') });
    const before = await feed('misha');

    const one = await call('POST', '/api/notifications/dismiss', 'misha', {
      ids: [before.items[0]!.id],
    });

    expect(one.json().data.ids).toEqual([before.items[0]!.id]);
    const after = await feed('misha');
    expect(after.items).toHaveLength(2);
    expect(after.unread).toBe(2);

    const all = await call('POST', '/api/notifications/dismiss', 'misha', {});
    expect(all.json().data.ids).toHaveLength(2);
    expect(await feed('misha')).toMatchObject({ items: [], unread: 0 });
    // Другой человек не затронут
    expect((await feed('nastya')).items).toHaveLength(3);

    await send({ ...BANK, body: BANK.body.replace('20:40', '23:00') });
    expect((await feed('misha')).items).toHaveLength(1);
  });

  it('то же событие после скрытия не возвращается (повтор запроса банка)', async () => {
    await send(BANK);
    await call('POST', '/api/notifications/dismiss', 'misha', {});

    await send(BANK);

    expect((await feed('misha')).items).toHaveLength(0);
  });

  it('отмена: только что скрытое возвращается; чужие номера ничего не возвращают', async () => {
    await send(BANK);
    const hidden = (await call('POST', '/api/notifications/dismiss', 'misha', {})).json().data.ids;

    await call('POST', '/api/notifications/restore', 'nastya', { ids: hidden });
    expect((await feed('misha')).items).toHaveLength(0);

    await call('POST', '/api/notifications/restore', 'misha', { ids: hidden });
    expect((await feed('misha')).items).toHaveLength(1);
  });

  it('чужие номера при скрытии игнорируются; запрос без ids в restore отвергается', async () => {
    await send(BANK);
    const mine = (await feed('misha')).items[0]!.id;

    await call('POST', '/api/notifications/dismiss', 'nastya', { ids: [mine] });
    expect((await feed('misha')).items).toHaveLength(1);
    expect((await call('POST', '/api/notifications/restore', 'misha', {})).statusCode).toBe(422);
  });
});

describe('поток: счётчик меняется сразу, без опроса', () => {
  /** Opens the stream like the app does and collects the `unread` numbers it sends. */
  const openStream = async (as: 'misha' | 'nastya') => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const address = t.app.server.address() as { port: number };
    const cookies = await t.sessionCookies(as);
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/notifications/stream`, {
      headers: { cookie: `et_access=${cookies.et_access}` },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const seen: number[] = [];
    let buffer = '';
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += new TextDecoder().decode(value);
          for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^event: unread\ndata: (\{.*\})$/.exec(message);
            if (data) seen.push((JSON.parse(data[1]!) as { unread: number }).unread);
          }
        }
      } catch {
        // closed
      }
    })();
    const waitFor = async (count: number) => {
      for (let attempt = 0; attempt < 100 && seen.length < count; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    return { response, seen, waitFor, close: () => (controller.abort(), pump) };
  };

  it('первым сообщением приходит текущее число, потом каждое изменение: новое уведомление и прочтение', async () => {
    const stream = await openStream('misha');
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    await stream.waitFor(1);

    await send(BANK);
    await stream.waitFor(2);
    await call('POST', '/api/notifications/read', 'misha', {});
    await stream.waitFor(3);

    expect(stream.seen).toEqual([0, 1, 0]);
    await stream.close();
  });

  it('человек слышит только своё: чужие уведомления его счётчик не меняют; без входа потока нет', async () => {
    await database.query(
      "DELETE FROM card_access WHERE user_id = (SELECT id FROM users WHERE username = 'nastya')",
    );
    const stream = await openStream('nastya');
    await stream.waitFor(1);

    await send(BANK);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(stream.seen).toEqual([0]);
    await stream.close();
    const anonymous = await t.app.inject({ method: 'GET', url: '/api/notifications/stream' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('закрытое приложение перестаёт слушать', async () => {
    const stream = await openStream('misha');
    await stream.waitFor(1);
    expect(t.notifications.hub.size).toBe(1);

    await stream.close();
    for (let attempt = 0; attempt < 50 && t.notifications.hub.size > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(t.notifications.hub.size).toBe(0);
  });
});

describe('новый участник группы', () => {
  const join = async (username = 'olya', displayName = 'Оля') => {
    const token = (await call('POST', '/api/group/invitations', 'misha', { role: 'member' })).json()
      .data.token as string;
    return t.app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/accept`,
      headers: { origin: TEST_ORIGIN },
      payload: { username, displayName, password: 'long-enough-password-1' },
    });
  };

  it('все участники группы, кроме самого новичка, получают «Новый участник» со ссылкой на участников', async () => {
    const response = await join();

    expect(response.statusCode).toBe(201);
    for (const user of ['misha', 'nastya']) {
      expect((await feed(user)).items).toEqual([
        expect.objectContaining({
          type: 'member_joined',
          title: 'Новый участник',
          body: expect.stringContaining('Оля теперь в группе'),
          link: '/group/members',
        }),
      ]);
    }
    const [newcomer] = await database.query<{ id: string }>(
      "SELECT id FROM users WHERE username = 'olya'",
    );
    expect(
      await database.query('SELECT 1 FROM notifications WHERE user_id = $1', [newcomer!.id]),
    ).toHaveLength(0);
  });
});
