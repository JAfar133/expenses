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
}

/** A key that passed the check: the group it belongs to and the user the imported expenses are made by. */
export interface ActiveKey {
  id: string;
  groupId: string;
  userId: string;
  username: string;
  role: 'owner' | 'member';
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
  }): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO api_keys (group_id, created_by, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [entry.groupId, entry.userId, entry.name, entry.prefix, entry.hash],
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
    }>(
      `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
              COALESCE(u.custom_display_name, u.display_name) AS created_by
         FROM api_keys k JOIN users u ON u.id = k.created_by
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
    }));
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
    }>(
      `SELECT k.id, k.group_id, k.created_by, u.username, m.role
         FROM api_keys k
         JOIN users u ON u.id = k.created_by
         JOIN memberships m ON m.user_id = k.created_by AND m.group_id = k.group_id
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
