export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

/** No response from the server: the request may or may not have arrived. */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** These requests handle authentication themselves: refreshing the token and retrying on them is pointless. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshInFlight: Promise<void> | undefined;
let sessionLostHandler: (() => void) | undefined;

/** Called when sign-in is lost for good (refresh token invalid): time to show the login form. */
export function onSessionLost(handler: (() => void) | undefined): void {
  sessionLostHandler = handler;
}

async function execute<T>(path: string, init: RequestInit): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // Header only for requests with a body: Fastify answers 400 to a JSON request without a body
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR_CODE, 'Нет соединения с сервером');
  }

  const body = await response.json().catch(() => null);

  if (!response.ok || body?.success === false) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Неизвестная ошибка сервера',
    );
  }
  return body as ApiSuccess<T>;
}

/**
 * Refreshes tokens via the refresh cookie. Parallel requests that got 401 simultaneously wait for one shared
 * refresh request: otherwise they would burn each other's refresh token.
 */
async function refreshSession(): Promise<void> {
  refreshInFlight ??= execute('/auth/refresh', { method: 'POST' })
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = undefined;
    });

  try {
    await refreshInFlight;
  } catch (error) {
    // A server rejection (401) means sign-in is lost. A network failure does not cancel sign-in.
    if (error instanceof ApiError && error.status === 401) sessionLostHandler?.();
    throw error;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
  try {
    return await execute<T>(path, init);
  } catch (error) {
    const expired = error instanceof ApiError && error.status === 401;
    if (!expired || AUTH_ENDPOINTS.some((endpoint) => path.startsWith(endpoint))) throw error;

    // The access token expired (lives a day): quietly get a new one and retry the request once
    await refreshSession();
    return execute<T>(path, init);
  }
}
