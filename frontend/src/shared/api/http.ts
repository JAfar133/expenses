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

/** Нет ответа от сервера: запрос мог дойти, а мог и нет. */
export const NETWORK_ERROR_CODE = 'NETWORK';

/** Эти запросы сами отвечают за вход: обновлять по ним токен и повторять запрос бессмысленно. */
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout'];

let refreshInFlight: Promise<void> | undefined;
let sessionLostHandler: (() => void) | undefined;

/** Вызывается, когда вход потерян окончательно (refresh-токен недействителен): пора показать форму входа. */
export function onSessionLost(handler: (() => void) | undefined): void {
  sessionLostHandler = handler;
}

async function execute<T>(path: string, init: RequestInit): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // Заголовок только для запросов с телом: Fastify отвечает 400 на JSON-запрос без тела
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
 * Обновляет токены по refresh-куке. Параллельные запросы, получившие 401 одновременно, ждут один общий
 * запрос на обновление: иначе они «сжигали» бы refresh-токен друг у друга.
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
    // Отказ сервера (401) значит, что вход потерян. Сбой сети вход не отменяет.
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

    // Access-токен истёк (живёт сутки): тихо получаем новый и повторяем запрос один раз
    await refreshSession();
    return execute<T>(path, init);
  }
}
