import {
  AppError,
  forbiddenError,
  notFoundError,
  validationError,
} from '../../errors/app-error.ts';
import type { ZodType } from 'zod';
import type { AuthUser } from '../auth/auth.types.ts';
import { scopeOf } from '../groups/scope.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type {
  TemplateInput,
  TemplatePlacement,
  TemplateRow,
  TemplatesRepository,
  Viewer,
} from './templates.repository.ts';
import {
  hiddenSchema,
  reorderSchema,
  TEMPLATE_ERROR_CODES,
  templateEditSchema,
  templateSchema,
} from './templates.schema.ts';

/** A template as the client gets it. */
export interface TemplateView {
  id: string;
  scope: TemplateRow['scope'];
  /** A proposal of a member waiting for the owner of the group (only its author and the owner see it) */
  pending: boolean;
  /** A personal template: the state of its copy in the group (proposed or active), null if never shared */
  sharedStatus: TemplateRow['sharedStatus'];
  name: string;
  emoji: string | null;
  category: string;
  /** The card chosen in the template; null: "my default card" */
  card: string | null;
  /** The card the expense will go to for this user (the template's one if they may add to it, else their own) */
  effectiveCard: string;
  expenseName: string;
  amount: number | null;
  currency: string | null;
  /** The user may change it and remove it (its author, and the owner of the group for a group one) */
  editable: boolean;
  /** The user made it (a proposal they may take back) */
  mine: boolean;
  /** Who made it (the owner reviews proposals by it) */
  author: string;
  /** Who changed it last and when (ISO); null: not changed since it was made */
  updatedBy: string | null;
  updatedAt: string | null;
  hidden: boolean;
  /** Its category is archived or its card is: it cannot be used until changed */
  unavailable: boolean;
}

export interface TemplatesServiceOptions {
  repository: Pick<
    TemplatesRepository,
    | 'list'
    | 'find'
    | 'categoryId'
    | 'cardId'
    | 'create'
    | 'update'
    | 'activate'
    | 'archive'
    | 'reorder'
    | 'saveUserOrder'
    | 'setHidden'
    | 'transaction'
  >;
  groups: Pick<GroupsRepository, 'editableCardNames'>;
  /** Currencies an amount may be in */
  currencies: string[];
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  throw validationError(
    TEMPLATE_ERROR_CODES[String(issue.path[0])] ?? 'VALIDATION_ERROR',
    issue.message,
  );
}

const viewerOf = (user: AuthUser): Viewer => ({ userId: user.id, isOwner: user.role === 'owner' });

/**
 * Quick-action templates. A personal template is its author's. A group template is the group's: only the owner of the
 * group creates, orders and turns on; the owner and the author of a group template change and remove it. A member
 * does not publish a template, they propose it: the proposal is a separate copy that the group does not see until the
 * owner makes it active. The personal original stays with its author and the two never change each other. Using a template creates an ordinary expense on the
 * client side, so the rights to the card and the category are checked by the expense itself.
 */
export class TemplatesService {
  constructor(private readonly options: TemplatesServiceOptions) {}

  async list(user: AuthUser): Promise<TemplateView[]> {
    const groupId = this.groupOf(user);
    const rows = await this.options.repository.list(groupId, viewerOf(user));
    const editableCards = await this.options.groups.editableCardNames(scopeOf(user));
    return rows.map((row) => this.view(user, row, editableCards));
  }

  /** A personal template; the owner of the group may create a group one right away. */
  async create(user: AuthUser, body: unknown): Promise<string> {
    const groupId = this.groupOf(user);
    const { scope, ...fields } = parse(templateSchema, body);
    if (scope === 'group' && user.role !== 'owner') throw forbiddenError();
    const input = await this.resolve(groupId, fields);
    return this.options.repository.create(groupId, user.id, { scope, status: 'active' }, input);
  }

  async update(user: AuthUser, id: string, body: unknown): Promise<void> {
    const groupId = this.groupOf(user);
    await this.manageable(user, id);
    const input = await this.resolve(groupId, parse(templateEditSchema, body));
    await this.options.repository.update(id, input, user.id);
  }

  /** The owner or the author removes a template; the author of a proposal takes it back while it waits. */
  async remove(user: AuthUser, id: string): Promise<void> {
    const row = await this.find(user, id);
    const takesBack = row.status === 'proposed' && row.ownerId === user.id;
    if (!this.canManage(user, row) && !takesBack) throw forbiddenError();
    await this.options.repository.archive(id);
  }

  /**
   * Offers a personal template to the group. The owner of the group publishes it at once, a member sends a proposal.
   * A template can have one copy in the group at a time.
   */
  async share(user: AuthUser, id: string): Promise<'active' | 'proposed'> {
    const groupId = this.groupOf(user);
    const row = await this.find(user, id);
    if (row.scope !== 'personal' || row.ownerId !== user.id) throw forbiddenError();
    if (row.sharedStatus === 'proposed') {
      throw new AppError(409, 'TEMPLATE_ALREADY_PROPOSED', 'Шаблон уже отправлен владельцу группы');
    }
    if (row.sharedStatus === 'active') {
      throw new AppError(409, 'TEMPLATE_ALREADY_SHARED', 'Шаблон уже есть в группе');
    }
    const status = user.role === 'owner' ? 'active' : 'proposed';
    const input = await this.resolve(groupId, {
      name: row.name,
      emoji: row.emoji,
      category: row.category,
      card: row.card,
      expenseName: row.expenseName,
      amount: row.amount,
      currency: row.currency,
    });
    const placement: TemplatePlacement = { scope: 'group', status, originId: row.id };
    await this.options.repository.create(groupId, user.id, placement, input);
    return status;
  }

  /** The owner of the group turns a proposal on: from now on the group sees and uses it. */
  async approve(user: AuthUser, id: string): Promise<void> {
    if (user.role !== 'owner') throw forbiddenError();
    const row = await this.find(user, id);
    if (row.scope !== 'group' || row.status !== 'proposed') {
      throw validationError('NOT_A_PROPOSAL', 'Это не предложение шаблона');
    }
    await this.options.repository.activate(id);
  }

  /** The user's own order of the templates they see (theirs and the group's); the order of others is not touched. */
  async reorder(user: AuthUser, body: unknown): Promise<void> {
    const groupId = this.groupOf(user);
    const { ids } = parse(reorderSchema, body);
    const visible = await this.options.repository.list(groupId, viewerOf(user));
    const allowed = new Set(visible.filter((row) => row.status === 'active').map((row) => row.id));
    await this.options.repository.transaction((tx) =>
      this.options.repository.saveUserOrder(
        user.id,
        [...new Set(ids)].filter((id) => allowed.has(id)),
        tx,
      ),
    );
  }

  /** The default order of the group templates (for those who have not arranged them): the owner's. */
  async reorderGroup(user: AuthUser, body: unknown): Promise<void> {
    if (user.role !== 'owner') throw forbiddenError();
    const groupId = this.groupOf(user);
    const { ids } = parse(reorderSchema, body);
    const visible = await this.options.repository.list(groupId, viewerOf(user));
    const allowed = new Set(
      visible
        .filter((row) => row.scope === 'group' && row.status === 'active')
        .map((row) => row.id),
    );
    await this.options.repository.transaction((tx) =>
      this.options.repository.reorder(
        [...new Set(ids)].filter((id) => allowed.has(id)),
        tx,
      ),
    );
  }

  /** Hide an active group template for this user only. */
  async setHidden(user: AuthUser, id: string, body: unknown): Promise<void> {
    const row = await this.find(user, id);
    if (row.scope !== 'group' || row.status !== 'active') {
      throw validationError('NOT_GROUP_TEMPLATE', 'Скрыть можно только групповой шаблон');
    }
    await this.options.repository.setHidden(user.id, id, parse(hiddenSchema, body).hidden);
  }

  private groupOf(user: AuthUser): string {
    if (!user.groupId) throw notFoundError();
    return user.groupId;
  }

  private async find(user: AuthUser, id: string): Promise<TemplateRow> {
    const row = await this.options.repository.find(this.groupOf(user), viewerOf(user), id);
    if (!row) throw notFoundError();
    return row;
  }

  /** Personal: its author. Group: the owner of the group and the author of the template (who shared it). */
  private canManage(user: AuthUser, row: TemplateRow): boolean {
    return row.ownerId === user.id || (row.scope === 'group' && user.role === 'owner');
  }

  private async manageable(user: AuthUser, id: string): Promise<TemplateRow> {
    const row = await this.find(user, id);
    if (!this.canManage(user, row)) throw forbiddenError();
    return row;
  }

  private view(user: AuthUser, row: TemplateRow, editableCards: string[]): TemplateView {
    const usable = row.card !== null && !row.cardArchived && editableCards.includes(row.card);
    return {
      id: row.id,
      scope: row.scope,
      pending: row.status === 'proposed',
      sharedStatus: row.sharedStatus,
      name: row.name,
      emoji: row.emoji,
      category: row.category,
      card: row.card,
      effectiveCard: usable ? row.card! : user.card,
      expenseName: row.expenseName,
      amount: row.amount,
      currency: row.currency,
      editable: this.canManage(user, row),
      mine: row.ownerId === user.id,
      author: row.author,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      hidden: row.hidden,
      unavailable: row.categoryArchived,
    };
  }

  /** Names from the request into ids of the group, the currency against the allowed list. */
  private async resolve(
    groupId: string,
    body: Omit<ReturnType<typeof templateSchema.parse>, 'scope'>,
  ): Promise<TemplateInput> {
    const categoryId = await this.options.repository.categoryId(groupId, body.category);
    if (!categoryId) throw validationError('INVALID_CATEGORY', 'Выберите категорию из списка');
    let cardId: string | null = null;
    if (body.card) {
      cardId = (await this.options.repository.cardId(groupId, body.card)) ?? null;
      if (!cardId) throw validationError('INVALID_CARD', 'Выберите карту из списка');
    }
    const currency = body.amount === null ? null : (body.currency?.toUpperCase() ?? null);
    if (currency && !this.options.currencies.includes(currency)) {
      throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
    }
    return {
      name: body.name,
      emoji: body.emoji,
      categoryId,
      cardId,
      expenseName: body.expenseName,
      amount: body.amount,
      currency,
    };
  }
}
