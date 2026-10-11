import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';

const GENERIC_MESSAGE = 'Не удалось сохранить расход. Попробуйте позже';

/**
 * Save error text. If there is no response, it is unknown whether the request arrived,
 * so we ask the user to check the record to avoid creating a duplicate.
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
