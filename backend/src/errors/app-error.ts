/** Ошибка с HTTP-статусом и кодом, которую можно безопасно показать клиенту. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export const validationError = (code: string, message: string) => new AppError(422, code, message);

export const conflictError = (cause?: unknown) =>
  new AppError(409, 'CONFLICT', 'Таблица была изменена. Расход не добавлен. Повторите попытку', {
    cause,
  });

/** Файл открыт в Excel и заблокирован OneDrive. Запись не выполнялась. */
export const fileLockedError = (cause?: unknown) =>
  new AppError(
    423,
    'FILE_LOCKED',
    'Файл сейчас открыт в Excel и заблокирован. Закройте его и повторите попытку',
    { cause },
  );

export const storageUnavailableError = (cause?: unknown) =>
  new AppError(503, 'STORAGE_UNAVAILABLE', 'OneDrive недоступен. Попробуйте позже', { cause });

/** Результат записи неизвестен: клиент не должен повторять запрос автоматически. */
export const writeStatusUnknownError = (cause?: unknown) =>
  new AppError(
    500,
    'WRITE_STATUS_UNKNOWN',
    'Не удалось подтвердить сохранение. Проверьте таблицу перед повторной отправкой',
    { cause },
  );
