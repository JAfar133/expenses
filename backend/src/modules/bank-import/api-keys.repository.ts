import type { Database } from '../../infrastructure/database/database.ts';

export interface ApiKeyView {
  id: string;
  name: string;
  /** The first characters of the key, to recognise it; the key itself is never stored */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  /** The category for merchants the group has no history for; null: the group's usual fallback */
  defaultCategory: string | null;
}

/** A key that passed the check: the group it belongs to and the user the imported expenses are made by. */
export interface ActiveKey {
  id: string;
  groupId: string;
  userId: string;
  username: string;
  role: 'owner' | 'member';
  /** The key's default category (an active one), if it has one */
  defaultCategory: string | null;
  /** The time zone of the key's author: a date without a zone is read in it */
  timezone: string;
}

/** How often `last_used_at` is refreshed: a busy key does not write on every request. */
const TOUCH_EVERY_SECONDS = 60;

/** SQL for the group's API keys. Only hashes are stored. */
export class ApiKeysRepository {
  constructor(private readonly database: Database) {}

  async create(entry: {
    groupId: string;
    userId: string;
    name: string;
    prefix: string;
    hash: string;
    defaultCategoryId: string | null;
  }): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO api_keys (group_id, created_by, name, key_prefix, key_hash, default_category_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [entry.groupId, entry.userId, entry.name, entry.prefix, entry.hash, entry.defaultCategoryId],
    );
    return row!.id;
  }

  async list(groupId: string): Promise<ApiKeyView[]> {
    const rows = await this.database.query<{
      id: string;
      name: string;
      key_prefix: string;
      created_at: Date;
      last_used_at: Date | null;
      revoked_at: Date | null;
      created_by: string;
      default_category: string | null;
    }>(
      `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
              COALESCE(u.custom_display_name, u.display_name) AS created_by,
              c.name AS default_category
         FROM api_keys k JOIN users u ON u.id = k.created_by
         LEFT JOIN categories c ON c.id = k.default_category_id AND c.archived_at IS NULL
        WHERE k.group_id = $1
        ORDER BY (k.revoked_at IS NOT NULL), k.created_at DESC`,
      [groupId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.key_prefix,
      createdAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      revokedAt: row.revoked_at?.toISOString() ?? null,
      createdBy: row.created_by,
      defaultCategory: row.default_category,
    }));
  }

  /** Changes the key's name and/or default category; false when there is no such key in the group. */
  async update(
    groupId: string,
    id: string,
    patch: { name?: string; defaultCategoryId?: string | null },
  ): Promise<boolean> {
    const rows = await this.database.query(
      `UPDATE api_keys SET
              name = COALESCE($3, name),
              default_category_id = CASE WHEN $4 THEN $5 ELSE default_category_id END
        WHERE id = $1 AND group_id = $2 RETURNING id`,
      [
        id,
        groupId,
        patch.name ?? null,
        patch.defaultCategoryId !== undefined,
        patch.defaultCategoryId ?? null,
      ],
    );
    return rows.length > 0;
  }

  /** The id of an active category of the group by its name. */
  async categoryId(groupId: string, name: string): Promise<string | undefined> {
    const [row] = await this.database.query<{ id: string }>(
      'SELECT id FROM categories WHERE group_id = $1 AND name = $2 AND archived_at IS NULL',
      [groupId, name],
    );
    return row?.id;
  }

  /** Returns false when there is no such key in the group. A revoked key stays in the list. */
  async revoke(groupId: string, id: string): Promise<boolean> {
    const rows = await this.database.query(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1 AND group_id = $2 RETURNING id`,
      [id, groupId],
    );
    return rows.length > 0;
  }

  /** The key by the hash of what the client sent; none if it is unknown, revoked or its author left the group. */
  async findActive(hash: string): Promise<ActiveKey | undefined> {
    const [row] = await this.database.query<{
      id: string;
      group_id: string;
      created_by: string;
      username: string;
      role: 'owner' | 'member';
      default_category: string | null;
      timezone: string;
    }>(
      `SELECT k.id, k.group_id, k.created_by, u.username, m.role, c.name AS default_category,
              COALESCE(u.custom_timezone, u.timezone_default) AS timezone
         FROM api_keys k
         JOIN users u ON u.id = k.created_by
         JOIN memberships m ON m.user_id = k.created_by AND m.group_id = k.group_id
         LEFT JOIN categories c ON c.id = k.default_category_id AND c.archived_at IS NULL
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hash],
    );
    return (
      row && {
        id: row.id,
        groupId: row.group_id,
        userId: row.created_by,
        username: row.username,
        role: row.role,
        defaultCategory: row.default_category,
        timezone: row.timezone,
      }
    );
  }

  async touch(id: string): Promise<void> {
    await this.database.query(
      `UPDATE api_keys SET last_used_at = now()
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - make_interval(secs => $2))`,
      [id, TOUCH_EVERY_SECONDS],
    );
  }
}
