import type { Database } from '../../infrastructure/database/database.ts';
import type { Preferences } from './preferences.schema.ts';

export class PreferencesRepository {
  constructor(private readonly database: Database) {}

  async get(userId: string): Promise<Preferences> {
    const [row] = await this.database.query<{ preferences: Preferences }>(
      'SELECT preferences FROM users WHERE id = $1',
      [userId],
    );
    return row?.preferences ?? {};
  }

  /** Добавляет и заменяет указанные ключи, остальные настройки остаются. Возвращает итоговый набор. */
  async merge(userId: string, patch: Preferences): Promise<Preferences> {
    const [row] = await this.database.query<{ preferences: Preferences }>(
      `UPDATE users SET preferences = preferences || $2::jsonb, updated_at = now()
        WHERE id = $1 RETURNING preferences`,
      [userId, JSON.stringify(patch)],
    );
    return row?.preferences ?? {};
  }
}
