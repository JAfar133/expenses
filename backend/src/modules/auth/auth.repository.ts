import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database/database.ts';
import { timestampText } from '../../infrastructure/database/sql.ts';
import type { AuthUser, ClientContext } from './auth.types.ts';

export interface StoredUser extends AuthUser {
  passwordHash: string | null;
  /** Hash of the last applied password from .env (see migration 0007) */
  envPasswordHash: string | null;
  disabled: boolean;
}

export interface StoredSession {
  id: string;
  user: AuthUser;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  createdAt: Date;
  rotatedAt: Date | null;
  /** Which hash matched: the current refresh token or the previous (already replaced) one */
  matched: 'current' | 'previous';
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  card: string;
  can_edit: boolean;
  timezone: string;
  password_hash: string | null;
  env_password_hash: string | null;
  disabled: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  card: string;
  can_edit: boolean;
  timezone: string;
  access_expires_at: string;
  refresh_expires_at: string;
  created_at: string;
  rotated_at: string | null;
  matched: 'current' | 'previous';
}

const toUser = (row: UserRow): StoredUser => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  card: row.card,
  canEdit: row.can_edit,
  timezone: row.timezone,
  passwordHash: row.password_hash,
  envPasswordHash: row.env_password_hash,
  disabled: row.disabled,
});

/** Values the app sees: the user's personal choice on top of the configuration values. */
const EFFECTIVE_USER_COLUMNS = `
  COALESCE(u.custom_display_name, u.display_name) AS display_name,
  COALESCE(u.custom_card, u.card) AS card,
  COALESCE(u.can_edit_override, u.can_edit_default) AS can_edit,
  COALESCE(u.custom_timezone, u.timezone_default) AS timezone`;

const SESSION_COLUMNS = `
  s.id, s.user_id, u.username, ${EFFECTIVE_USER_COLUMNS},
  ${timestampText('s.access_expires_at')} AS access_expires_at,
  ${timestampText('s.refresh_expires_at')} AS refresh_expires_at,
  ${timestampText('s.created_at')} AS created_at,
  ${timestampText('s.rotated_at')} AS rotated_at`;

const toSession = (row: SessionRow): StoredSession => ({
  id: row.id,
  user: {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    card: row.card,
    canEdit: row.can_edit,
    timezone: row.timezone,
  },
  accessExpiresAt: new Date(row.access_expires_at),
  refreshExpiresAt: new Date(row.refresh_expires_at),
  createdAt: new Date(row.created_at),
  rotatedAt: row.rotated_at ? new Date(row.rotated_at) : null,
  matched: row.matched,
});

/** A new session. The creation time is set by the service (its clock); the session lifetime limit counts from it. */
export interface NewSession {
  userId: string;
  accessHash: string;
  accessExpiresAt: Date;
  refreshHash: string;
  refreshExpiresAt: Date;
  createdAt: Date;
}

export class AuthRepository {
  constructor(private readonly database: Database) {}

  /**
   * Creates or updates a user from the settings (card, time zone and the "default" edit permission).
   * Does not touch the user's personal choice (custom_*) or the password.
   */
  async upsertUser(
    username: string,
    card: string,
    defaults: { canEdit?: boolean; timezone?: string } = {},
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO users (id, username, display_name, card, can_edit_default, timezone_default)
       VALUES ($1, $2, $3, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE
         SET display_name = EXCLUDED.display_name, card = EXCLUDED.card,
             can_edit_default = EXCLUDED.can_edit_default,
             timezone_default = EXCLUDED.timezone_default,
             disabled_at = NULL, updated_at = now()`,
      [randomUUID(), username, card, defaults.canEdit ?? false, defaults.timezone ?? 'UTC'],
    );
  }

  /**
   * Personal account settings. A value is passed: it is saved; `null`: revert to the default;
   * not passed: unchanged.
   */
  async updateProfile(
    userId: string,
    profile: { displayName?: string | null; card?: string | null; timezone?: string | null },
  ): Promise<void> {
    const has = (key: keyof typeof profile) => profile[key] !== undefined;
    await this.database.query(
      `UPDATE users
          SET custom_display_name = CASE WHEN $2 THEN $3 ELSE custom_display_name END,
              custom_card = CASE WHEN $4 THEN $5 ELSE custom_card END,
              custom_timezone = CASE WHEN $6 THEN $7 ELSE custom_timezone END,
              updated_at = now()
        WHERE id = $1`,
      [
        userId,
        has('displayName'),
        profile.displayName ?? null,
        has('card'),
        profile.card ?? null,
        has('timezone'),
        profile.timezone ?? null,
      ],
    );
  }

  /**
   * Sets the editing right. Taking it away is refused (returns false) if it would leave no editor.
   * The users are locked for the check and the update, so two concurrent revocations cannot both pass.
   */
  async setCanEditKeepingEditor(userId: string, canEdit: boolean): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      await tx.query('SELECT id FROM users WHERE disabled_at IS NULL ORDER BY id FOR UPDATE');
      if (!canEdit) {
        const [others] = await tx.query<{ editors: string }>(
          `SELECT count(*) AS editors FROM users u
            WHERE u.disabled_at IS NULL AND u.id <> $1
              AND COALESCE(u.can_edit_override, u.can_edit_default)`,
          [userId],
        );
        if (Number(others?.editors ?? 0) === 0) return false;
      }
      await tx.query('UPDATE users SET can_edit_override = $2, updated_at = now() WHERE id = $1', [
        userId,
        canEdit,
      ]);
      return true;
    });
  }

  /** All enabled users with their effective values. */
  async listUsers(): Promise<AuthUser[]> {
    const rows = await this.database.query<UserRow>(
      `SELECT u.id, u.username, ${EFFECTIVE_USER_COLUMNS}, u.password_hash, u.env_password_hash,
              false AS disabled
         FROM users u WHERE u.disabled_at IS NULL ORDER BY u.username`,
    );
    return rows.map(({ id, username, display_name, card, can_edit, timezone }) => ({
      id,
      username,
      displayName: display_name,
      card,
      canEdit: can_edit,
      timezone,
    }));
  }

  /** Users no longer in the settings are disabled: they will not be able to log in. */
  async disableUsersExcept(usernames: string[]): Promise<void> {
    await this.database.query(
      `UPDATE users SET disabled_at = now(), updated_at = now()
       WHERE disabled_at IS NULL AND NOT (username = ANY($1::text[]))`,
      [usernames],
    );
    await this.database.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE disabled_at IS NOT NULL)`,
    );
  }

  async findUser(username: string): Promise<StoredUser | undefined> {
    const [row] = await this.database.query<UserRow>(
      `SELECT u.id, u.username, ${EFFECTIVE_USER_COLUMNS}, u.password_hash, u.env_password_hash,
              (u.disabled_at IS NOT NULL) AS disabled
       FROM users u WHERE u.username = $1`,
      [username],
    );
    return row && toUser(row);
  }

  /** Remembers which .env password is already accounted for (the user's own password is not changed). */
  async markEnvPassword(userId: string, envPasswordHash: string): Promise<void> {
    await this.database.query('UPDATE users SET env_password_hash = $2 WHERE id = $1', [
      userId,
      envPasswordHash,
    ]);
  }

  /**
   * Saves a new password hash. If the password is set from .env, it also remembers it (`envPasswordHash`).
   * Terminates the user's sessions except `keepSessionId` (on password change the current session stays).
   */
  async setPasswordHash(
    userId: string,
    passwordHash: string,
    options: { envPasswordHash?: string; keepSessionId?: string } = {},
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query(
        `UPDATE users SET password_hash = $2, env_password_hash = COALESCE($3, env_password_hash),
                          updated_at = now()
          WHERE id = $1`,
        [userId, passwordHash, options.envPasswordHash ?? null],
      );
      await tx.query(
        `UPDATE auth_sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)`,
        [userId, options.keepSessionId ?? null],
      );
    });
  }

  async createSession(session: NewSession, context: ClientContext): Promise<void> {
    await this.database.query(
      `INSERT INTO auth_sessions
         (id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, user_agent, ip,
          created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        randomUUID(),
        session.userId,
        session.accessHash,
        session.accessExpiresAt.toISOString(),
        session.refreshHash,
        session.refreshExpiresAt.toISOString(),
        context.userAgent?.slice(0, 300) ?? null,
        context.ip ?? null,
        session.createdAt.toISOString(),
      ],
    );
  }

  /** Active session by access token hash (not revoked, not expired, user not disabled). */
  async findSessionByAccessHash(accessHash: string, now: Date): Promise<StoredSession | undefined> {
    const [row] = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS}, 'current' AS matched
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.access_hash = $1 AND s.revoked_at IS NULL AND s.access_expires_at > $2
         AND u.disabled_at IS NULL`,
      [accessHash, now.toISOString()],
    );
    return row && toSession(row);
  }

  /** Session by refresh token hash: current or previous. Expired and revoked ones are not returned. */
  async findSessionByRefreshHash(refreshHash: string): Promise<StoredSession | undefined> {
    const [row] = await this.database.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS},
              CASE WHEN s.refresh_hash = $1 THEN 'current' ELSE 'previous' END AS matched
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE (s.refresh_hash = $1 OR s.previous_refresh_hash = $1)
         AND s.revoked_at IS NULL AND u.disabled_at IS NULL`,
      [refreshHash],
    );
    return row && toSession(row);
  }

  /** Replaces the session tokens with new ones, remembering the previous refresh token. The condition on the old hash protects against a race. */
  async rotate(
    sessionId: string,
    oldRefreshHash: string,
    next: Omit<NewSession, 'userId' | 'createdAt'>,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.database.query(
      `UPDATE auth_sessions
       SET access_hash = $3, access_expires_at = $4, refresh_hash = $5, refresh_expires_at = $6,
           previous_refresh_hash = refresh_hash, rotated_at = $7, last_used_at = $7
       WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL
       RETURNING 1`,
      [
        sessionId,
        oldRefreshHash,
        next.accessHash,
        next.accessExpiresAt.toISOString(),
        next.refreshHash,
        next.refreshExpiresAt.toISOString(),
        now.toISOString(),
      ],
    );
    return updated.length > 0;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.database.query(
      'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [sessionId],
    );
  }

  /** Deletes sessions whose time has run out (with a margin) and long-revoked ones. */
  async deleteStaleSessions(before: Date): Promise<number> {
    const deleted = await this.database.query(
      `DELETE FROM auth_sessions
       WHERE refresh_expires_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $1)
       RETURNING 1`,
      [before.toISOString()],
    );
    return deleted.length;
  }
}
