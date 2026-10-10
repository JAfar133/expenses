import { z } from 'zod';

const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_TIMEZONE: z.string().default('Asia/Yerevan'),
  DEFAULT_CURRENCY: z.string().default('AMD'),

  EXCEL_SHEET_NAME: z.string().default('Лист1'),
  EXCEL_TABLE_NAME: z.string().default('Операции'),

  ONEDRIVE_REMOTE: z.string().default('onedrive'),
  // Без значения по умолчанию, чтобы случайно не писать в рабочий файл
  ONEDRIVE_FILE_PATH: z.string().min(1),
  RCLONE_CONFIG: z.string().min(1).optional(),
  RCLONE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  CARDS: z.string().default('Миша,Настя').transform(list),
  CATEGORIES: z.string().default('кафе,одежда,продукты,жилье,маркетплейс,другое').transform(list),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return parsed.data;
}
