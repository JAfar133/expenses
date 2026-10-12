import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';

/** The server's Russian message for known errors; a calm fallback for everything else. */
export function toErrorMessage(error: unknown, fallback = 'Не удалось выполнить действие'): string {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR_CODE) return 'Не удалось связаться с сервером';
    if (error.status >= 400 && error.status < 500) return error.message;
  }
  return fallback;
}
