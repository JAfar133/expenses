import {
  invalidCredentialsError,
  tooManyAttemptsError,
  unauthenticatedError,
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
  /** Абсолютный предел жизни сессии с момента входа */
  sessionMaxMs: number;
  /** Окно, в котором повторное предъявление прежнего refresh-токена считается гонкой двух запросов */
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
  /** undefined — токены уже были обновлены параллельным запросом, куки менять не нужно */
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
   * Приводит пользователей в базе к настройкам: создаёт, обновляет карту, отключает лишних.
   * Пароль из `.env` хешируется и сохраняется, если он новый или изменился (тогда сессии завершаются).
   */
  async syncUsers(
    users: ConfiguredUser[],
    passwords: Map<string, string>,
  ): Promise<{ passwordsUpdated: string[]; withoutPassword: string[] }> {
    for (const [username, password] of passwords) {
      if (password.length < this.config.minPasswordLength) {
        throw new Error(
          `Пароль пользователя ${username} слишком короткий: нужно не меньше ${this.config.minPasswordLength} символов`,
        );
      }
    }

    for (const { username, card } of users) {
      await this.repository.upsertUser(username, card);
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
      const unchanged = user.passwordHash && (await verifyPassword(password, user.passwordHash));
      if (!unchanged) {
        await this.repository.setPasswordHash(user.id, await hashPassword(password));
        result.passwordsUpdated.push(username);
      }
    }
    return result;
  }

  async login(
    username: string,
    password: string,
    context: ClientContext = {},
  ): Promise<LoginResult> {
    const login = username.trim().toLowerCase();

    const wait = this.throttle.retryAfterSeconds(login, context.ip);
    if (wait > 0) throw tooManyAttemptsError(wait);

    const user =
      password.length <= MAX_PASSWORD_LENGTH ? await this.repository.findUser(login) : undefined;
    const usable = user && !user.disabled && user.passwordHash;

    // Для неизвестного пользователя тоже считаем хеш, чтобы время ответа не выдавало, есть ли такой логин
    const matches = await verifyPassword(
      password.slice(0, MAX_PASSWORD_LENGTH),
      usable ? user.passwordHash! : await this.getDummyHash(),
    );

    if (!user || !usable || !matches) {
      this.throttle.recordFailure(login, context.ip);
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

  /** Пользователь по access-токену из куки или undefined, если токена нет, он неверен или истёк. */
  async authenticate(accessToken: string): Promise<AuthUser | undefined> {
    const session = await this.repository.findSessionByAccessHash(
      hashToken(accessToken),
      this.now(),
    );
    return session?.user;
  }

  /**
   * Обновляет токены по refresh-токену. Каждый refresh-токен годится один раз: после обновления прежний
   * считается использованным. Если им воспользуются позже окна гонки, это похоже на кражу, и вся сессия закрывается.
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

    // Параллельный запрос успел обновить сессию раньше: его куки уже у клиента
    return rotated ? { user: session.user, tokens } : { user: session.user };
  }

  async logout(accessToken?: string, refreshToken?: string): Promise<void> {
    const session =
      (accessToken &&
        (await this.repository.findSessionByAccessHash(hashToken(accessToken), this.now()))) ||
      (refreshToken && (await this.repository.findSessionByRefreshHash(hashToken(refreshToken))));
    if (session) await this.repository.revokeSession(session.id);
  }

  /** Удаляет давно истёкшие и отозванные сессии. Возвращает их число. */
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
      accessExpiresAt: new Date(now.getTime() + this.config.accessTtlMs),
      refreshToken: generateToken(),
      refreshExpiresAt: new Date(Math.min(now.getTime() + this.config.refreshTtlMs, sessionEnd)),
    };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword('dummy-password-for-constant-time-checks');
    return this.dummyHash;
  }
}

const publicUser = (user: AuthUser): AuthUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  card: user.card,
});
