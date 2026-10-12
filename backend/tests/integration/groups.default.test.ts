import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/infrastructure/database/database.ts';
import { AuthRepository } from '../../src/modules/auth/auth.repository.ts';
import {
  ensureDefaultGroup,
  type DefaultGroupConfig,
} from '../../src/modules/groups/default-group.ts';
import type { Expense } from '../../src/storage/expense.repository.ts';
import { PostgresExpenseRepository } from '../../src/storage/postgres/postgres.repository.ts';
import { createTestDatabase } from '../helpers/test-database.ts';

const config: DefaultGroupConfig = {
  name: 'Семья',
  currency: 'AMD',
  timezone: 'Asia/Yerevan',
  cards: ['Миша', 'Настя'],
  categories: ['кафе', 'продукты', 'другое'],
  admins: ['misha'],
};

const coffee: Expense = {
  date: '2026-10-11',
  card: 'Миша',
  category: 'кафе',
  name: 'Кофе',
  amount: 640,
};

let database: Database;
let expenses: PostgresExpenseRepository;

const addUsers = async () => {
  const auth = new AuthRepository(database);
  await auth.upsertUser('misha', 'Миша', { canEdit: true, timezone: 'Asia/Yerevan' });
  await auth.upsertUser('nastya', 'Настя', { canEdit: false, timezone: 'Asia/Yerevan' });
};

const rows = <T>(sql: string, params: unknown[] = []) => database.query<T>(sql, params);

beforeEach(async () => {
  database = await createTestDatabase();
  expenses = new PostgresExpenseRepository(database);
});

afterEach(() => database.close());

describe('группа по умолчанию', () => {
  it('без пользователей ничего не создаётся', async () => {
    const result = await ensureDefaultGroup(database, config);

    expect(result).toEqual({ created: false, assigned: 0 });
    expect(await rows('SELECT 1 FROM groups')).toHaveLength(0);
  });

  it('создаёт группу: редактор владелец, остальные участники с доступом ко всем картам', async () => {
    await addUsers();

    const result = await ensureDefaultGroup(database, config);

    expect(result.created).toBe(true);
    expect(await rows('SELECT name, reporting_currency, timezone FROM groups')).toEqual([
      { name: 'Семья', reporting_currency: 'AMD', timezone: 'Asia/Yerevan' },
    ]);
    expect(
      await rows(
        'SELECT u.username, m.role FROM memberships m JOIN users u ON u.id = m.user_id ORDER BY 1',
      ),
    ).toEqual([
      { username: 'misha', role: 'owner' },
      { username: 'nastya', role: 'member' },
    ]);
    expect(await rows('SELECT name, currency FROM cards ORDER BY name')).toEqual([
      { name: 'Миша', currency: 'AMD' },
      { name: 'Настя', currency: 'AMD' },
    ]);
    expect(await rows('SELECT name FROM categories ORDER BY position')).toEqual([
      { name: 'кафе' },
      { name: 'продукты' },
      { name: 'другое' },
    ]);
    expect(
      await rows(
        `SELECT u.username, c.name AS card, a.level FROM card_access a
           JOIN users u ON u.id = a.user_id JOIN cards c ON c.id = a.card_id ORDER BY 1, 2`,
      ),
    ).toEqual([
      { username: 'nastya', card: 'Миша', level: 'edit' },
      { username: 'nastya', card: 'Настя', level: 'edit' },
    ]);
  });

  it('без редакторов владельцем становится первый пользователь', async () => {
    const auth = new AuthRepository(database);
    await auth.upsertUser('nastya', 'Настя', { canEdit: false, timezone: 'UTC' });
    await auth.upsertUser('misha', 'Миша', { canEdit: false, timezone: 'UTC' });

    await ensureDefaultGroup(database, config);

    expect(
      await rows(
        "SELECT u.username FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'owner'",
      ),
    ).toEqual([{ username: 'misha' }]);
  });

  it('администраторы из настроек помечаются', async () => {
    await addUsers();

    await ensureDefaultGroup(database, config);

    expect(await rows('SELECT username FROM users WHERE is_admin ORDER BY 1')).toEqual([
      { username: 'misha' },
    ]);
  });

  it('повторный вызов ничего не меняет', async () => {
    await addUsers();
    await ensureDefaultGroup(database, config);

    const again = await ensureDefaultGroup(database, {
      ...config,
      name: 'Другое',
      cards: ['Новая'],
    });

    expect(again).toEqual({ created: false, assigned: 0 });
    expect(await rows('SELECT 1 FROM groups')).toHaveLength(1);
    expect(await rows('SELECT 1 FROM cards')).toHaveLength(2);
  });
});

describe('записи, созданные до групп', () => {
  it('получают группу и карту по названию; неизвестное название создаёт карту', async () => {
    await addUsers();
    await expenses.insertPending(database, coffee, 'misha');
    await expenses.insertPending(database, { ...coffee, card: 'Старая карта' }, 'misha');

    const result = await ensureDefaultGroup(database, config);

    expect(result.assigned).toBe(2);
    expect(
      await rows(
        `SELECT e.card, c.name AS card_name, c.currency, (e.group_id = c.group_id) AS same_group
           FROM expenses e JOIN cards c ON c.id = e.card_id ORDER BY e.card`,
      ),
    ).toEqual([
      { card: 'Миша', card_name: 'Миша', currency: 'AMD', same_group: true },
      { card: 'Старая карта', card_name: 'Старая карта', currency: 'AMD', same_group: true },
    ]);
  });
});

describe('категории из записей', () => {
  it('категории, которые уже есть в тратах, попадают в список группы (ничего не пропадает)', async () => {
    await addUsers();
    await expenses.insertPending(database, { ...coffee, category: 'транспорт' }, 'misha');
    await expenses.insertPending(database, { ...coffee, category: 'бытавуха' }, 'misha');
    await expenses.insertPending(database, { ...coffee, category: 'кафе' }, 'misha');

    await ensureDefaultGroup(database, config);

    expect(await rows('SELECT name FROM categories ORDER BY position')).toEqual([
      { name: 'кафе' },
      { name: 'продукты' },
      { name: 'другое' },
      { name: 'транспорт' },
      { name: 'бытавуха' },
    ]);
  });

  it('новая запись с неизвестной категорией (например из Excel) добавляет её в список', async () => {
    await addUsers();
    await ensureDefaultGroup(database, config);

    await expenses.importFromExcel(database, [{ ...coffee, category: 'здоровье' }]);

    expect(await rows("SELECT name FROM categories WHERE name = 'здоровье'")).toHaveLength(1);
    await expenses.importFromExcel(database, [{ ...coffee, category: 'здоровье', amount: 5 }]);
    expect(await rows("SELECT name FROM categories WHERE name = 'здоровье'")).toHaveLength(1);
  });
});

describe('новые записи после появления групп', () => {
  beforeEach(async () => {
    await addUsers();
    await ensureDefaultGroup(database, config);
  });

  it('получают группу автора и существующую карту', async () => {
    const created = await expenses.insertPending(database, coffee, 'misha');

    const [row] = await rows<{ group_id: string; card_id: string; name: string }>(
      `SELECT e.group_id, e.card_id, c.name FROM expenses e JOIN cards c ON c.id = e.card_id WHERE e.id = $1`,
      [created.id],
    );
    expect(row?.name).toBe('Миша');
    expect(row?.group_id).toBeTruthy();
    expect(await rows('SELECT 1 FROM cards')).toHaveLength(2);
  });

  it('импорт из Excel тоже привязывается, новая карта создаётся один раз', async () => {
    await expenses.importFromExcel(database, [
      { ...coffee, card: 'Из Excel' },
      { ...coffee, card: 'Из Excel', amount: 5 },
    ]);

    expect(
      await rows(
        "SELECT count(*)::int AS n FROM expenses WHERE card_id IS NOT NULL AND source = 'excel'",
      ),
    ).toEqual([{ n: 2 }]);
    expect(await rows("SELECT 1 FROM cards WHERE name = 'Из Excel'")).toHaveLength(1);
  });

  it('смена карты у записи меняет и card_id', async () => {
    const created = await expenses.insertPending(database, coffee, 'misha');

    await expenses.updateValues(database, created.id, { ...coffee, card: 'Настя' }, 'misha', false);

    expect(
      await rows('SELECT c.name FROM expenses e JOIN cards c ON c.id = e.card_id WHERE e.id = $1', [
        created.id,
      ]),
    ).toEqual([{ name: 'Настя' }]);
  });

  it('правка другого поля не трогает карту и не создаёт новых', async () => {
    const created = await expenses.insertPending(database, coffee, 'misha');

    await expenses.updateValues(database, created.id, { ...coffee, amount: 1 }, 'misha', false);

    expect(await rows('SELECT 1 FROM cards')).toHaveLength(2);
  });
});
