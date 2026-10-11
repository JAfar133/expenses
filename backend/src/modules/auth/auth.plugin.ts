import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { forbiddenOriginError, unauthenticatedError } from '../../errors/app-error.ts';
import type { AuthService } from './auth.service.ts';
import { ACCESS_COOKIE, REFRESH_COOKIE, type AuthUser, type TokenPair } from './auth.types.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The user logged in to the app (present on all routes except public ones) */
    user?: AuthUser;
  }
  interface FastifyContextConfig {
    /** The route is accessible without login */
    public?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthPluginOptions {
  auth: AuthService;
  /** Additional allowed request origins, e.g. https://expenses.example.com */
  allowedOrigins?: string[];
}

/**
 * Registers cookie parsing and two checks for all routes:
 *   1. CSRF protection: state-changing requests must come from our own site (Origin header);
 *   2. login: without a valid access token only public routes remain accessible.
 *
 * Wrapped in fastify-plugin so the hooks apply to the whole server, not only inside the plugin.
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

/** The request origin (Origin or, if absent, Referer) must match the site address. */
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

/** Login cookies: HttpOnly (not accessible to scripts), SameSite=Lax; Secure when the site is opened over HTTPS. */
export function setAuthCookies(reply: FastifyReply, tokens: TokenPair, secure: boolean): void {
  const base = { httpOnly: true, sameSite: 'lax', secure } as const;
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/api',
    expires: tokens.accessExpiresAt,
  });
  // The refresh token is sent only to /api/auth addresses, so it does not travel with every request
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
