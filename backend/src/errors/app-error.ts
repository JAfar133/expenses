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

export const databaseUnavailableError = (cause?: unknown) =>
  new AppError(503, 'DATABASE_UNAVAILABLE', 'База данных недоступна. Попробуйте позже', { cause });
