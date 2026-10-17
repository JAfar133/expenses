import type { Database } from '../../infrastructure/database/database.ts';

export interface Addressee {
  id: string;
  name: string;
  /** The group name (the administrator sees people of all groups) */
  group: string | null;
  role: 'owner' | 'member' | null;
  groupId: string | null;
}

export interface BroadcastView {
  id: string;
  scope: 'group' | 'users' | 'all';
  title: string;
  body: string;
  recipients: number;
  createdAt: string;
}

/** SQL for the people a message can be sent to and the log of sent messages. */
export class BroadcastRepository {
  constructor(private readonly database: Database) {}

  /** Active users with their group; `groupId` limits it to one group (the owner's), none: everybody (the administrator). */
  async addressees(exceptUserId: string, groupId?: string): Promise<Addressee[]> {
    const rows = await this.database.query<{
      id: string;
      name: string;
      group_name: string | null;
      role: 'owner' | 'member' | null;
      group_id: string | null;
    }>(
      `SELECT u.id, COALESCE(u.custom_display_name, u.display_name) AS name,
              g.name AS group_name, m.role, m.group_id
         FROM users u
         LEFT JOIN memberships m ON m.user_id = u.id
         LEFT JOIN groups g ON g.id = m.group_id
        WHERE u.disabled_at IS NULL AND u.id <> $1 AND ($2::uuid IS NULL OR m.group_id = $2)
        ORDER BY g.name NULLS LAST, (m.role = 'owner') DESC, name`,
      [exceptUserId, groupId ?? null],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      group: row.group_name,
      role: row.role,
      groupId: row.group_id,
    }));
  }

  async record(entry: {
    senderId: string;
    scope: 'group' | 'users' | 'all';
    title: string;
    body: string;
    recipients: number;
  }): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO notification_broadcasts (sender_id, scope, title, body, recipients)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [entry.senderId, entry.scope, entry.title, entry.body, entry.recipients],
    );
    return row!.id;
  }

  async recent(senderId: string, limit: number): Promise<BroadcastView[]> {
    const rows = await this.database.query<{
      id: string;
      scope: 'group' | 'users' | 'all';
      title: string;
      body: string;
      recipients: number;
      created_at: Date;
    }>(
      `SELECT id, scope, title, body, recipients, created_at FROM notification_broadcasts
        WHERE sender_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [senderId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      title: row.title,
      body: row.body,
      recipients: row.recipients,
      createdAt: row.created_at.toISOString(),
    }));
  }
}
