import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forbiddenOriginError, unauthenticatedError } from '../../errors/app-error.ts';
import type { AuthService } from './auth.service.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser, type TokenPair } from './auth.types.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Пользователь, вошедший в приложение (есть у всех маршрутов, кроме публичных) */
    user?: AuthUser;
  }
  interface FastifyContextConfig {
    /** Маршрут доступен без входа */
    public?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthPluginOptions {
  auth: AuthService;
  /** Дополнительные допустимые источники запросов, например https://expenses.example.com */
  allowedOrigins?: string[];
}

/**
 * Подключает разбор кук и две проверки для всех маршрутов:
 *   1. защита от CSRF: изменяющие запросы должны приходить с нашего же сайта (заголовок Origin);
 *   2. вход: без действующего access-токена остаются доступны только публичные маршруты.
 *
 * Обёрнут в fastify-plugin, чтобы хуки действовали на весь сервер, а не только внутри плагина.
 */
export const authPlugin = fp(
  async (app: FastifyInstance, options: AuthPluginOptions) => {
    await app.register(fastifyCookie);

    app.addHook('onRequest', async (request) => {
      if (
        !SAFE_METHODS.has(request.method) &&
        !isAllowedOrigin(request, options.allowedOrigins ?? [])
      ) {
        throw forbiddenOriginError();
      }
    });

    app.addHook('onRequest', async (request) => {
      if (request.routeOptions.config?.public) return;

      const token = request.cookies[ACCESS_COOKIE];
      const user = token ? await options.auth.authenticate(token) : undefined;
      if (!user) throw unauthenticatedError();
      request.user = user;
    });
  },
  { name: 'auth' },
);

/** Источник запроса (Origin или, если его нет, Referer) должен совпадать с адресом сайта. */
export function isAllowedOrigin(request: FastifyRequest, allowedOrigins: string[]): boolean {
  const source = request.headers.origin ?? request.headers.referer;
  if (!source) return false;

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  if (allowedOrigins.includes(url.origin)) return true;

  return url.host === stripDefaultPort(request.host);
}

const stripDefaultPort = (host: string) => host.toLowerCase().replace(/:(80|443)$/, '');

/** Куки входа: HttpOnly (недоступны скриптам), SameSite=Lax; Secure, когда сайт открыт по HTTPS. */
export function setAuthCookies(reply: FastifyReply, tokens: TokenPair, secure: boolean): void {
  const base = { httpOnly: true, sameSite: 'lax', secure } as const;
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/api',
    expires: tokens.accessExpiresAt,
  });
  // Refresh-токен отправляется только на адреса /api/auth, чтобы не ездить с каждым запросом
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: '/api/auth',
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/api' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
