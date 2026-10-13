import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  AppError,
  forbiddenError,
  invalidCredentialsError,
  unauthenticatedError,
  validationError,
} from '../../errors/app-error.ts';
import { clearAuthCookies, setAuthCookies } from './auth.plugin.ts';
import type { AuthService } from './auth.service.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser } from './auth.types.ts';

const passwordSchema = z.object({
  currentPassword: z.string().max(2048),
  newPassword: z.string().max(2048),
});

const loginSchema = z.object({ username: z.string().max(64), password: z.string().max(2048) });

/** User for the client response: without the internal identifier. */
const publicUser = ({
  username,
  displayName,
  card,
  canEdit,
  timezone,
  defaultTimezone,
  role,
  isAdmin,
}: AuthUser) => ({
  username,
  displayName,
  card,
  /** Whether the user can edit and delete records */
  canEdit,
  timezone,
  defaultTimezone,
  role,
  isAdmin,
});

/** The time zone must exist: checked the same way Node itself will parse it. */
const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Personal settings; `null` restores the default value. The allowed card is defined by the app's card list. */
const profileSchema = (cards: string[]) =>
  z
    .object({
      displayName: z
        .string({ error: 'Введите имя' })
        .trim()
        .min(1, 'Введите имя')
        .max(40, 'Имя не длиннее 40 символов')
        .nullable(),
      card: z
        .string()
        .refine((card) => cards.includes(card), 'Выберите карту из списка')
        .nullable(),
      timezone: z.string().max(64).refine(isTimeZone, 'Неизвестный часовой пояс').nullable(),
    })
    .partial()
    .strict();

const rightsSchema = z.object({ canEdit: z.boolean() }).strict();

export const authRoutes =
  (
    auth: AuthService,
    /** Cards the user may choose as the default one (the cards of their group) */
    cardsOf: (user: AuthUser) => Promise<string[]> = async () => [],
  ): FastifyPluginAsync =>
  async (app) => {
    const isSecure = (request: { protocol: string }) => request.protocol === 'https';

    app.post('/auth/login', { config: { public: true } }, async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      // We do not reveal what exactly is wrong with the request
      if (!body.success) throw invalidCredentialsError();

      const { user, tokens } = await auth.login(body.data.username, body.data.password, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      setAuthCookies(reply, tokens, isSecure(request));
      request.log.info(
        { operation: 'auth.login', userId: user.id, username: user.username },
        'User logged in',
      );
      return { success: true, data: { user: publicUser(user) } };
    });

    app.post('/auth/refresh', { config: { public: true } }, async (request, reply) => {
      const refreshToken = request.cookies[REFRESH_COOKIE];
      if (!refreshToken) throw unauthenticatedError();

      try {
        const { user, tokens } = await auth.refresh(refreshToken);
        if (tokens) setAuthCookies(reply, tokens, isSecure(request));
        return {
          success: true,
          data: { user: publicUser(user), refreshed: tokens !== undefined },
        };
      } catch (error) {
        // The token is invalid: clear the cookies so the browser does not send them again.
        // On a database failure we leave the cookies alone, otherwise a temporary error would log the user out.
        if (error instanceof AppError && error.statusCode === 401) clearAuthCookies(reply);
        throw error;
      }
    });

    app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
      await auth.logout(request.cookies[ACCESS_COOKIE], request.cookies[REFRESH_COOKIE]);
      clearAuthCookies(reply);
      return { success: true };
    });

    /** Password change by the user themselves; their other sessions are closed. */
    app.post('/auth/password', async (request) => {
      const body = passwordSchema.safeParse(request.body);
      if (!body.success) {
        throw validationError('INVALID_PASSWORD_REQUEST', 'Укажите текущий и новый пароль');
      }

      await auth.changePassword(
        request.user!,
        request.cookies[ACCESS_COOKIE],
        body.data.currentPassword,
        body.data.newPassword,
        { ip: request.ip, userAgent: request.headers['user-agent'] },
      );
      request.log.info(
        { operation: 'auth.password', userId: request.user!.id, username: request.user!.username },
        'Password changed',
      );
      return { success: true };
    });

    /** Personal account settings: name, default card, time zone. */
    app.patch('/auth/profile', async (request) => {
      const parsed = profileSchema(await cardsOf(request.user!)).safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0]!;
        throw validationError('INVALID_PROFILE', issue.message);
      }
      if (Object.keys(parsed.data).length === 0) {
        throw validationError('NOTHING_TO_UPDATE', 'Не указано, что изменить');
      }

      const user = await auth.updateProfile(request.user!, parsed.data);
      request.log.info(
        { operation: 'auth.profile', userId: user.id, fields: Object.keys(parsed.data) },
        'Profile updated',
      );
      return { success: true, data: { user: publicUser(user) } };
    });

    /** Users and their permissions: visible to editors only. */
    app.get('/users', async (request) => {
      if (!request.user!.canEdit) throw forbiddenError();
      return {
        success: true,
        data: (await auth.listUsers(request.user!)).map(({ username, displayName, canEdit }) => ({
          username,
          displayName,
          canEdit,
        })),
      };
    });

    app.put('/users/:username/rights', async (request) => {
      const body = rightsSchema.safeParse(request.body);
      if (!body.success) throw validationError('INVALID_RIGHTS', 'Укажите canEdit: true или false');

      const username = String(
        (request.params as { username?: string }).username ?? '',
      ).toLowerCase();
      const user = await auth.setUserRights(request.user!, username, body.data.canEdit);
      request.log.info(
        {
          operation: 'auth.rights',
          actor: request.user!.username,
          username,
          canEdit: user.canEdit,
        },
        'Rights changed',
      );
      return { success: true, data: { username: user.username, canEdit: user.canEdit } };
    });

    app.get('/auth/me', async (request) => ({
      success: true,
      data: { user: publicUser(request.user!) },
    }));
  };
