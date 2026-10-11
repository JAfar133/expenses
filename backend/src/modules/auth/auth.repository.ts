import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database/database.ts';
import { timestampText } from '../../infrastructure/database/sql.ts';
import type { AuthUser, ClientContext } from './auth.types.ts';

export interface StoredUser extends AuthUser {
  passwordHash: string | null;
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
  password_hash: string | null;
  disabled: boolean;
}

interface SessionRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  card: string;
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
  passwordHash: row.password_hash,
  disabled: row.disabled,
});

const SESSION_COLUMNS = `
  s.id, s.user_id, u.username, u.display_name, u.card,
  ${timestampText('s.access_expires_at')} AS access_expires_at,
  ${timestampText('s.refresh_expires_at')} AS refresh_expires_at,
  ${timestampText('s.created_at')} AS created_at,
  ${timestampText('s.rotated_at')} AS rotated_at`;

const toSession = (row: SessionRow): StoredSession => ({
  id: row.id,
  user: { id: row.user_id, username: row.username, displayName: row.display_name, card: row.card },
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

  /** Создаёт или обновляет пользователя из настроек. Пароль не трогает. */
  async upsertUser(username: string, card: string): Promise<void> {
    await this.database.query(
      `INSERT INTO users (id, username, display_name, card)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (username) DO UPDATE
         SET display_name = EXCLUDED.display_name, card = EXCLUDED.card,
             disabled_at = NULL, updated_at = now()`,
      [randomUUID(), username, card],
    );
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
      `SELECT id, username, display_name, card, password_hash, (disabled_at IS NOT NULL) AS disabled
       FROM users WHERE username = $1`,
      [username],
    );
    return row && toUser(row);
  }

  /** Сохраняет хеш пароля и завершает все сессии пользователя. */
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
        userId,
        passwordHash,
      ]);
      await tx.query(
        'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
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
