import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';

export interface ReceiptSettings {
  enabled: boolean;
  /** Names of the categories where a photo may be attached */
  categories: string[];
  /** Names of the categories where the AI may read receipts (it also needs the photo to be allowed there) */
  aiCategories: string[];
}

/** What the permission check needs to know about an expense. */
export interface ReceiptExpense {
  id: string;
  groupId: string;
  cardId: string | null;
  category: string;
  createdBy: string;
  createdAt: string;
  deleted: boolean;
}

export interface Attachment {
  id: string;
  filePath: string;
  contentType: string;
}

export class ReceiptsRepository {
  constructor(private readonly database: Database) {}

  async settings(groupId: string, db: SqlExecutor = this.database): Promise<ReceiptSettings> {
    const [group] = await db.query<{ receipts_enabled: boolean }>(
      'SELECT receipts_enabled FROM groups WHERE id = $1',
      [groupId],
    );
    const categories = await db.query<{ name: string }>(
      `SELECT name FROM categories
        WHERE group_id = $1 AND receipts_allowed AND archived_at IS NULL ORDER BY position, name`,
      [groupId],
    );
    const aiCategories = await db.query<{ name: string }>(
      `SELECT name FROM categories
        WHERE group_id = $1 AND ai_allowed AND archived_at IS NULL ORDER BY position, name`,
      [groupId],
    );
    return {
      enabled: group?.receipts_enabled ?? false,
      categories: categories.map((row) => row.name),
      aiCategories: aiCategories.map((row) => row.name),
    };
  }

  /** Whether the AI may read receipts of this category (a category the group does not have: no). */
  async aiAllowed(groupId: string, category: string, db: SqlExecutor = this.database) {
    const rows = await db.query(
      'SELECT 1 FROM categories WHERE group_id = $1 AND name = $2 AND ai_allowed',
      [groupId, category],
    );
    return rows.length > 0;
  }

  /** Turns the feature on or off and sets the allowed categories (by name; unknown names are ignored). */
  async saveSettings(
    groupId: string,
    settings: Omit<ReceiptSettings, 'aiCategories'> & { aiCategories?: string[] },
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query('UPDATE groups SET receipts_enabled = $2 WHERE id = $1', [
        groupId,
        settings.enabled,
      ]);
      await tx.query(
        'UPDATE categories SET receipts_allowed = (name = ANY($2::text[])) WHERE group_id = $1',
        [groupId, settings.categories],
      );
      if (settings.aiCategories) {
        await tx.query(
          'UPDATE categories SET ai_allowed = (name = ANY($2::text[])) WHERE group_id = $1',
          [groupId, settings.aiCategories],
        );
      }
    });
  }

  async findExpense(
    id: string,
    db: SqlExecutor = this.database,
  ): Promise<ReceiptExpense | undefined> {
    const [row] = await db.query<{
      id: string;
      group_id: string;
      card_id: string | null;
      category: string;
      created_by: string;
      created_at: string;
      deleted_at: string | null;
    }>(
      `SELECT id, group_id, card_id, category, created_by, created_at::text AS created_at, deleted_at::text AS deleted_at
         FROM expenses WHERE id = $1`,
      [id],
    );
    return (
      row && {
        id: row.id,
        groupId: row.group_id,
        cardId: row.card_id,
        category: row.category,
        createdBy: row.created_by,
        createdAt: row.created_at,
        deleted: row.deleted_at !== null,
      }
    );
  }

  /** A member sees an expense when they have a card_access row for its card. */
  async memberSees(userId: string, expenseId: string): Promise<boolean> {
    const rows = await this.database.query(
      `SELECT 1 FROM expenses e JOIN card_access a ON a.card_id = e.card_id
        WHERE e.id = $1 AND a.user_id = $2`,
      [expenseId, userId],
    );
    return rows.length > 0;
  }

  async current(
    expenseId: string,
    db: SqlExecutor = this.database,
  ): Promise<Attachment | undefined> {
    const [row] = await db.query<{ id: string; file_path: string; content_type: string }>(
      'SELECT id, file_path, content_type FROM expense_attachments WHERE expense_id = $1 AND deleted_at IS NULL',
      [expenseId],
    );
    return row && { id: row.id, filePath: row.file_path, contentType: row.content_type };
  }

  /** Marks the current photo as removed (the file stays on the disk) and adds the new one, if any. */
  async replace(
    expense: ReceiptExpense,
    attachment: { id: string; filePath: string; contentType: string; size: number } | undefined,
    by: string,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query(
        'UPDATE expense_attachments SET deleted_at = now() WHERE expense_id = $1 AND deleted_at IS NULL',
        [expense.id],
      );
      if (!attachment) return;
      await tx.query(
        `INSERT INTO expense_attachments (id, expense_id, group_id, file_path, content_type, size_bytes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          attachment.id,
          expense.id,
          expense.groupId,
          attachment.filePath,
          attachment.contentType,
          attachment.size,
          by,
        ],
      );
    });
  }
}
