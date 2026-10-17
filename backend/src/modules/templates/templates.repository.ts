import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';

export type TemplateScope = 'personal' | 'group';

export type TemplateStatus = 'active' | 'proposed';

/** Who is asking: a personal template is seen by its author only, a proposal by its author and the owner of the group. */
export interface Viewer {
  userId: string;
  isOwner: boolean;
}

export interface TemplateRow {
  id: string;
  /** The author: for a group template, whoever created or proposed it */
  ownerId: string;
  /** The display name of the author */
  author: string;
  /** Who changed it last and when; null: never changed after it was made */
  updatedBy: string | null;
  updatedAt: Date | null;
  scope: TemplateScope;
  /** A proposal waits for the owner of the group; only active group templates are used by the group */
  status: TemplateStatus;
  /** A personal template: the state of its copy in the group, if there is one */
  sharedStatus: TemplateStatus | null;
  name: string;
  emoji: string | null;
  category: string;
  categoryArchived: boolean;
  /** The card chosen in the template; null: the user's default card */
  card: string | null;
  cardArchived: boolean;
  expenseName: string;
  amount: number | null;
  currency: string | null;
  hidden: boolean;
}

/** What a template is made of; where it lives (scope, status, origin) is decided on creation and never changes. */
export interface TemplateInput {
  name: string;
  emoji: string | null;
  categoryId: string;
  cardId: string | null;
  expenseName: string;
  amount: number | null;
  currency: string | null;
}

const SELECT = `
  SELECT t.id, t.owner_id, COALESCE(u.custom_display_name, u.display_name) AS author,
         COALESCE(uu.custom_display_name, uu.display_name) AS updated_by,
         CASE WHEN t.updated_by IS NULL THEN NULL ELSE t.updated_at END AS updated_at, t.scope, t.name, t.emoji, t.expense_name, t.amount::float8 AS amount, t.currency,
         cat.name AS category, (cat.archived_at IS NOT NULL) AS category_archived,
         c.name AS card, (c.archived_at IS NOT NULL) AS card_archived,
         t.status,
         (SELECT g.status FROM expense_templates g
           WHERE g.origin_id = t.id AND g.archived_at IS NULL ORDER BY g.created_at DESC LIMIT 1) AS shared_status,
         EXISTS (SELECT 1 FROM template_hidden h WHERE h.template_id = t.id AND h.user_id = $2) AS hidden
    FROM expense_templates t
    JOIN users u ON u.id = t.owner_id
    LEFT JOIN users uu ON uu.id = t.updated_by
    JOIN categories cat ON cat.id = t.category_id
    LEFT JOIN cards c ON c.id = t.card_id
    LEFT JOIN template_order o ON o.template_id = t.id AND o.user_id = $2`;

/**
 * The user's own arrangement first; a template they never placed follows the default: a group one goes to the top
 * (group templates have priority), a personal one to the end.
 */
const DISPLAY_ORDER = `CASE WHEN o.position IS NOT NULL THEN o.position::float8
                            WHEN t.scope = 'group' THEN -1 ELSE 1e9 END`;

/** The templates a viewer may see ($2: the user, $3: whether they own the group). */
const VISIBLE = `t.group_id = $1 AND t.archived_at IS NULL AND (
    (t.scope = 'personal' AND t.owner_id = $2)
    OR (t.scope = 'group' AND (t.status = 'active' OR t.owner_id = $2 OR $3::boolean)))`;

/** What a group template is created with. */
export interface TemplatePlacement {
  scope: TemplateScope;
  status: TemplateStatus;
  /** The personal template a proposal or a published copy came from */
  originId?: string;
}

interface RawRow {
  id: string;
  owner_id: string;
  author: string;
  updated_by: string | null;
  updated_at: Date | null;
  scope: TemplateScope;
  status: TemplateStatus;
  shared_status: TemplateStatus | null;
  name: string;
  emoji: string | null;
  expense_name: string;
  amount: number | null;
  currency: string | null;
  category: string;
  category_archived: boolean;
  card: string | null;
  card_archived: boolean | null;
  hidden: boolean;
}

const toRow = (row: RawRow): TemplateRow => ({
  id: row.id,
  ownerId: row.owner_id,
  author: row.author,
  updatedBy: row.updated_by,
  updatedAt: row.updated_at,
  scope: row.scope,
  status: row.status,
  sharedStatus: row.shared_status,
  name: row.name,
  emoji: row.emoji,
  category: row.category,
  categoryArchived: row.category_archived,
  card: row.card,
  cardArchived: row.card_archived ?? false,
  expenseName: row.expense_name,
  amount: row.amount,
  currency: row.currency,
  hidden: row.hidden,
});

/** SQL for templates. Every query is limited by the group; personal ones also by their author. */
export class TemplatesRepository {
  constructor(private readonly database: Database) {}

  /** Templates the viewer may see: their personal ones, the active group ones and the proposals they may review. */
  async list(groupId: string, viewer: Viewer): Promise<TemplateRow[]> {
    const rows = await this.database.query<RawRow>(
      `${SELECT}
        WHERE ${VISIBLE}
        ORDER BY (t.status = 'proposed'), ${DISPLAY_ORDER}, t.sort_order, t.created_at`,
      [groupId, viewer.userId, viewer.isOwner],
    );
    return rows.map(toRow);
  }

  /** A visible template by id (what the viewer may not see looks like a missing one). */
  async find(groupId: string, viewer: Viewer, id: string): Promise<TemplateRow | undefined> {
    const [row] = await this.database.query<RawRow>(
      `${SELECT}
        WHERE t.id = $4 AND ${VISIBLE}`,
      [groupId, viewer.userId, viewer.isOwner, id],
    );
    return row && toRow(row);
  }

  /** The id of an active category of the group by its name. */
  async categoryId(groupId: string, name: string): Promise<string | undefined> {
    const [row] = await this.database.query<{ id: string }>(
      'SELECT id FROM categories WHERE group_id = $1 AND name = $2 AND archived_at IS NULL',
      [groupId, name],
    );
    return row?.id;
  }

  /** The id of an active card of the group by its name. */
  async cardId(groupId: string, name: string): Promise<string | undefined> {
    const [row] = await this.database.query<{ id: string }>(
      'SELECT id FROM cards WHERE group_id = $1 AND name = $2 AND archived_at IS NULL',
      [groupId, name],
    );
    return row?.id;
  }

  async create(
    groupId: string,
    ownerId: string,
    placement: TemplatePlacement,
    input: TemplateInput,
  ): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO expense_templates
         (group_id, owner_id, scope, status, origin_id, name, emoji, category_id, card_id, expense_name, amount,
          currency, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         COALESCE((SELECT max(sort_order) + 1 FROM expense_templates WHERE group_id = $1 AND scope = $3), 0))
       RETURNING id`,
      [
        groupId,
        ownerId,
        placement.scope,
        placement.status,
        placement.originId ?? null,
        input.name,
        input.emoji,
        input.categoryId,
        input.cardId,
        input.expenseName,
        input.amount,
        input.currency,
      ],
    );
    return row!.id;
  }

  async update(id: string, input: TemplateInput, userId: string): Promise<void> {
    await this.database.query(
      `UPDATE expense_templates SET name = $2, emoji = $3, category_id = $4, card_id = $5,
              expense_name = $6, amount = $7, currency = $8, updated_at = now(), updated_by = $9
        WHERE id = $1`,
      [
        id,
        input.name,
        input.emoji,
        input.categoryId,
        input.cardId,
        input.expenseName,
        input.amount,
        input.currency,
        userId,
      ],
    );
  }

  /** The owner of the group makes a proposal an active group template. */
  async activate(id: string): Promise<void> {
    await this.database.query(
      `UPDATE expense_templates SET status = 'active', updated_at = now(),
              sort_order = COALESCE((SELECT max(o.sort_order) + 1 FROM expense_templates o
                                      WHERE o.group_id = expense_templates.group_id AND o.scope = 'group'), 0)
        WHERE id = $1`,
      [id],
    );
  }

  /** "Removing" is archiving: the row stays. */
  async archive(id: string): Promise<void> {
    await this.database.query(
      'UPDATE expense_templates SET archived_at = now(), updated_at = now() WHERE id = $1',
      [id],
    );
  }

  /** The default order of the group templates (the owner's): the position of the id in the list. */
  async reorder(ids: string[], db: SqlExecutor = this.database): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await db.query('UPDATE expense_templates SET sort_order = $2 WHERE id = $1', [id, index]);
    }
  }

  /** The user's own arrangement of everything they see: replaces the previous one. */
  async saveUserOrder(
    userId: string,
    ids: string[],
    db: SqlExecutor = this.database,
  ): Promise<void> {
    await db.query('DELETE FROM template_order WHERE user_id = $1', [userId]);
    for (const [index, id] of ids.entries()) {
      await db.query(
        'INSERT INTO template_order (user_id, template_id, position) VALUES ($1, $2, $3)',
        [userId, id, index],
      );
    }
  }

  async setHidden(userId: string, templateId: string, hidden: boolean): Promise<void> {
    if (hidden) {
      await this.database.query(
        'INSERT INTO template_hidden (user_id, template_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, templateId],
      );
    } else {
      await this.database.query(
        'DELETE FROM template_hidden WHERE user_id = $1 AND template_id = $2',
        [userId, templateId],
      );
    }
  }

  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }
}
