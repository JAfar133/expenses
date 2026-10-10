import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';

const GENERIC_MESSAGE = 'Не удалось сохранить расход. Попробуйте позже';

/**
 * Текст ошибки сохранения. Если ответа нет, неизвестно, дошёл ли запрос,
 * поэтому просим проверить запись, чтобы не создать дубль.
 */
export function toSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR_CODE) {
      return 'Не получили ответ сервера. Проверьте, добавился ли расход, прежде чем отправлять снова';
    }
    if (error.status >= 500 && error.code === 'INTERNAL_ERROR') {
      return GENERIC_MESSAGE;
    }
    return error.message;
  }
  return GENERIC_MESSAGE;
}
