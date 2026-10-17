import { AppError, forbiddenError, validationError } from '../../errors/app-error.ts';
import { RateLimiter } from '../../infrastructure/rate-limit.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { Addressee, BroadcastRepository, BroadcastView } from './broadcast.repository.ts';
import type { NotificationsService } from './notifications.service.ts';

const MAX_TITLE = 80;
const MAX_TEXT = 300;
const MAX_PER_HOUR = 10;
const MAX_RECIPIENTS = 200;

export type Audience = { type: 'group' } | { type: 'all' } | { type: 'users'; userIds: string[] };

export interface BroadcastInput {
  title?: unknown;
  text?: unknown;
  audience?: unknown;
}

/**
 * Messages from people to people. The owner of a group writes to the members of their own group, the administrator to
 * anyone. A message is a notification of the type `announcement`: it reaches the bell and, if the person has a device,
 * the phone. Nobody else can send one, and nobody can reach people outside what their role allows.
 */
export class BroadcastService {
  private readonly perSender = new RateLimiter(MAX_PER_HOUR, 3_600_000);

  constructor(
    private readonly repository: BroadcastRepository,
    private readonly notifications: Pick<NotificationsService, 'emit'>,
  ) {}

  /** Whether this person may send messages at all, and to whom: the owner to their group, the administrator to all. */
  private scopeOf(user: AuthUser): { all: boolean; groupId: string | null } {
    if (user.isAdmin) return { all: true, groupId: user.groupId };
    if (user.role === 'owner' && user.groupId) return { all: false, groupId: user.groupId };
    throw forbiddenError();
  }

  /** The people this sender may choose from. */
  async addressees(user: AuthUser): Promise<{ canSendToAll: boolean; users: Addressee[] }> {
    const scope = this.scopeOf(user);
    return {
      canSendToAll: scope.all,
      users: await this.repository.addressees(
        user.id,
        scope.all ? undefined : (scope.groupId ?? undefined),
      ),
    };
  }

  async history(user: AuthUser): Promise<BroadcastView[]> {
    this.scopeOf(user);
    return this.repository.recent(user.id, 20);
  }

  /** Sends a message. Returns how many people got it. */
  async send(user: AuthUser, input: BroadcastInput): Promise<{ id: string; recipients: number }> {
    const scope = this.scopeOf(user);
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) throw validationError('INVALID_TEXT', 'Введите текст сообщения');
    if (text.length > MAX_TEXT) {
      throw validationError('INVALID_TEXT', `Текст не длиннее ${MAX_TEXT} символов`);
    }
    const customTitle = typeof input.title === 'string' ? input.title.trim() : '';
    if (customTitle.length > MAX_TITLE) {
      throw validationError('INVALID_TITLE', `Заголовок не длиннее ${MAX_TITLE} символов`);
    }
    const audience = parseAudience(input.audience);
    if (audience.type === 'all' && !scope.all) throw forbiddenError();

    const everyone = await this.repository.addressees(
      user.id,
      scope.all ? undefined : (scope.groupId ?? undefined),
    );
    const allowed = new Map(everyone.map((person) => [person.id, person]));
    let chosen: Addressee[];
    if (audience.type === 'users') {
      const unknown = audience.userIds.filter((id) => !allowed.has(id));
      // Someone outside what the role allows looks like a person who does not exist
      if (unknown.length > 0)
        throw validationError('INVALID_RECIPIENTS', 'Выберите получателей из списка');
      chosen = audience.userIds.map((id) => allowed.get(id)!);
    } else if (audience.type === 'group') {
      chosen = everyone.filter((person) => person.groupId === scope.groupId);
    } else {
      chosen = everyone;
    }
    chosen = [...new Map(chosen.map((person) => [person.id, person])).values()];
    if (chosen.length === 0)
      throw validationError('NO_RECIPIENTS', 'Некому отправлять: выберите получателей');
    if (chosen.length > MAX_RECIPIENTS) {
      throw validationError(
        'TOO_MANY_RECIPIENTS',
        `Не больше ${MAX_RECIPIENTS} получателей за раз`,
      );
    }
    if (!this.perSender.allow(user.id)) {
      throw new AppError(429, 'TOO_MANY_REQUESTS', 'Слишком много сообщений: повторите позже');
    }

    const title = customTitle || `Сообщение · ${user.displayName}`;
    const id = await this.repository.record({
      senderId: user.id,
      scope: audience.type,
      title,
      body: text,
      recipients: chosen.length,
    });
    // One emit per group: a notification belongs to its person's group (people without a group have none)
    const byGroup = new Map<string | null, string[]>();
    for (const person of chosen) {
      byGroup.set(person.groupId, [...(byGroup.get(person.groupId) ?? []), person.id]);
    }
    for (const [groupId, userIds] of byGroup) {
      await this.notifications.emit({
        type: 'announcement',
        title,
        body: text,
        privateBody: text,
        link: '/',
        data: { broadcastId: id, senderName: user.displayName },
        dedupeKey: `announcement:${id}`,
        audience: { type: 'users', groupId, userIds },
      });
    }
    return { id, recipients: chosen.length };
  }
}

function parseAudience(value: unknown): Audience {
  if (typeof value === 'object' && value !== null) {
    const raw = value as { type?: unknown; userIds?: unknown };
    if (raw.type === 'group') return { type: 'group' };
    if (raw.type === 'all') return { type: 'all' };
    if (raw.type === 'users' && Array.isArray(raw.userIds)) {
      const ids = raw.userIds.filter((id): id is string => typeof id === 'string');
      if (ids.length === raw.userIds.length) return { type: 'users', userIds: ids.slice(0, 500) };
    }
  }
  throw validationError('INVALID_AUDIENCE', 'Выберите, кому отправить');
}
