/** Error with an HTTP status and code that is safe to show to the client. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    options?: { cause?: unknown; headers?: Record<string, string> },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.headers = options?.headers;
  }

  /** Additional response headers, e.g. Retry-After */
  readonly headers?: Record<string, string>;
}

export const validationError = (code: string, message: string) => new AppError(422, code, message);

export const databaseUnavailableError = (cause?: unknown) =>
  new AppError(503, 'DATABASE_UNAVAILABLE', 'База данных недоступна. Попробуйте позже', { cause });

export const unauthenticatedError = () => new AppError(401, 'UNAUTHENTICATED', 'Требуется вход');

export const invalidCredentialsError = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');

export const tooManyAttemptsError = (retryAfterSeconds: number) =>
  new AppError(
    429,
    'TOO_MANY_ATTEMPTS',
    `Слишком много попыток входа. Повторите через ${Math.ceil(retryAfterSeconds / 60)} мин.`,
    { headers: { 'Retry-After': String(retryAfterSeconds) } },
  );

export const forbiddenError = () =>
  new AppError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия');

export const notFoundError = () => new AppError(404, 'NOT_FOUND', 'Запись не найдена');

export const forbiddenOriginError = () =>
  new AppError(403, 'FORBIDDEN_ORIGIN', 'Запрос отклонён: недопустимый источник');
