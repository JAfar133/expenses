import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';

const GENERIC_MESSAGE = 'Не удалось сохранить расход. Попробуйте позже';

const INVALID_CARD_MESSAGE =
  'Не удалось определить карту. Укажите карту по умолчанию в «Настройки» или выберите её в форме';

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
    if (error.code === 'INVALID_CARD') return INVALID_CARD_MESSAGE;
    return error.message;
  }
  return GENERIC_MESSAGE;
}
