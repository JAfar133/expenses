import { AppError, forbiddenError, notFoundError } from '../../errors/app-error.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { ApiKeysRepository } from './api-keys.repository.ts';
import type { ImportLogRepository, LogView } from './import-log.repository.ts';
import type { BankImportService, ImportResult } from './import.service.ts';
import { textOf } from './payload.ts';

/**
 * The owner processes a stored request again, for example after they gave a card its last four digits. The request is
 * taken from the diagnostic log exactly as it came (with its original time), so the same purchase cannot be made twice:
 * the ordinary duplicate checks apply. A retry that does not work leaves no new entry and no new notification.
 */
export class ImportRetryService {
  constructor(
    private readonly options: {
      log: Pick<ImportLogRepository, 'find' | 'markRetried' | 'remove'>;
      keys: Pick<ApiKeysRepository, 'findForRetry'>;
      imports: Pick<BankImportService, 'import'>;
      notifications: Pick<NotificationsService, 'retract'>;
    },
  ) {}

  /** One entry of the log (owner only). */
  async entry(owner: AuthUser, id: string): Promise<LogView> {
    const entry = await this.options.log.find(this.groupOf(owner), id);
    if (!entry) throw notFoundError();
    const { keyId: _keyId, receivedAtDate: _date, ...view } = entry;
    return view;
  }

  async retry(owner: AuthUser, id: string): Promise<ImportResult> {
    const groupId = this.groupOf(owner);
    const entry = await this.options.log.find(groupId, id);
    if (!entry) throw notFoundError();
    if (!entry.retryable) {
      throw new AppError(409, 'NOT_RETRYABLE', 'Этот запрос повторно обработать нельзя');
    }
    const key = entry.keyId ? await this.options.keys.findForRetry(entry.keyId) : undefined;
    if (!key || key.groupId !== groupId) {
      throw new AppError(409, 'KEY_GONE', 'Ключ, которым прислан запрос, уже удалён');
    }

    const raw = entry.rawPayload;
    const result = await this.options.imports.import(key, {
      source: textOf(raw.source) ?? entry.source,
      title: textOf(raw.title) ?? '',
      body: textOf(raw.body) ?? '',
      raw,
      receivedAt: entry.receivedAtDate,
    });

    if (result.status === 'created' || result.status === 'duplicate') {
      // The old entry and its «problem» notification are history now
      await this.options.log.markRetried(id, result.transactionId);
      await this.options.notifications.retract([`import_problem:${id}`]);
    } else if ('importId' in result && result.importId) {
      // Still not working: the first entry already says why; do not pile up a second one and a second notice
      await this.options.log.remove(result.importId);
      await this.options.notifications.retract([`import_problem:${result.importId}`]);
    }
    return result;
  }

  private groupOf(user: AuthUser): string {
    if (user.role !== 'owner' || !user.groupId) throw forbiddenError();
    return user.groupId;
  }
}
