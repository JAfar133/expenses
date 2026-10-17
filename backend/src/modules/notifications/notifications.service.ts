import type { NotificationsRepository } from './notifications.repository.ts';
import type { NotificationEvent, NotificationView } from './notifications.types.ts';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

/**
 * The notification centre. Producers (the import, the receipt parsing) only say what happened and for whom; the
 * service turns it into a row for each person. Delivery to other channels (Web Push, Telegram) will hang on `emit`.
 * Never fails the caller: a lost notification must not break an import.
 */
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly logger?: { warn: (object: object, message: string) => void },
  ) {}

  /** Stores the event for everyone it concerns. Returns how many people got it. */
  async emit(event: NotificationEvent): Promise<number> {
    try {
      const userIds = await this.repository.recipients(event.audience);
      if (userIds.length === 0) return 0;
      return await this.repository.add({
        userIds,
        groupId: event.audience.groupId,
        type: event.type,
        title: event.title.slice(0, 200),
        body: event.body.slice(0, 500),
        link: event.link,
        data: event.data,
        dedupeKey: event.dedupeKey,
      });
    } catch (error) {
      this.logger?.warn({ err: error, type: event.type }, 'Failed to store a notification');
      return 0;
    }
  }

  /** Takes back notifications by their dedupe keys (the problem they reported was solved by a later event). */
  async retract(dedupeKeys: string[]): Promise<void> {
    if (dedupeKeys.length === 0) return;
    try {
      await this.repository.removeByDedupeKeys(dedupeKeys);
    } catch (error) {
      this.logger?.warn({ err: error }, 'Failed to take back notifications');
    }
  }

  async list(
    userId: string,
    options: { limit?: number; before?: string },
  ): Promise<{ items: NotificationView[]; unread: number }> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = options.before ? new Date(options.before) : undefined;
    return {
      items: await this.repository.list(
        userId,
        limit,
        before && !Number.isNaN(before.getTime()) ? before : undefined,
      ),
      unread: await this.repository.unreadCount(userId),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.repository.unreadCount(userId);
  }

  markRead(userId: string, ids?: string[]): Promise<void> {
    return this.repository.markRead(userId, ids);
  }

  deleteOld(now: Date = new Date()): Promise<number> {
    return this.repository.deleteOld(now);
  }
}
