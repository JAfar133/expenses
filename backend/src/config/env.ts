import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export interface ConfiguredUser {
  username: string;
  /** Карта по умолчанию (она же отображаемое имя) */
  card: string;
}

/** `misha:Миша,nastya:Настя` → пользователи и их карты по умолчанию. */
function parseUsers(value: string): ConfiguredUser[] {
  return list(value).map((entry) => {
    const [username, card] = entry.split(':').map((part) => part.trim());
    if (!username || !card || !/^[a-z][a-z0-9_]{1,30}$/.test(username)) {
      throw new Error(
        `AUTH_USERS: некорректная запись «${entry}». Формат: логин:карта, логин из латинских строчных букв, цифр и _`,
      );
    }
    return { username, card };
  });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_TIMEZONE: z.string().default('Asia/Yerevan'),
  DEFAULT_CURRENCY: z.string().default('AMD'),
  // Валюты, в которых можно вводить расходы (первой должна быть базовая); остальные пересчитываются в драммы
  CURRENCIES: z.string().default('AMD,RUB,USD,EUR').transform(list),
  // Источник курсов: JSON ЦБ Армении, драммы за единицу валюты
  EXCHANGE_RATES_URL: z.string().url().default('https://cb.am/latest.json.php'),
  EXCHANGE_RATES_REFRESH_HOURS: z.coerce.number().positive().default(6),

  EXCEL_SHEET_NAME: z.string().default('Лист1'),
  EXCEL_TABLE_NAME: z.string().default('Операции'),

  ONEDRIVE_REMOTE: z.string().default('onedrive'),
  // Без значения по умолчанию, чтобы случайно не писать в рабочий файл.
  // Не задан или пуст: работа с Excel отключена, расходы хранятся только в базе.
  ONEDRIVE_FILE_PATH: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  RCLONE_CONFIG: z.string().min(1).optional(),
  // daemon — постоянный процесс rclone (быстро), cli — отдельный запуск на каждую команду
  RCLONE_MODE: z.enum(['daemon', 'cli']).default('daemon'),
  RCLONE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // PostgreSQL: основное хранилище расходов, ключи идемпотентности, состояние синхронизации
  DATABASE_URL: z.string().min(1),

  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Синхронизация PostgreSQL ↔ Excel
  SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  /** Как часто повторять, пока в очереди есть записи, которые не удалось записать в Excel */
  SYNC_RETRY_SECONDS: z.coerce.number().positive().default(60),
  /** Какую долю записей можно пометить удалёнными за один цикл (защита от подмены Excel) */
  SYNC_MAX_DELETE_PERCENT: z.coerce.number().min(1).max(100).default(25),
  /** Сколько ждать записи в Excel перед ответом на создание расхода */
  SYNC_INLINE_WAIT_SECONDS: z.coerce.number().positive().default(15),

  // Пользователи приложения: логин:карта по умолчанию. Пароли задаются переменными AUTH_PASSWORD_<ЛОГИН>
  AUTH_USERS: z.string().default('misha:Миша,nastya:Настя').transform(parseUsers),
  AUTH_MIN_PASSWORD_LENGTH: z.coerce.number().int().min(8).default(8),
  /** Сколько живёт access-токен (кука входа) */
  ACCESS_TOKEN_TTL_HOURS: z.coerce.number().positive().default(24),
  /** Сколько живёт refresh-токен (по нему access обновляется без пароля) */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(7),
  /** Абсолютный предел жизни сессии: после него нужен вход по паролю */
  SESSION_MAX_DAYS: z.coerce.number().positive().default(30),
  /** За обратным прокси (Caddy) берём реальный IP и протокол из X-Forwarded-* */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Дополнительные допустимые источники запросов (Origin), через запятую */
  ALLOWED_ORIGINS: z.string().default('').transform(list),

  // Логины, которым можно править и удалять записи (через запятую)
  EDITOR_USERS: z.string().default('misha').transform(list),
  CARDS: z.string().default('Миша,Настя').transform(list),
  CATEGORIES: z.string().default('кафе,одежда,продукты,жилье,маркетплейс,другое').transform(list),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Пароли пользователей из переменных AUTH_PASSWORD_<ЛОГИН> (misha → AUTH_PASSWORD_MISHA).
 * Возвращает логин → пароль для тех, у кого пароль задан.
 */
export function readUserPasswords(
  users: ConfiguredUser[],
  source: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const passwords = new Map<string, string>();
  for (const { username } of users) {
    const password = source[`AUTH_PASSWORD_${username.toUpperCase()}`];
    if (password) passwords.set(username, password);
  }
  return passwords;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
