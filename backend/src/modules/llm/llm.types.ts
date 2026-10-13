import { AppError } from '../../errors/app-error.ts';

/** An image sent to the model. */
export interface LlmImage {
  bytes: Buffer;
  contentType: string;
}

/** What a task asks the model: instructions, an optional image and the JSON schema of the answer. */
export interface LlmRequest {
  prompt: string;
  image?: LlmImage;
  /** JSON schema of the answer (the Gemini "OpenAPI subset") */
  schema: Record<string, unknown>;
}

export interface LlmCredentials {
  apiKey: string;
  model: string;
}

/**
 * A model provider. This is the only thing the rest of the code knows about a concrete service:
 * a new provider is a new file in `providers/`.
 */
export interface LlmProvider {
  /** Sends the request and returns the answer parsed from JSON (untrusted: the caller validates it). */
  generateJson(request: LlmRequest, credentials: LlmCredentials): Promise<unknown>;
  /** Checks that the key works and the model exists. Throws an LlmError otherwise. */
  check(credentials: LlmCredentials): Promise<void>;
}

/** Errors that are safe to show to the client (never contain the key). */
export const aiDisabled = () =>
  new AppError(409, 'AI_DISABLED', 'Разбор чеков с помощью ИИ выключен');
export const aiCategoryOff = () =>
  new AppError(
    409,
    'AI_CATEGORY_OFF',
    'Для этой категории разбор чеков с помощью ИИ выключен владельцем группы',
  );
export const aiKeyMissing = () =>
  new AppError(409, 'AI_KEY_MISSING', 'API-ключ ИИ не задан администратором');
export const aiKeyInvalid = () =>
  new AppError(
    502,
    'AI_KEY_INVALID',
    'Сервис ИИ не принял API-ключ. Проверьте ключ на странице «Админ»',
  );
export const aiModelNotFound = (model: string) =>
  new AppError(502, 'AI_MODEL_NOT_FOUND', `Сервис ИИ не знает модель «${model}»`);
export const aiUnavailable = () =>
  new AppError(502, 'AI_UNAVAILABLE', 'Сервис ИИ сейчас недоступен. Попробуйте позже');
export const aiBadResponse = () =>
  new AppError(502, 'AI_BAD_RESPONSE', 'Не удалось разобрать ответ ИИ. Заполните вручную');
export const aiLimitReached = () =>
  new AppError(429, 'AI_LIMIT_REACHED', 'Достигнут дневной лимит разбора чеков. Попробуйте завтра');
