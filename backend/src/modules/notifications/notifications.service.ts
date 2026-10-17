import { NotificationHub } from './notification-hub.ts';
import type { NotificationSettingsRepository, PushSettings } from './notification-settings.ts';
import type { NotificationsRepository } from './notifications.repository.ts';
import type { DeliveryItem, NotificationEvent, NotificationView } from './notifications.types.ts';

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
    /** Other channels fed from the same events (Web Push) */
    private readonly delivery?: { deliver(items: DeliveryItem[]): void },
    private readonly settings?: NotificationSettingsRepository,
    /** The people with the app open: their badge changes at once */
    readonly hub: NotificationHub = new NotificationHub(),
  ) {}

  /** Stores the event for everyone it concerns. Returns how many people got it. */
  async emit(event: NotificationEvent): Promise<number> {
    try {
      const userIds = await this.repository.recipients(event.audience);
      if (userIds.length === 0) return 0;
      const added = await this.repository.add({
        userIds,
        groupId: event.audience.groupId,
        type: event.type,
        title: event.title.slice(0, 200),
        body: event.body.slice(0, 500),
        link: event.link,
        data: event.data,
        dedupeKey: event.dedupeKey,
      });
      await this.forward(event, added);
      return added.length;
    } catch (error) {
      this.logger?.warn({ err: error, type: event.type }, 'Failed to store a notification');
      return 0;
    }
  }

  /**
   * Tells the open apps of the recipients the new number at once and hands the entries to the other channels (their
   * sending runs on in the background); never throws.
   */
  private async forward(
    event: NotificationEvent,
    added: { id: string; userId: string; createdAt: Date }[],
  ): Promise<void> {
    if (added.length === 0) return;
    try {
      const items: DeliveryItem[] = [];
      for (const row of added) {
        const unread = await this.repository.unreadCount(row.userId);
        this.hub.publish(row.userId, { unread });
        items.push({
          id: row.id,
          userId: row.userId,
          type: event.type,
          title: event.title,
          body: event.body,
          privateBody: event.privateBody,
          link: event.link,
          createdAt: row.createdAt,
          unread,
        });
      }
      this.delivery?.deliver(items);
    } catch (error) {
      this.logger?.warn({ err: error, type: event.type }, 'Failed to hand a notification on');
    }
  }

  async pushSettings(userId: string): Promise<PushSettings> {
    return this.settings!.get(userId);
  }

  async savePushSettings(
    userId: string,
    patch: { types?: Partial<PushSettings['types']>; hideAmounts?: boolean },
  ): Promise<PushSettings> {
    const current = await this.settings!.get(userId);
    const next: PushSettings = {
      types: { ...current.types, ...patch.types },
      hideAmounts: patch.hideAmounts ?? current.hideAmounts,
    };
    await this.settings!.save(userId, next);
    return next;
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

  /** Marks read and tells the person's other open tabs the new number. */
  async markRead(userId: string, ids?: string[]): Promise<void> {
    await this.repository.markRead(userId, ids);
    this.hub.publish(userId, { unread: await this.repository.unreadCount(userId) });
  }

  deleteOld(now: Date = new Date()): Promise<number> {
    return this.repository.deleteOld(now);
  }
}
