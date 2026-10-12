import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import { cleanName } from './group.service.ts';
import type { InvitationsService } from './invitations.service.ts';

export interface GroupSummary {
  id: string;
  name: string;
  reportingCurrency: string;
  disabled: boolean;
  owners: number;
  members: number;
  createdAt: string;
}

export interface PlatformAdminOptions {
  database: Database;
  invitations: InvitationsService;
  /** Currencies a group may report in */
  currencies: string[];
  defaultCurrency: string;
  defaultTimezone: string;
  /** Categories a new group starts with */
  defaultCategories: string[];
}

/**
 * Management of groups for the application administrator. Only structure is visible here
 * (names and counts): the administrator gets no access to the expenses of other groups.
 */
export class PlatformAdminService {
  constructor(private readonly options: PlatformAdminOptions) {}

  async listGroups(): Promise<GroupSummary[]> {
    const rows = await this.options.database.query<{
      id: string;
      name: string;
      reporting_currency: string;
      disabled: boolean;
      owners: number;
      members: number;
      created_at: string;
    }>(
      `SELECT g.id, g.name, g.reporting_currency, (g.disabled_at IS NOT NULL) AS disabled,
              count(*) FILTER (WHERE m.role = 'owner')::int AS owners,
              count(m.user_id)::int AS members,
              to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
         FROM groups g LEFT JOIN memberships m ON m.group_id = g.id
        GROUP BY g.id ORDER BY g.created_at, g.id`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      reportingCurrency: row.reporting_currency,
      disabled: row.disabled,
      owners: row.owners,
      members: row.members,
      createdAt: row.created_at,
    }));
  }

  /** Creates an empty group and a link for its first owner. */
  async createGroup(
    admin: AuthUser,
    input: { name: unknown; currency?: unknown; timezone?: unknown },
  ) {
    const name = cleanName(input.name, 'Название группы');
    const currency = input.currency === undefined ? this.options.defaultCurrency : input.currency;
    if (typeof currency !== 'string' || !this.options.currencies.includes(currency)) {
      throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
    }
    const timezone =
      input.timezone === undefined ? this.options.defaultTimezone : String(input.timezone);
    if (!isTimeZone(timezone))
      throw validationError('INVALID_TIMEZONE', 'Неизвестный часовой пояс');

    const groupId = await this.options.database.transaction(async (tx) => {
      const [group] = await tx.query<{ id: string }>(
        'INSERT INTO groups (name, reporting_currency, timezone) VALUES ($1, $2, $3) RETURNING id',
        [name, currency, timezone],
      );
      for (const [position, category] of this.options.defaultCategories.entries()) {
        await tx.query('INSERT INTO categories (group_id, name, position) VALUES ($1, $2, $3)', [
          group!.id,
          category,
          position,
        ]);
      }
      return group!.id;
    });
    const invitation = await this.options.invitations.create({
      kind: 'join',
      groupId,
      role: 'owner',
      createdBy: admin.id,
    });
    return { id: groupId, ...invitation };
  }

  /** A new link for an owner (the first one was lost or expired). */
  async inviteOwner(admin: AuthUser, groupId: string) {
    await this.requireGroup(groupId);
    return this.options.invitations.create({
      kind: 'join',
      groupId,
      role: 'owner',
      createdBy: admin.id,
    });
  }

  /** A disabled group: its members cannot see or add anything until it is enabled again. */
  async setDisabled(groupId: string, disabled: boolean): Promise<void> {
    await this.requireGroup(groupId);
    await this.options.database.query(
      'UPDATE groups SET disabled_at = CASE WHEN $2 THEN COALESCE(disabled_at, now()) END, updated_at = now() WHERE id = $1',
      [groupId, disabled],
    );
  }

  /** A link to set a new password for any user (they forgot it and the owner cannot help). */
  async resetPassword(admin: AuthUser, username: string) {
    const [user] = await this.options.database.query<{ id: string }>(
      'SELECT id FROM users WHERE username = $1 AND disabled_at IS NULL',
      [username.trim().toLowerCase()],
    );
    if (!user) throw notFoundError();
    return this.options.invitations.create({ kind: 'reset', userId: user.id, createdBy: admin.id });
  }

  private async requireGroup(groupId: string): Promise<void> {
    const rows = await this.options.database.query('SELECT 1 FROM groups WHERE id = $1', [groupId]);
    if (rows.length === 0) throw new AppError(404, 'NOT_FOUND', 'Группа не найдена');
  }
}

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
