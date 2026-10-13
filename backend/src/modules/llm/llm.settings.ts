import { validationError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import type { SecretBox } from './secret-box.ts';

const KEYS = {
  enabled: 'llm.enabled',
  model: 'llm.model',
  dailyLimit: 'llm.daily_limit',
  apiKey: 'llm.api_key',
} as const;

export interface LlmDefaults {
  /** Key from the environment: used when no key was saved in the app */
  apiKey?: string;
  model: string;
  dailyLimit: number;
}

/** Everything the service needs to call the model. */
export interface LlmSettings {
  enabled: boolean;
  model: string;
  /** Parsings per group per day when the group has no limit of its own */
  dailyLimit: number;
  apiKey?: string;
  keySource: 'app' | 'env' | 'none';
}

/** What the administrator sees: never the key itself. */
export interface LlmSettingsView {
  enabled: boolean;
  model: string;
  dailyLimit: number;
  keyConfigured: boolean;
  keySource: LlmSettings['keySource'];
  /** The last characters of the key, to recognise which one is set */
  keyHint: string | null;
  /** Without SECRETS_KEY on the server the key cannot be saved from the app */
  canStoreKey: boolean;
}

export const MAX_MODEL_LENGTH = 100;
export const MAX_DAILY_LIMIT = 100_000;

/** The installation-wide AI settings: the administrator's switch, key, model and limit (table app_settings). */
export class LlmSettingsRepository {
  constructor(
    private readonly database: Database,
    private readonly box: SecretBox,
    private readonly defaults: LlmDefaults,
  ) {}

  async load(): Promise<LlmSettings> {
    const saved = await this.saved();
    const storedKey =
      typeof saved[KEYS.apiKey] === 'string'
        ? this.box.decrypt(saved[KEYS.apiKey] as string)
        : undefined;
    const apiKey = storedKey ?? this.defaults.apiKey;
    return {
      enabled: saved[KEYS.enabled] === true,
      model: asString(saved[KEYS.model]) ?? this.defaults.model,
      dailyLimit: asCount(saved[KEYS.dailyLimit]) ?? this.defaults.dailyLimit,
      apiKey,
      keySource: storedKey ? 'app' : this.defaults.apiKey ? 'env' : 'none',
    };
  }

  async view(): Promise<LlmSettingsView> {
    const settings = await this.load();
    return {
      enabled: settings.enabled,
      model: settings.model,
      dailyLimit: settings.dailyLimit,
      keyConfigured: settings.apiKey !== undefined,
      keySource: settings.keySource,
      keyHint: settings.apiKey ? settings.apiKey.slice(-4) : null,
      canStoreKey: this.box.available,
    };
  }

  async update(changes: { enabled?: boolean; model?: string; dailyLimit?: number }): Promise<void> {
    if (changes.enabled !== undefined) await this.write(KEYS.enabled, changes.enabled);
    if (changes.model !== undefined) {
      const model = changes.model.trim();
      if (!model || model.length > MAX_MODEL_LENGTH || /\s/.test(model)) {
        throw validationError('INVALID_AI_MODEL', 'Укажите идентификатор модели без пробелов');
      }
      await this.write(KEYS.model, model);
    }
    if (changes.dailyLimit !== undefined) {
      if (
        !Number.isInteger(changes.dailyLimit) ||
        changes.dailyLimit < 0 ||
        changes.dailyLimit > MAX_DAILY_LIMIT
      ) {
        throw validationError('INVALID_AI_LIMIT', 'Лимит должен быть целым числом от 0');
      }
      await this.write(KEYS.dailyLimit, changes.dailyLimit);
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    const key = apiKey.trim();
    if (key.length < 8 || key.length > 300 || /\s/.test(key)) {
      throw validationError('INVALID_AI_KEY', 'Некорректный API-ключ');
    }
    await this.write(KEYS.apiKey, this.box.encrypt(key));
  }

  async clearApiKey(): Promise<void> {
    await this.database.query('DELETE FROM app_settings WHERE key = $1', [KEYS.apiKey]);
  }

  private async saved(): Promise<Record<string, unknown>> {
    const rows = await this.database.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
      [Object.values(KEYS)],
    );
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  private async write(key: string, value: unknown): Promise<void> {
    await this.database.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  }
}

const asString = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const asCount = (value: unknown) => (Number.isInteger(value) ? (value as number) : undefined);
