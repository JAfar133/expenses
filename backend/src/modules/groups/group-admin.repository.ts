import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import { timestampText } from '../../infrastructure/database/sql.ts';
import type { GroupRole } from '../auth/auth.types.ts';

export type CardLevel = 'view' | 'edit';

export interface GroupInfo {
  id: string;
  name: string;
  reportingCurrency: string;
  timezone: string;
  disabled: boolean;
}

export interface MemberInfo {
  userId: string;
  username: string;
  displayName: string;
  role: GroupRole;
  /** Listed in the server settings: cannot be removed from the app */
  fromEnv: boolean;
}

export interface CardInfo {
  id: string;
  name: string;
  currency: string;
  archived: boolean;
  /** Access of members (owners see every card without a row) */
  access: { userId: string; level: CardLevel }[];
}

export interface CategoryInfo {
  id: string;
  name: string;
  archived: boolean;
}

export interface GroupOverview {
  group: GroupInfo;
  members: MemberInfo[];
  cards: CardInfo[];
  categories: CategoryInfo[];
}

/** A name is taken by another card or category of the group. */
export class NameTakenError extends Error {}

/** SQL for managing one group: cards, access, categories, members. Business rules live in the service. */
export class GroupAdminRepository {
  constructor(private readonly database: Database) {}

  async getGroup(groupId: string, db: SqlExecutor = this.database): Promise<GroupInfo | undefined> {
    const [row] = await db.query<{
      id: string;
      name: string;
      reporting_currency: string;
      timezone: string;
      disabled: boolean;
    }>(
      `SELECT id, name, reporting_currency, timezone, (disabled_at IS NOT NULL) AS disabled
         FROM groups WHERE id = $1`,
      [groupId],
    );
    return (
      row && {
        id: row.id,
        name: row.name,
        reportingCurrency: row.reporting_currency,
        timezone: row.timezone,
        disabled: row.disabled,
      }
    );
  }

  async overview(groupId: string): Promise<GroupOverview | undefined> {
    const group = await this.getGroup(groupId);
    if (!group) return undefined;

    const [members, cards, access, categories] = await Promise.all([
      this.database.query<{
        user_id: string;
        username: string;
        display_name: string;
        role: GroupRole;
        from_env: boolean;
      }>(
        `SELECT u.id AS user_id, u.username, COALESCE(u.custom_display_name, u.display_name) AS display_name,
                m.role, u.from_env
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.group_id = $1 AND u.disabled_at IS NULL
          ORDER BY (m.role = 'owner') DESC, u.username`,
        [groupId],
      ),
      this.database.query<{ id: string; name: string; currency: string; archived: boolean }>(
        `SELECT id, name, currency, (archived_at IS NOT NULL) AS archived
           FROM cards WHERE group_id = $1 ORDER BY (archived_at IS NOT NULL), position, name`,
        [groupId],
      ),
      this.database.query<{ card_id: string; user_id: string; level: CardLevel }>(
        `SELECT a.card_id, a.user_id, a.level FROM card_access a JOIN cards c ON c.id = a.card_id
          WHERE c.group_id = $1`,
        [groupId],
      ),
      this.database.query<{ id: string; name: string; archived: boolean }>(
        `SELECT id, name, (archived_at IS NOT NULL) AS archived
           FROM categories WHERE group_id = $1 ORDER BY (archived_at IS NOT NULL), position, name`,
        [groupId],
      ),
    ]);

    return {
      group,
      members: members.map((m) => ({
        userId: m.user_id,
        username: m.username,
        displayName: m.display_name,
        role: m.role,
        fromEnv: m.from_env,
      })),
      cards: cards.map((card) => ({
        ...card,
        access: access
          .filter((a) => a.card_id === card.id)
          .map((a) => ({ userId: a.user_id, level: a.level })),
      })),
      categories,
    };
  }

  async renameGroup(groupId: string, name: string): Promise<void> {
    await this.database.query('UPDATE groups SET name = $2, updated_at = now() WHERE id = $1', [
      groupId,
      name,
    ]);
  }

  /** A new card goes to the end of the list; members get no access until the owner grants it. */
  async createCard(groupId: string, name: string, currency: string): Promise<string> {
    return this.unique(async () => {
      const [row] = await this.database.query<{ id: string }>(
        `INSERT INTO cards (group_id, name, currency, position)
         VALUES ($1, $2, $3, COALESCE((SELECT max(position) + 1 FROM cards WHERE group_id = $1), 0))
         RETURNING id`,
        [groupId, name, currency],
      );
      return row!.id;
    });
  }

  async cardBelongsToGroup(groupId: string, cardId: string): Promise<boolean> {
    const rows = await this.database.query('SELECT 1 FROM cards WHERE id = $1 AND group_id = $2', [
      cardId,
      groupId,
    ]);
    return rows.length > 0;
  }

  /**
   * Renames and/or archives a card. The name shown in the app comes from the `cards` table;
   * the text column of the records is updated too, because the old Excel sync still compares it.
   */
  async updateCard(
    cardId: string,
    patch: { name?: string; archived?: boolean; currency?: string },
  ): Promise<void> {
    await this.unique(() =>
      this.database.transaction(async (tx) => {
        if (patch.name !== undefined) {
          await tx.query('UPDATE cards SET name = $2 WHERE id = $1', [cardId, patch.name]);
          await tx.query('UPDATE expenses SET card = $2 WHERE card_id = $1 AND card <> $2', [
            cardId,
            patch.name,
          ]);
        }
        if (patch.currency !== undefined) {
          await tx.query('UPDATE cards SET currency = $2 WHERE id = $1', [cardId, patch.currency]);
        }
        if (patch.archived !== undefined) {
          await tx.query(
            'UPDATE cards SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, now()) END WHERE id = $1',
            [cardId, patch.archived],
          );
        }
      }),
    );
  }

  /** Whether any record (even a deleted one) was made with the card. */
  async cardHasExpenses(cardId: string): Promise<boolean> {
    const rows = await this.database.query('SELECT 1 FROM expenses WHERE card_id = $1 LIMIT 1', [
      cardId,
    ]);
    return rows.length > 0;
  }

  /**
   * Changes the reporting currency of the group and recalculates the reporting amount of every record.
   * A record of a card in that currency keeps its exact amount; the others are the drams amount at the given rate
   * (drams per unit of the new currency). Returns how many records were recalculated.
   */
  async setReportingCurrency(
    groupId: string,
    currency: string,
    rate: number,
    decimals: number,
  ): Promise<number> {
    return this.database.transaction(async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `UPDATE expenses
            SET reporting_currency = $2,
                reporting_amount = CASE WHEN card_currency = $2 THEN card_amount
                                        ELSE round(amount::numeric / $3::numeric, $4::int) END
          WHERE group_id = $1
          RETURNING id`,
        [groupId, currency, rate, decimals],
      );
      await tx.query(
        'UPDATE groups SET reporting_currency = $2, updated_at = now() WHERE id = $1',
        [groupId, currency],
      );
      return rows.length;
    });
  }

  /** Replaces access of the group's members to a card: a member missing from `levels` loses it. */
  async setCardAccess(
    groupId: string,
    cardId: string,
    levels: Map<string, CardLevel>,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM card_access WHERE card_id = $1
            AND user_id IN (SELECT user_id FROM memberships WHERE group_id = $2)`,
        [cardId, groupId],
      );
      for (const [userId, level] of levels) {
        await tx.query(
          `INSERT INTO card_access (card_id, user_id, level)
           SELECT $1, m.user_id, $3 FROM memberships m
            WHERE m.group_id = $4 AND m.user_id = $2 AND m.role = 'member'`,
          [cardId, userId, level, groupId],
        );
      }
    });
  }

  async createCategory(groupId: string, name: string): Promise<string> {
    return this.unique(async () => {
      const [row] = await this.database.query<{ id: string }>(
        `INSERT INTO categories (group_id, name, position)
         VALUES ($1, $2, COALESCE((SELECT max(position) + 1 FROM categories WHERE group_id = $1), 0))
         RETURNING id`,
        [groupId, name],
      );
      return row!.id;
    });
  }

  async categoryBelongsToGroup(groupId: string, categoryId: string): Promise<boolean> {
    const rows = await this.database.query(
      'SELECT 1 FROM categories WHERE id = $1 AND group_id = $2',
      [categoryId, groupId],
    );
    return rows.length > 0;
  }

  /** Renaming a category also renames it in the group's records (they keep the category as text). */
  async updateCategory(
    groupId: string,
    categoryId: string,
    patch: { name?: string; archived?: boolean },
  ): Promise<void> {
    await this.unique(() =>
      this.database.transaction(async (tx) => {
        if (patch.name !== undefined) {
          const [old] = await tx.query<{ name: string }>(
            'SELECT name FROM categories WHERE id = $1',
            [categoryId],
          );
          await tx.query('UPDATE categories SET name = $2 WHERE id = $1', [categoryId, patch.name]);
          if (old && old.name !== patch.name) {
            await tx.query(
              'UPDATE expenses SET category = $3 WHERE group_id = $1 AND category = $2',
              [groupId, old.name, patch.name],
            );
          }
        }
        if (patch.archived !== undefined) {
          await tx.query(
            'UPDATE categories SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, now()) END WHERE id = $1',
            [categoryId, patch.archived],
          );
        }
      }),
    );
  }

  /** Moves the records of a category to another one of the group and removes the emptied category. */
  async mergeCategory(groupId: string, sourceId: string, targetId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const names = await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM categories WHERE group_id = $1 AND id = ANY($2::uuid[])',
        [groupId, [sourceId, targetId]],
      );
      const source = names.find((row) => row.id === sourceId);
      const target = names.find((row) => row.id === targetId);
      if (!source || !target) return;
      await tx.query('UPDATE expenses SET category = $3 WHERE group_id = $1 AND category = $2', [
        groupId,
        source.name,
        target.name,
      ]);
      await tx.query('DELETE FROM categories WHERE id = $1', [sourceId]);
    });
  }

  /** A member of the group by login (any role), or undefined. */
  async findMember(groupId: string, username: string): Promise<MemberInfo | undefined> {
    const [row] = await this.database.query<{
      user_id: string;
      username: string;
      display_name: string;
      role: GroupRole;
      from_env: boolean;
    }>(
      `SELECT u.id AS user_id, u.username, COALESCE(u.custom_display_name, u.display_name) AS display_name,
              m.role, u.from_env
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = $1 AND u.username = $2 AND u.disabled_at IS NULL`,
      [groupId, username],
    );
    return (
      row && {
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        fromEnv: row.from_env,
      }
    );
  }

  /**
   * Removes a user from the group: the account is disabled and its sessions closed.
   * The records the user made stay (the author is kept).
   */
  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query('DELETE FROM card_access WHERE user_id = $1', [userId]);
      await tx.query('DELETE FROM memberships WHERE user_id = $1 AND group_id = $2', [
        userId,
        groupId,
      ]);
      await tx.query('UPDATE users SET disabled_at = now(), updated_at = now() WHERE id = $1', [
        userId,
      ]);
      await tx.query(
        'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
    });
  }

  async listInvitations(groupId: string): Promise<InvitationInfo[]> {
    const rows = await this.database.query<{
      id: string;
      kind: 'join' | 'reset';
      role: GroupRole | null;
      username: string | null;
      expires_at: string;
      created_at: string;
    }>(
      `SELECT i.id, i.kind, i.role, u.username,
              ${timestampText('i.expires_at')} AS expires_at,
              ${timestampText('i.created_at')} AS created_at
         FROM invitations i
         LEFT JOIN users u ON u.id = i.user_id
         LEFT JOIN memberships m ON m.user_id = i.user_id
        WHERE (i.group_id = $1 OR m.group_id = $1)
          AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        ORDER BY i.created_at DESC`,
      [groupId],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      role: row.role,
      username: row.username,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  /** Revokes a pending invitation of the group; false if there is no such one. */
  async revokeInvitation(groupId: string, invitationId: string): Promise<boolean> {
    const rows = await this.database.query(
      `UPDATE invitations i SET revoked_at = now()
        WHERE i.id = $1 AND i.used_at IS NULL AND i.revoked_at IS NULL
          AND (i.group_id = $2 OR i.user_id IN (SELECT user_id FROM memberships WHERE group_id = $2))
        RETURNING i.id`,
      [invitationId, groupId],
    );
    return rows.length > 0;
  }

  /** Turns a unique violation (23505) into a readable error. */
  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new NameTakenError();
      throw error;
    }
  }
}

export interface InvitationInfo {
  id: string;
  kind: 'join' | 'reset';
  role: GroupRole | null;
  /** For a password reset: whose password */
  username: string | null;
  expiresAt: string;
  createdAt: string;
}
