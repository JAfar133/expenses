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

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
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
