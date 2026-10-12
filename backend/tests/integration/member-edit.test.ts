import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { createTestApp, type TestApp } from '../helpers/create-test-app.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

/** A member corrects or deletes their own expense within the time the owner allows. */
let database: Database;
let t: TestApp;
/** The test clock runs ahead of the real one by this many minutes */
let offsetMinutes = 0;

const MINUTE = 60_000;
const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  as: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) =>
  t.inject(
    { method, url, headers, ...(payload === undefined ? {} : { payload: payload as object }) },
    as,
  );

let keyCounter = 0;
const spend = (card: string, name: string, amount: number, as: string) =>
  call(
    'POST',
    '/api/expenses',
    as,
    { date: '2026-10-10', card, category: 'кафе', name, amount },
    { 'idempotency-key': `member-edit-${++keyCounter}-xxxxxxxx` },
  );
const idOf = async (name: string) =>
  (await rows<{ id: string }>('SELECT id FROM expenses WHERE name = $1', [name]))[0]!.id;
const setWindow = (minutes: number) => call('PUT', '/api/group/member-edit', 'misha', { minutes });
const patch = async (name: string, amount: number, as = 'nastya') =>
  call('PATCH', `/api/expenses/${await idOf(name)}`, as, { amount });
const amountOf = async (name: string) =>
  (await rows<{ amount: number }>('SELECT amount FROM expenses WHERE name = $1', [name]))[0]!
    .amount;

beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(() => database.close());

beforeEach(async () => {
  await database.exec(
    'DELETE FROM expense_changes; DELETE FROM expenses; DELETE FROM invitations; DELETE FROM auth_sessions; DELETE FROM card_access; DELETE FROM memberships; DELETE FROM cards; DELETE FROM categories; DELETE FROM groups; DELETE FROM users',
  );
  offsetMinutes = 0;
  t = await createTestApp(database, { now: () => new Date(Date.now() + offsetMinutes * MINUTE) });
  await spend('Настя', 'Своя трата', 500, 'nastya');
  await spend('Миша', 'Трата миши', 700, 'misha');
});

describe('участник правит свою трату', () => {
  it('по умолчанию окно неделя: своя трата правится, запись в журнале от участника', async () => {
    const response = await patch('Своя трата', 650);

    expect(response.statusCode).toBe(200);
    expect(await amountOf('Своя трата')).toBe(650);
    const log = await rows<{ changed_by: string; action: string }>(
      'SELECT changed_by, action FROM expense_changes',
    );
    expect(log).toEqual([{ changed_by: 'nastya', action: 'update' }]);
  });

  it('чужую трату нельзя, даже видимую', async () => {
    const response = await patch('Трата миши', 1, 'nastya');

    expect(response.statusCode).toBe(403);
    expect(await amountOf('Трата миши')).toBe(700);
  });

  it('удалить свою можно (мягко), вернуть может только владелец', async () => {
    const id = await idOf('Своя трата');

    const removed = await call('DELETE', `/api/expenses/${id}`, 'nastya');
    const restoredByMember = await call('POST', `/api/expenses/${id}/restore`, 'nastya');
    const restoredByOwner = await call('POST', `/api/expenses/${id}/restore`, 'misha');

    expect(removed.statusCode).toBe(200);
    expect(restoredByMember.statusCode).toBe(403);
    expect(restoredByOwner.statusCode).toBe(200);
  });

  it('после окончания срока правка закрыта с понятной ошибкой', async () => {
    await setWindow(60);
    offsetMinutes = 59;
    expect((await patch('Своя трата', 510)).statusCode).toBe(200);

    offsetMinutes = 61;
    const late = await patch('Своя трата', 520);

    expect(late.statusCode).toBe(403);
    expect(late.json().error.code).toBe('EDIT_WINDOW_CLOSED');
    expect(await amountOf('Своя трата')).toBe(510);
  });

  it('выключено владельцем: участник не правит, владелец правит как раньше', async () => {
    await setWindow(0);

    const member = await patch('Своя трата', 1);
    const owner = await patch('Своя трата', 600, 'misha');

    expect(member.statusCode).toBe(403);
    expect(member.json().error.code).toBe('MEMBER_EDIT_OFF');
    expect(owner.statusCode).toBe(200);
  });

  it('владелец правит любую трату независимо от срока', async () => {
    offsetMinutes = 60 * 24 * 30;

    expect((await patch('Своя трата', 123, 'misha')).statusCode).toBe(200);
  });

  it('если доступ к карте сузили до просмотра, свою трату по ней править уже нельзя', async () => {
    await database.query(
      "UPDATE card_access SET level = 'view' WHERE card_id = (SELECT id FROM cards WHERE name = 'Настя')",
    );

    expect((await patch('Своя трата', 1)).statusCode).toBe(403);
  });

  it('перенести свою трату можно только на карту, где разрешено добавлять', async () => {
    await database.query(
      "DELETE FROM card_access WHERE card_id = (SELECT id FROM cards WHERE name = 'Миша')",
    );
    const id = await idOf('Своя трата');

    const denied = await call('PATCH', `/api/expenses/${id}`, 'nastya', { card: 'Миша' });

    expect(denied.statusCode).toBe(422);
    expect(denied.json().error.code).toBe('INVALID_CARD');
  });

  it('строки из Excel участнику не принадлежат', async () => {
    await database.query(
      `INSERT INTO expenses (id, date, card, category, name, amount, source, excel_status, created_by)
       VALUES (gen_random_uuid(), '2026-10-01', 'Настя', 'кафе', 'Из файла', 100, 'excel', 'synced', 'excel')`,
    );

    expect((await patch('Из файла', 1)).statusCode).toBe(403);
  });
});

describe('признак editable в списке операций', () => {
  const items = async (as: string) =>
    (await call('GET', '/api/expenses?limit=20&includeDeleted=true', as)).json().data.items as {
      name: string;
      editable: boolean;
      editableUntil?: string | null;
    }[];
  const flag = async (as: string, name: string) => (await items(as)).find((i) => i.name === name)!;

  it('владелец может править любую неудалённую, участник только свою в пределах срока', async () => {
    expect((await flag('misha', 'Своя трата')).editable).toBe(true);
    expect((await flag('misha', 'Трата миши')).editable).toBe(true);
    expect((await flag('nastya', 'Своя трата')).editable).toBe(true);
    expect((await flag('nastya', 'Трата миши')).editable).toBe(false);
  });

  it('у участника есть срок «до», после него признак гаснет', async () => {
    await setWindow(15);

    const mine = await flag('nastya', 'Своя трата');
    expect(mine.editableUntil).toBeTruthy();
    expect(Date.parse(mine.editableUntil!) - Date.now()).toBeLessThanOrEqual(15 * MINUTE);

    offsetMinutes = 16;
    expect((await flag('nastya', 'Своя трата')).editable).toBe(false);
  });

  it('выключено: у участника признака нет вообще', async () => {
    await setWindow(0);

    expect((await flag('nastya', 'Своя трата')).editable).toBe(false);
  });

  it('удалённая запись не редактируется никем', async () => {
    const id = await idOf('Своя трата');
    await call('DELETE', `/api/expenses/${id}`, 'misha');

    expect((await flag('misha', 'Своя трата')).editable).toBe(false);
  });
});

describe('настройка срока владельцем', () => {
  it('меняется только допустимыми значениями и видна в описании группы', async () => {
    for (const minutes of [0, 15, 60, 1440, 10080]) {
      expect((await setWindow(minutes)).statusCode).toBe(200);
      expect((await call('GET', '/api/group', 'misha')).json().data.group.memberEditMinutes).toBe(
        minutes,
      );
    }
    expect((await setWindow(30)).statusCode).toBe(422);
    expect((await setWindow(-5)).statusCode).toBe(422);
  });

  it('участнику настройка недоступна', async () => {
    expect(
      (await call('PUT', '/api/group/member-edit', 'nastya', { minutes: 60 })).statusCode,
    ).toBe(403);
  });
});
