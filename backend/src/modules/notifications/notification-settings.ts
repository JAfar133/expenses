import type { Database } from '../../infrastructure/database/database.ts';
import { NOTIFICATION_TYPES, type NotificationType } from './notifications.types.ts';

export interface PushSettings {
  /** Which events are sent as push (the bell always gets all of them) */
  types: Record<NotificationType, boolean>;
  /** Push without amounts and shops: anyone who looks at a locked phone sees them */
  hideAmounts: boolean;
}

/** Defaults: the person sees a receipt they parsed themselves, so it is not pushed unless they ask. */
const DEFAULT_ON: NotificationType[] = [
  'expense_imported',
  'import_problem',
  'announcement',
  'member_joined',
];

const asTypes = (enabled: string[]): Record<NotificationType, boolean> =>
  Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, enabled.includes(type)])) as Record<
    NotificationType,
    boolean
  >;

/** SQL for a person's notification settings. */
export class NotificationSettingsRepository {
  constructor(private readonly database: Database) {}

  async get(userId: string): Promise<PushSettings> {
    const [row] = await this.database.query<{ push_types: string[]; push_hide_amounts: boolean }>(
      'SELECT push_types, push_hide_amounts FROM notification_settings WHERE user_id = $1',
      [userId],
    );
    return row
      ? { types: asTypes(row.push_types), hideAmounts: row.push_hide_amounts }
      : { types: asTypes(DEFAULT_ON), hideAmounts: false };
  }

  async save(userId: string, settings: PushSettings): Promise<void> {
    const enabled = NOTIFICATION_TYPES.filter((type) => settings.types[type]);
    await this.database.query(
      `INSERT INTO notification_settings (user_id, push_types, push_hide_amounts, updated_at)
       VALUES ($1, $2::text[], $3, now())
       ON CONFLICT (user_id) DO UPDATE
         SET push_types = EXCLUDED.push_types, push_hide_amounts = EXCLUDED.push_hide_amounts,
             updated_at = now()`,
      [userId, enabled, settings.hideAmounts],
    );
  }
}
