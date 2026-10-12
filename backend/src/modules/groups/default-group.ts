import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';

export interface DefaultGroupConfig {
  name: string;
  /** Reporting currency of the group (the base currency of the app so far) */
  currency: string;
  timezone: string;
  /** Cards and categories from the settings: they become the group's own */
  cards: string[];
  categories: string[];
  /** Logins of application administrators */
  admins: string[];
}

export interface DefaultGroupResult {
  /** The group was created by this call */
  created: boolean;
  /** Expenses that got a group and a card */
  assigned: number;
}

/**
 * Makes sure the data model of groups is filled in for an installation that predates it.
 *
 * On the first start with users, one group is created: editors become owners, other users members with
 * access to every card, cards and categories come from the settings. Expenses without a group are assigned to
 * it, each to the card with the same name (a card that does not exist yet is created).
 * Repeated calls change nothing, except that new administrators from the settings are marked.
 */
export async function ensureDefaultGroup(
  database: Database,
  config: DefaultGroupConfig,
): Promise<DefaultGroupResult> {
  return database.transaction(async (tx) => {
    const created = await createGroupIfMissing(tx, config);
    await attachOrphanUsers(tx);
    await markAdmins(tx, config.admins);
    return { created, assigned: await assignExpenses(tx) };
  });
}

async function createGroupIfMissing(tx: SqlExecutor, config: DefaultGroupConfig): Promise<boolean> {
  const [{ count: groups } = { count: 0 }] = await tx.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM groups',
  );
  if (groups > 0) return false;

  const users = await tx.query<{ id: string; is_editor: boolean }>(
    `SELECT id, COALESCE(can_edit_override, can_edit_default) AS is_editor
       FROM users WHERE disabled_at IS NULL ORDER BY username`,
  );
  if (users.length === 0) return false;

  const [group] = await tx.query<{ id: string }>(
    `INSERT INTO groups (name, reporting_currency, timezone) VALUES ($1, $2, $3) RETURNING id`,
    [config.name, config.currency, config.timezone],
  );
  const groupId = group!.id;

  // The group needs an owner: if nobody is an editor, the first user takes the role
  const hasEditor = users.some((user) => user.is_editor);
  const roleOf = (user: (typeof users)[number], index: number) =>
    user.is_editor || (!hasEditor && index === 0) ? 'owner' : 'member';
  for (const [index, user] of users.entries()) {
    await tx.query('INSERT INTO memberships (user_id, group_id, role) VALUES ($1, $2, $3)', [
      user.id,
      groupId,
      roleOf(user, index),
    ]);
  }

  for (const [position, card] of config.cards.entries()) {
    await tx.query(
      'INSERT INTO cards (group_id, name, currency, position) VALUES ($1, $2, $3, $4)',
      [groupId, card, config.currency, position],
    );
  }
  for (const [position, name] of config.categories.entries()) {
    await tx.query('INSERT INTO categories (group_id, name, position) VALUES ($1, $2, $3)', [
      groupId,
      name,
      position,
    ]);
  }

  // Members keep adding expenses to any card, as before
  await tx.query(
    `INSERT INTO card_access (card_id, user_id, level)
     SELECT c.id, m.user_id, 'edit'
       FROM cards c JOIN memberships m ON m.group_id = c.group_id
      WHERE c.group_id = $1 AND m.role = 'member'`,
    [groupId],
  );
  return true;
}

/**
 * Users added to the settings after the group was created join it as members with access to every card.
 * Only while there is a single group: with several, membership is decided by invitations.
 */
async function attachOrphanUsers(tx: SqlExecutor): Promise<void> {
  const groups = await tx.query<{ id: string }>('SELECT id FROM groups LIMIT 2');
  if (groups.length !== 1) return;
  const groupId = groups[0]!.id;

  const orphans = await tx.query<{ id: string }>(
    `INSERT INTO memberships (user_id, group_id, role)
     SELECT u.id, $1, 'member' FROM users u
      WHERE u.disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
     RETURNING user_id AS id`,
    [groupId],
  );
  if (orphans.length === 0) return;
  await tx.query(
    `INSERT INTO card_access (card_id, user_id, level)
     SELECT c.id, o.id, 'edit' FROM cards c, unnest($2::uuid[]) AS o(id) WHERE c.group_id = $1`,
    [groupId, orphans.map((user) => user.id)],
  );
}

async function markAdmins(tx: SqlExecutor, admins: string[]): Promise<void> {
  if (admins.length === 0) return;
  await tx.query('UPDATE users SET is_admin = true WHERE username = ANY($1::text[])', [admins]);
}

/** Expenses written before groups existed: the first group, the card by name, an unknown name creates a card. */
async function assignExpenses(tx: SqlExecutor): Promise<number> {
  const [group] = await tx.query<{ id: string }>(
    'SELECT id FROM groups ORDER BY created_at, id LIMIT 1',
  );
  if (!group) return 0;

  await tx.query(
    `INSERT INTO cards (group_id, name, currency, position)
     SELECT g.id, e.card, g.reporting_currency,
            COALESCE((SELECT max(c.position) + 1 FROM cards c WHERE c.group_id = g.id), 0)
              + row_number() OVER (ORDER BY e.card) - 1
       FROM groups g, (SELECT DISTINCT card FROM expenses WHERE card_id IS NULL) e
      WHERE g.id = $1
     ON CONFLICT (group_id, name) DO NOTHING`,
    [group.id],
  );
  const assigned = await tx.query<{ id: string }>(
    `UPDATE expenses e
        SET group_id = COALESCE(e.group_id, $1),
            card_id = c.id
       FROM cards c
      WHERE e.card_id IS NULL AND c.group_id = COALESCE(e.group_id, $1) AND c.name = e.card
     RETURNING e.id`,
    [group.id],
  );
  return assigned.length;
}
