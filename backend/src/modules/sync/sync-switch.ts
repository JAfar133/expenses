import type { Database } from '../../infrastructure/database/database.ts';
import { AppError } from '../../errors/app-error.ts';

const SETTING_KEY = 'excel_sync_enabled';

/** The part of the sync the switch controls. */
export interface SwitchableSync {
  /** An Excel file is set in the server configuration */
  readonly configured: boolean;
  setEnabled(enabled: boolean): void;
}

/** The timer of the sync. */
export interface SwitchableScheduler {
  start(options?: { runNow?: boolean }): void;
  stop(): void;
}

export interface SyncSwitchView {
  /** The server is configured for Excel (ONEDRIVE_FILE_PATH is set): without it the sync cannot be turned on */
  configured: boolean;
  enabled: boolean;
}

/**
 * The administrator's on/off switch for the Excel sync. While it is off the app does not touch OneDrive at all:
 * no download of the file, no check of the table, no writes, no timer. The choice is kept in the database; without it
 * the sync follows the server configuration. Records made meanwhile wait in the queue and are written when it is turned on.
 */
export class SyncSwitch {
  constructor(
    private readonly database: Database,
    private readonly sync: SwitchableSync,
    private readonly scheduler: SwitchableScheduler,
  ) {}

  /** Reads the saved choice and applies it: starts the timer if the sync is on. Call once at start-up. */
  async load(): Promise<SyncSwitchView> {
    const view = await this.view();
    this.apply(view.enabled);
    return view;
  }

  async view(): Promise<SyncSwitchView> {
    const [row] = await this.database.query<{ value: boolean }>(
      'SELECT value FROM app_settings WHERE key = $1',
      [SETTING_KEY],
    );
    const configured = this.sync.configured;
    return { configured, enabled: configured && (row?.value ?? true) };
  }

  async set(enabled: boolean): Promise<SyncSwitchView> {
    if (enabled && !this.sync.configured) {
      throw new AppError(
        409,
        'EXCEL_NOT_CONFIGURED',
        'Файл Excel не настроен на сервере (ONEDRIVE_FILE_PATH): включать нечего',
      );
    }
    await this.database.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [SETTING_KEY, JSON.stringify(enabled)],
    );
    this.apply(enabled);
    return this.view();
  }

  private apply(enabled: boolean): void {
    this.sync.setEnabled(enabled);
    if (enabled) this.scheduler.start();
    else this.scheduler.stop();
  }
}
