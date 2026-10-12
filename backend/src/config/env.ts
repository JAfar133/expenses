import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export interface ConfiguredUser {
  username: string;
  /** Default card (also the display name) */
  card: string;
}

/** `misha:Миша,nastya:Настя` → users and their default cards. */
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
  // Currencies in which expenses can be entered (the base one must come first); the rest are converted to drams
  CURRENCIES: z.string().default('AMD,RUB,USD,EUR').transform(list),
  // Rate source: Central Bank of Armenia JSON, drams per unit of currency
  EXCHANGE_RATES_URL: z.string().url().default('https://cb.am/latest.json.php'),
  EXCHANGE_RATES_REFRESH_HOURS: z.coerce.number().positive().default(6),

  EXCEL_SHEET_NAME: z.string().default('Лист1'),
  EXCEL_TABLE_NAME: z.string().default('Операции'),

  ONEDRIVE_REMOTE: z.string().default('onedrive'),
  // No default, so we never accidentally write to a working file.
  // Unset or empty: Excel is disabled, expenses are stored in the database only.
  ONEDRIVE_FILE_PATH: z
    .string()
    .optional()
    .transform((value) => value?.trim() || undefined),
  RCLONE_CONFIG: z.string().min(1).optional(),
  // daemon — a persistent rclone process (fast), cli — a separate invocation per command
  RCLONE_MODE: z.enum(['daemon', 'cli']).default('daemon'),
  RCLONE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // PostgreSQL: main expense storage, idempotency keys, sync state
  DATABASE_URL: z.string().min(1),

  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // PostgreSQL ↔ Excel sync
  SYNC_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  /** How often to retry while the queue holds records that could not be written to Excel */
  SYNC_RETRY_SECONDS: z.coerce.number().positive().default(60),
  /** What share of records may be marked deleted in one cycle (protection against Excel tampering) */
  SYNC_MAX_DELETE_PERCENT: z.coerce.number().min(1).max(100).default(25),
  /** How long to wait for the Excel write before responding to expense creation */
  SYNC_INLINE_WAIT_SECONDS: z.coerce.number().positive().default(15),

  // App users: login:default card. Passwords are set via AUTH_PASSWORD_<LOGIN> variables
  AUTH_USERS: z.string().default('misha:Миша,nastya:Настя').transform(parseUsers),
  AUTH_MIN_PASSWORD_LENGTH: z.coerce.number().int().min(8).default(8),
  /** Access token lifetime (login cookie) */
  ACCESS_TOKEN_TTL_HOURS: z.coerce.number().positive().default(24),
  /** Refresh token lifetime (it renews the access token without a password) */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().positive().default(7),
  /** Absolute session lifetime limit: after it a password login is required */
  SESSION_MAX_DAYS: z.coerce.number().positive().default(30),
  /** Behind a reverse proxy (Caddy) take the real IP and protocol from X-Forwarded-* */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Additional allowed request origins (Origin), comma-separated */
  ALLOWED_ORIGINS: z.string().default('').transform(list),

  // Logins allowed to edit and delete records (comma-separated)
  // Folder with the status files of the database backup script (mounted read-only); empty: not shown
  DB_BACKUP_STATUS_DIR: z.string().default(''),
  // After how many hours without a good backup the administrator is warned
  DB_BACKUP_MAX_AGE_HOURS: z.coerce.number().int().min(1).default(26),
  EDITOR_USERS: z.string().default('misha').transform(list),
  // Logins of application administrators (manage groups; none by default)
  ADMIN_USERS: z.string().default('').transform(list),
  // Name of the group created for the existing users on the first start
  DEFAULT_GROUP_NAME: z.string().trim().min(1).default('Семья'),
  CARDS: z.string().default('Миша,Настя').transform(list),
  CATEGORIES: z.string().default('кафе,одежда,продукты,жилье,маркетплейс,другое').transform(list),
});

export type Env = z.infer<typeof envSchema>;

/**
 * User passwords from AUTH_PASSWORD_<LOGIN> variables (misha → AUTH_PASSWORD_MISHA).
 * Returns login → password for those who have a password set.
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
