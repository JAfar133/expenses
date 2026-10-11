import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, invalidCredentialsError, unauthenticatedError } from '../../errors/app-error.ts';
import { clearAuthCookies, setAuthCookies } from './auth.plugin.ts';
import type { AuthService } from './auth.service.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser } from './auth.types.ts';

const loginSchema = z.object({ username: z.string().max(64), password: z.string().max(2048) });

/** Пользователь для ответа клиенту: без внутреннего идентификатора. */
const publicUser = ({ username, displayName, card }: AuthUser) => ({ username, displayName, card });

export const authRoutes =
  (auth: AuthService): FastifyPluginAsync =>
  async (app) => {
    const isSecure = (request: { protocol: string }) => request.protocol === 'https';

    app.post('/auth/login', { config: { public: true } }, async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      // Не раскрываем, что именно не так с запросом
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
        return { success: true, data: { user: publicUser(user), refreshed: tokens !== undefined } };
      } catch (error) {
        // Токен недействителен: убираем куки, чтобы браузер не слал их снова.
        // При сбое базы куки не трогаем, иначе временная ошибка выбросит пользователя из системы.
        if (error instanceof AppError && error.statusCode === 401) clearAuthCookies(reply);
        throw error;
      }
    });

    app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
      await auth.logout(request.cookies[ACCESS_COOKIE], request.cookies[REFRESH_COOKIE]);
      clearAuthCookies(reply);
      return { success: true };
    });

    app.get('/auth/me', async (request) => ({
      success: true,
      data: { user: publicUser(request.user!) },
    }));
  };
