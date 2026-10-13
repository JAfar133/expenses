import {
  AppError,
  forbiddenError,
  invalidCredentialsError,
  notFoundError,
  tooManyAttemptsError,
  unauthenticatedError,
  validationError,
} from '../../errors/app-error.ts';
import type { ConfiguredUser } from '../../config/env.ts';
import { AuthRepository, type StoredSession } from './auth.repository.ts';
import type { AuthUser, ClientContext, TokenPair } from './auth.types.ts';
import { LoginThrottle } from './login-throttle.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { generateToken, hashToken } from './tokens.ts';

export interface AuthConfig {
  accessTtlMs: number;
  refreshTtlMs: number;
  /** Absolute session lifetime limit since login */
  sessionMaxMs: number;
  /** Window in which re-presenting the previous refresh token is treated as a race of two requests */
  rotationGraceMs: number;
  minPasswordLength: number;
}

export interface AuthDeps {
  repository: AuthRepository;
  config: AuthConfig;
  throttle?: LoginThrottle;
  now?: () => Date;
  logger?: { warn: (fields: object, message: string) => void };
}

export interface LoginResult {
  user: AuthUser;
  tokens: TokenPair;
}

export interface RefreshResult {
  user: AuthUser;
  /** undefined — the tokens were already refreshed by a concurrent request, no need to change cookies */
  tokens?: TokenPair;
}

const MAX_PASSWORD_LENGTH = 1024;

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly config: AuthConfig;
  private readonly throttle: LoginThrottle;
  private readonly now: () => Date;
  private dummyHash?: Promise<string>;

  constructor(private readonly deps: AuthDeps) {
    this.repository = deps.repository;
    this.config = deps.config;
    this.throttle = deps.throttle ?? new LoginThrottle();
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Brings the users in the database in line with the settings: creates, updates the card, disables extras.
   * A password from `.env` is hashed and saved if it is new or has changed (then sessions are terminated).
   */
  async syncUsers(
    users: ConfiguredUser[],
    passwords: Map<string, string>,
    /** Defaults from the configuration: who can edit and the time zone. The user's personal choice overrides them. */
    defaults: { editors?: string[]; timezone?: string } = {},
  ): Promise<{ passwordsUpdated: string[]; withoutPassword: string[] }> {
    for (const [username, password] of passwords) {
      if (password.length < this.config.minPasswordLength) {
        throw new Error(
          `Пароль пользователя ${username} слишком короткий: нужно не меньше ${this.config.minPasswordLength} символов`,
        );
      }
    }

    for (const { username, card } of users) {
      await this.repository.upsertUser(username, card, {
        canEdit: defaults.editors?.includes(username) ?? false,
        timezone: defaults.timezone,
      });
    }
    await this.repository.disableUsersExcept(users.map((user) => user.username));

    const result = { passwordsUpdated: [] as string[], withoutPassword: [] as string[] };
    for (const { username } of users) {
      const user = await this.repository.findUser(username);
      const password = passwords.get(username);
      if (!user) continue;

      if (!password) {
        if (!user.passwordHash) result.withoutPassword.push(username);
        continue;
      }
      // The .env password has not changed since the last start: keep what the user has now (they may have changed it themselves)
      if (user.envPasswordHash && (await verifyPassword(password, user.envPasswordHash))) continue;

      if (user.passwordHash && (await verifyPassword(password, user.passwordHash))) {
        // The password in the database is already the same: just remember that .env is accounted for
        await this.repository.markEnvPassword(user.id, user.passwordHash);
        continue;
      }
      // .env is new or changed: the administrator sets (resets) the password
      const hash = await hashPassword(password);
      await this.repository.setPasswordHash(user.id, hash, { envPasswordHash: hash });
      result.passwordsUpdated.push(username);
    }
    return result;
  }

  async login(
    username: string,
    password: string,
    context: ClientContext = {},
  ): Promise<LoginResult> {
    const login = username.trim().toLowerCase();

    // The attempt is counted before the password check: parallel requests cannot bypass the limit
    const wait = this.throttle.reserve(login, context.ip);
    if (wait > 0) throw tooManyAttemptsError(wait);

    const user =
      password.length <= MAX_PASSWORD_LENGTH ? await this.repository.findUser(login) : undefined;
    const usable = user && !user.disabled && user.passwordHash;

    // For an unknown user we also compute a hash, so the response time does not reveal whether such a login exists
    const matches = await verifyPassword(
      password.slice(0, MAX_PASSWORD_LENGTH),
      usable ? user.passwordHash! : await this.getDummyHash(),
    );

    if (!user || !usable || !matches) {
      throw invalidCredentialsError();
    }

    this.throttle.recordSuccess(login, context.ip);
    const now = this.now();
    const tokens = this.issueTokens(now, now);
    await this.repository.createSession(
      {
        userId: user.id,
        accessHash: hashToken(tokens.accessToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshHash: hashToken(tokens.refreshToken),
        refreshExpiresAt: tokens.refreshExpiresAt,
        createdAt: now,
      },
      context,
    );
    return { user: publicUser(user), tokens };
  }

  /** User by the access token from the cookie, or undefined if there is no token, it is invalid or expired. */
  async authenticate(accessToken: string): Promise<AuthUser | undefined> {
    const session = await this.repository.findSessionByAccessHash(
      hashToken(accessToken),
      this.now(),
    );
    return session?.user;
  }

  /**
   * Refreshes tokens by the refresh token. Each refresh token is good once: after refresh the previous one
   * is considered used. If it is presented after the race window, this looks like theft and the whole session is closed.
   */
  async refresh(refreshToken: string): Promise<RefreshResult> {
    const oldHash = hashToken(refreshToken);
    const session = await this.repository.findSessionByRefreshHash(oldHash);
    if (!session) throw unauthenticatedError();

    const now = this.now();
    if (session.matched === 'previous') {
      return this.handlePreviousToken(session, now);
    }

    const expired =
      session.refreshExpiresAt <= now ||
      now.getTime() - session.createdAt.getTime() > this.config.sessionMaxMs;
    if (expired) {
      await this.repository.revokeSession(session.id);
      throw unauthenticatedError();
    }

    const tokens = this.issueTokens(now, session.createdAt);
    const rotated = await this.repository.rotate(
      session.id,
      oldHash,
      {
        accessHash: hashToken(tokens.accessToken),
        accessExpiresAt: tokens.accessExpiresAt,
        refreshHash: hashToken(tokens.refreshToken),
        refreshExpiresAt: tokens.refreshExpiresAt,
      },
      now,
    );

    // A concurrent request managed to refresh the session first: its cookies are already with the client
    return rotated ? { user: session.user, tokens } : { user: session.user };
  }

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const session =
      (accessToken &&
        (await this.repository.findSessionByAccessHash(hashToken(accessToken), this.now()))) ||
      (refreshToken && (await this.repository.findSessionByRefreshHash(hashToken(refreshToken))));
    if (session) await this.repository.revokeSession(session.id);
  }

  /**
   * Password change by the user themselves. The current password is checked and counted in the brute-force protection:
   * a stolen session cannot be used to guess the password. The user's other sessions are closed, the current one stays.
   */
  async changePassword(
    user: AuthUser,
    accessToken: string | undefined,
    currentPassword: string,
    newPassword: string,
    context: ClientContext = {},
  ): Promise<void> {
    const wait = this.throttle.reserve(user.username, context.ip);
    if (wait > 0) throw tooManyAttemptsError(wait);

    const stored = await this.repository.findUser(user.username);
    const matches =
      currentPassword.length <= MAX_PASSWORD_LENGTH &&
      !!stored?.passwordHash &&
      (await verifyPassword(currentPassword, stored.passwordHash));
    if (!stored || !matches) {
      throw validationError('INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно');
    }
    this.throttle.recordSuccess(user.username, context.ip);

    if (newPassword.length < this.config.minPasswordLength) {
      throw validationError(
        'WEAK_PASSWORD',
        `Новый пароль слишком короткий: нужно не меньше ${this.config.minPasswordLength} символов`,
      );
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      throw validationError('WEAK_PASSWORD', 'Новый пароль слишком длинный');
    }
    if (newPassword === currentPassword) {
      throw validationError('SAME_PASSWORD', 'Новый пароль совпадает с текущим');
    }

    const session = accessToken
      ? await this.repository.findSessionByAccessHash(hashToken(accessToken), this.now())
      : undefined;
    await this.repository.setPasswordHash(stored.id, await hashPassword(newPassword), {
      keepSessionId: session?.id,
    });
  }

  /**
   * Personal account settings: name, default card, time zone. `null` restores the default value.
   * The caller validates the values (card from the list, existing time zone).
   */
  async updateProfile(
    user: AuthUser,
    profile: { displayName?: string | null; card?: string | null; timezone?: string | null },
  ): Promise<AuthUser> {
    await this.repository.updateProfile(user.id, profile);
    const stored = await this.repository.findUser(user.username);
    return publicUser(stored!);
  }

  /** Members of the actor's group: the others are not visible to them. */
  listUsers(actor: AuthUser): Promise<AuthUser[]> {
    return actor.groupId ? this.repository.listGroupUsers(actor.groupId) : Promise.resolve([]);
  }

  /**
   * Permission to edit and delete records. Only editors can change it; the last editor cannot be stripped of the permission,
   * otherwise no one would be left to manage permissions.
   */
  async setUserRights(actor: AuthUser, username: string, canEdit: boolean): Promise<AuthUser> {
    if (!actor.canEdit) throw forbiddenError();

    const target = await this.repository.findUser(username);
    if (!target || target.disabled || !actor.groupId || target.groupId !== actor.groupId) {
      throw notFoundError();
    }

    const done = await this.repository.setRoleKeepingOwner(target.id, canEdit ? 'owner' : 'member');
    if (!done) {
      throw new AppError(
        409,
        'LAST_EDITOR',
        'Нельзя убрать право у последнего редактора: управлять правами будет некому',
      );
    }
    return publicUser((await this.repository.findUser(username))!);
  }

  /** Deletes long-expired and revoked sessions. Returns their count. */
  deleteStaleSessions(): Promise<number> {
    return this.repository.deleteStaleSessions(new Date(this.now().getTime() - 24 * 3_600_000));
  }

  private async handlePreviousToken(session: StoredSession, now: Date): Promise<RefreshResult> {
    const sinceRotation = session.rotatedAt
      ? now.getTime() - session.rotatedAt.getTime()
      : Infinity;
    if (sinceRotation <= this.config.rotationGraceMs) {
      return { user: session.user };
    }

    await this.repository.revokeSession(session.id);
    this.deps.logger?.warn(
      { operation: 'auth.refresh_reuse', userId: session.user.id, sessionId: session.id },
      'Old refresh token reused: session revoked',
    );
    throw unauthenticatedError();
  }

  private issueTokens(now: Date, sessionCreatedAt: Date): TokenPair {
    const sessionEnd = sessionCreatedAt.getTime() + this.config.sessionMaxMs;
    return {
      accessToken: generateToken(),
      accessExpiresAt: new Date(Math.min(now.getTime() + this.config.accessTtlMs, sessionEnd)),
      refreshToken: generateToken(),
      refreshExpiresAt: new Date(Math.min(now.getTime() + this.config.refreshTtlMs, sessionEnd)),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('dummy-password-for-constant-time-checks');
    return this.dummyHash;
  }
}

/** User without internal fields (password hashes, etc.): only these fields go outside. */
const publicUser = (user: AuthUser): AuthUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  card: user.card,
  canEdit: user.canEdit,
  timezone: user.timezone,
  defaultTimezone: user.defaultTimezone,
  groupId: user.groupId,
  role: user.role,
  isAdmin: user.isAdmin,
});
