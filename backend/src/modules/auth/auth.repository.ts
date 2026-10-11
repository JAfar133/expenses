import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database/database.ts';
import { timestampText } from '../../infrastructure/database/sql.ts';
import type { AuthUser, ClientContext } from './auth.types.ts';

export interface StoredUser extends AuthUser {
  passwordHash: string | null;
  /** Хеш последнего применённого пароля из .env (см. миграцию 0007) */
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
  /** Какой из хешей совпал: текущий refresh-токен или предыдущий (уже заменённый) */
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

/** Значения, которые видит приложение: личный выбор пользователя поверх значений из конфигурации. */
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

/** Новая сессия. Время создания задаёт сервис (его часы), от него отсчитывается предел жизни сессии. */
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
   * Создаёт или обновляет пользователя из настроек (карта, часовой пояс и право правки «по умолчанию»).
   * Личный выбор пользователя (custom_*) и пароль не трогает.
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
   * Личные настройки аккаунта. Передано значение: сохраняется; `null`: возврат к значению по умолчанию;
   * не передано: не меняется.
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

  async setCanEditOverride(userId: string, canEdit: boolean): Promise<void> {
    await this.database.query(
      'UPDATE users SET can_edit_override = $2, updated_at = now() WHERE id = $1',
      [userId, canEdit],
    );
  }

  /** Все включённые пользователи с их эффективными значениями. */
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

  /** Пользователи, которых больше нет в настройках, отключаются: войти они не смогут. */
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

  /** Запоминает, какой пароль из .env уже учтён (сам пароль пользователя не меняется). */
  async markEnvPassword(userId: string, envPasswordHash: string): Promise<void> {
    await this.database.query('UPDATE users SET env_password_hash = $2 WHERE id = $1', [
      userId,
      envPasswordHash,
    ]);
  }

  /**
   * Сохраняет новый хеш пароля. Если пароль задан из .env, запоминает и его (`envPasswordHash`).
   * Завершает сессии пользователя, кроме `keepSessionId` (при смене пароля текущая сессия остаётся).
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

  /** Действующая сессия по хешу access-токена (не отозвана, не истекла, пользователь не отключён). */
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

  /** Сессия по хешу refresh-токена: текущего или предыдущего. Истёкшие и отозванные не возвращаются. */
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

  /** Заменяет токены сессии новыми, запоминая прежний refresh-токен. Условие по старому хешу защищает от гонки. */
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

  /** Удаляет сессии, срок которых вышел (с запасом), и давно отозванные. */
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
