import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import type { Audience, NotificationType, NotificationView } from './notifications.types.ts';

/** SQL for the notification feed. Every read and change is limited to the person the rows belong to. */
export class NotificationsRepository {
  constructor(private readonly database: Database) {}

  /** The people an event is for. Disabled accounts get nothing. */
  async recipients(audience: Audience, db: SqlExecutor = this.database): Promise<string[]> {
    if (audience.type === 'user') return [audience.userId];
    if (audience.type === 'users') {
      if (audience.userIds.length === 0) return [];
      const rows = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND disabled_at IS NULL',
        [audience.userIds],
      );
      return rows.map((row) => row.id);
    }
    if (audience.type === 'group') {
      const rows = await db.query<{ user_id: string }>(
        `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND u.disabled_at IS NULL AND ($2::uuid IS NULL OR m.user_id <> $2)`,
        [audience.groupId, audience.exceptUserId ?? null],
      );
      return rows.map((row) => row.user_id);
    }
    if (audience.type === 'owners') {
      const rows = await db.query<{ user_id: string }>(
        `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND m.role = 'owner' AND u.disabled_at IS NULL`,
        [audience.groupId],
      );
      return rows.map((row) => row.user_id);
    }
    const rows = await db.query<{ user_id: string }>(
      `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 AND u.disabled_at IS NULL
          AND (m.role = 'owner' OR EXISTS (
                SELECT 1 FROM card_access a JOIN cards c ON c.id = a.card_id
                 WHERE a.user_id = m.user_id AND c.group_id = m.group_id AND c.name = $2))`,
      [audience.groupId, audience.card],
    );
    return rows.map((row) => row.user_id);
  }

  /** One row per person; a person who already has this dedupe key is skipped. Returns the rows that were added. */
  async add(
    entry: {
      userIds: string[];
      groupId: string | null;
      type: NotificationType;
      title: string;
      body: string;
      link?: string;
      data?: Record<string, unknown>;
      dedupeKey?: string;
    },
    db: SqlExecutor = this.database,
  ): Promise<{ id: string; userId: string; createdAt: Date }[]> {
    const added: { id: string; userId: string; createdAt: Date }[] = [];
    for (const userId of entry.userIds) {
      const rows = await db.query<{ id: string; created_at: Date }>(
        `INSERT INTO notifications (user_id, group_id, type, title, body, link, data, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id, created_at`,
        [
          userId,
          entry.groupId,
          entry.type,
          entry.title,
          entry.body,
          entry.link ?? null,
          entry.data ? JSON.stringify(entry.data) : null,
          entry.dedupeKey ?? null,
        ],
      );
      for (const row of rows) added.push({ id: row.id, userId, createdAt: row.created_at });
    }
    return added;
  }

  async removeByDedupeKeys(keys: string[]): Promise<void> {
    await this.database.query('DELETE FROM notifications WHERE dedupe_key = ANY($1::text[])', [
      keys,
    ]);
  }

  async list(userId: string, limit: number, before?: Date): Promise<NotificationView[]> {
    const rows = await this.database.query<{
      id: string;
      type: NotificationType;
      title: string;
      body: string;
      link: string | null;
      data: Record<string, unknown> | null;
      created_at: Date;
      read_at: Date | null;
    }>(
      `SELECT id, type, title, body, link, data, created_at, read_at FROM notifications
        WHERE user_id = $1 AND dismissed_at IS NULL AND ($3::timestamptz IS NULL OR created_at < $3)
        ORDER BY created_at DESC, id DESC LIMIT $2`,
      [userId, limit, before ?? null],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      data: row.data,
      createdAt: row.created_at.toISOString(),
      read: row.read_at !== null,
    }));
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
      [userId],
    );
    return row?.count ?? 0;
  }

  /** Marks the given rows of this person read (rows of others are not touched); no ids: all of them. */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    await this.database.query(
      `UPDATE notifications SET read_at = now()
        WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))`,
      [userId, ids ?? null],
    );
  }

  /** Hides the given rows of this person (no ids: all they see); a hidden row counts as read. Returns the ids hidden. */
  async dismiss(userId: string, ids?: string[]): Promise<string[]> {
    const rows = await this.database.query<{ id: string }>(
      `UPDATE notifications SET dismissed_at = now(), read_at = COALESCE(read_at, now())
        WHERE user_id = $1 AND dismissed_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
        RETURNING id`,
      [userId, ids ?? null],
    );
    return rows.map((row) => row.id);
  }

  /** Brings back rows hidden a moment ago (undo). Rows of others are not touched. */
  async restore(userId: string, ids: string[]): Promise<void> {
    await this.database.query(
      'UPDATE notifications SET dismissed_at = NULL WHERE user_id = $1 AND id = ANY($2::uuid[])',
      [userId, ids],
    );
  }

  /** Daily maintenance: read ones are kept 30 days, unread ones 90. Returns how many were removed. */
  async deleteOld(now: Date): Promise<number> {
    const rows = await this.database.query(
      `DELETE FROM notifications
        WHERE (read_at IS NOT NULL AND created_at < $1::timestamptz - interval '30 days')
           OR created_at < $1::timestamptz - interval '90 days'
        RETURNING id`,
      [now],
    );
    return rows.length;
  }
}
