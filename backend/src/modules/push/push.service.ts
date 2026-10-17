import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import { RateLimiter } from '../../infrastructure/rate-limit.ts';
import type { NotificationSettingsRepository } from '../notifications/notification-settings.ts';
import type { DeliveryItem } from '../notifications/notifications.types.ts';
import { isAllowedPushEndpoint } from './endpoint-policy.ts';
import type { PushRepository, StoredTarget } from './push.repository.ts';
import type { PushPayload, PushSender } from './push.types.ts';

export interface PushServiceOptions {
  repository: PushRepository;
  settings: Pick<NotificationSettingsRepository, 'get'>;
  /** Undefined: Web Push is off (no VAPID keys) */
  sender?: PushSender;
  publicKey?: string;
  /** Extra hosts allowed as endpoints besides the known push services */
  allowedHosts?: string[];
  /** Pauses before the second and the third try after a busy answer (tests make them 0) */
  retryDelaysMs?: number[];
  logger?: { warn: (object: object, message: string) => void };
}

const MAX_DEVICES = 10;
/** After this many failures in a row (not «gone») a device is dropped */
const MAX_FAILURES = 10;
const MAX_PER_MINUTE = 10;
const MAX_BODY = 300;

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Chosen by the app («iPhone · Safari (приложение)»); else made from the browser's own name */
  label?: string;
}

/**
 * Web Push: devices of a person and delivery of the events of the notification feed to them. Delivery never
 * blocks the caller and never fails it: it runs in the background, and a push that does not arrive is still in the feed.
 */
export class PushService {
  private readonly pending = new Set<Promise<void>>();
  private readonly perUser = new RateLimiter(MAX_PER_MINUTE, 60_000);
  private readonly changes = new RateLimiter(30, 60_000);

  constructor(private readonly options: PushServiceOptions) {}

  get enabled(): boolean {
    return this.options.sender !== undefined && Boolean(this.options.publicKey);
  }

  config(): { enabled: boolean; publicKey: string | null } {
    return {
      enabled: this.enabled,
      publicKey: this.enabled ? (this.options.publicKey ?? null) : null,
    };
  }

  async subscribe(
    userId: string,
    input: SubscribeInput,
    userAgent?: string,
  ): Promise<{ id: string }> {
    this.requireEnabled();
    if (!this.changes.allow(userId)) throw tooMany();
    if (!isAllowedPushEndpoint(input.endpoint, this.options.allowedHosts)) {
      throw validationError('INVALID_ENDPOINT', 'Этот адрес подписки не поддерживается');
    }
    const existing = await this.options.repository.targets(userId);
    if (existing.length >= MAX_DEVICES && !existing.some((t) => t.endpoint === input.endpoint)) {
      throw new AppError(409, 'TOO_MANY_DEVICES', 'Слишком много устройств: отключите ненужные');
    }
    const label = input.label?.trim().slice(0, 80) || labelFromUserAgent(userAgent);
    return this.options.repository.upsert({ userId, target: input, label });
  }

  list(userId: string) {
    return this.options.repository.list(userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!(await this.options.repository.remove(userId, id))) throw notFoundError();
  }

  /** The device that is signing out stops getting this person's messages. */
  unsubscribe(userId: string, endpoint: string): Promise<void> {
    return this.options.repository.removeByEndpoint(userId, endpoint);
  }

  /** Sends the new feed entries as push in the background. Never throws. */
  deliver(items: DeliveryItem[]): void {
    if (!this.enabled || items.length === 0) return;
    const work = this.deliverAll(items)
      .catch((error: unknown) =>
        this.options.logger?.warn({ err: error }, 'Web Push delivery failed'),
      )
      .finally(() => this.pending.delete(work));
    this.pending.add(work);
  }

  /** Waits for the deliveries in progress (tests, shutdown). */
  async flush(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private async deliverAll(items: DeliveryItem[]): Promise<void> {
    const counts = { sent: 0, gone: 0, failed: 0, skipped: 0 };
    for (const item of items) {
      const settings = await this.options.settings.get(item.userId);
      if (!settings.types[item.type]) continue;
      const targets = await this.options.repository.targets(item.userId);
      if (targets.length === 0) continue;
      if (!this.perUser.allow(item.userId)) {
        counts.skipped += 1;
        continue;
      }
      const payload = payloadOf(item, settings.hideAmounts);
      for (const result of await Promise.all(targets.map((t) => this.deliverTo(t, payload)))) {
        counts[result] += 1;
      }
    }
    if (counts.gone + counts.failed + counts.skipped > 0) {
      this.options.logger?.warn(counts, 'Some push messages were not delivered');
    }
  }

  /** One device: a few tries when the push service is busy; a vanished device is forgotten at once. */
  private async deliverTo(
    target: StoredTarget,
    payload: PushPayload,
  ): Promise<'sent' | 'gone' | 'failed'> {
    const sender = this.options.sender!;
    const delays = this.options.retryDelaysMs ?? [2_000, 5_000];
    for (let attempt = 0; ; attempt += 1) {
      const result = await sender.send(target, payload);
      if (result.ok) {
        await this.options.repository.markSuccess(target.id);
        return 'sent';
      }
      if (result.status === 404 || result.status === 410) {
        await this.options.repository.removeById(target.id);
        return 'gone';
      }
      const busy = result.status === null || result.status === 429 || result.status >= 500;
      if (busy && attempt < delays.length) {
        await sleep(delays[attempt]!);
        continue;
      }
      const failures = await this.options.repository.markFailure(target.id);
      if (failures >= MAX_FAILURES) await this.options.repository.removeById(target.id);
      return 'failed';
    }
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new AppError(409, 'PUSH_DISABLED', 'Уведомления на телефон не настроены на сервере');
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tooMany = () =>
  new AppError(429, 'TOO_MANY_REQUESTS', 'Слишком часто: повторите через минуту');

/** What the device shows. Private mode leaves out amounts and shops: a locked phone shows it to anyone. */
function payloadOf(item: DeliveryItem, hideAmounts: boolean): PushPayload {
  const body = hideAmounts ? (item.privateBody ?? '') : item.body;
  return {
    id: item.id,
    type: item.type,
    title: item.title.slice(0, 100),
    body: body.slice(0, MAX_BODY),
    url: item.link ?? '/',
    unread: item.unread,
    ts: item.createdAt.getTime(),
  };
}

/** «iPhone · Safari», «Chrome · Windows»: a name to tell the devices apart when the app gave none. */
export function labelFromUserAgent(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Устройство';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  return browser ? `${system} · ${browser}` : system;
}
