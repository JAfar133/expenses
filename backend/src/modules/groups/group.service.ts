import { AppError, notFoundError, validationError } from '../../errors/app-error.ts';
import type { AuthUser, GroupRole } from '../auth/auth.types.ts';
import type { AuthService } from '../auth/auth.service.ts';
import {
  NameTakenError,
  type CardLevel,
  type GroupAdminRepository,
  type GroupOverview,
  type InvitationInfo,
} from './group-admin.repository.ts';
import type { InvitationsService } from './invitations.service.ts';

const MAX_NAME_LENGTH = 60;

/** How long a member may correct their own expense: off, 15 minutes, 1 hour, 24 hours, a week. */
export const MEMBER_EDIT_OPTIONS = [0, 15, 60, 1440, 10080] as const;

export interface GroupView extends GroupOverview {
  invitations: InvitationInfo[];
  /** Currencies a card or the group may use */
  currencies: string[];
}

/** What the group service needs to know about currencies. */
export interface GroupCurrencies {
  /** Allowed currencies */
  currencies: string[];
  /** The currency of the drams amount: rates are quoted against it */
  base: string;
  /** Rate of a currency in drams; undefined if unknown */
  rateOf: (currency: string) => Promise<number | undefined>;
}

/** The name of a card, category or group: trimmed, not empty, not too long. */
export function cleanName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw validationError('INVALID_NAME', `${what}: от 1 до ${MAX_NAME_LENGTH} символов`);
  }
  return name;
}

const taken = (what: string) =>
  new AppError(409, 'NAME_TAKEN', `${what} с таким названием уже есть`);

/**
 * What the owner of a group can do: cards, access to them, categories, members, invitations.
 * Every method works on the group of the acting owner only; the caller has already checked the role.
 */
export class GroupService {
  constructor(
    private readonly repository: GroupAdminRepository,
    private readonly invitations: InvitationsService,
    private readonly auth: Pick<AuthService, 'setUserRights'>,
    private readonly money: GroupCurrencies,
  ) {}

  async view(owner: AuthUser): Promise<GroupView> {
    const groupId = this.groupOf(owner);
    const overview = await this.repository.overview(groupId);
    if (!overview) throw notFoundError();
    return {
      ...overview,
      invitations: await this.repository.listInvitations(groupId),
      currencies: this.money.currencies,
    };
  }

  async setMemberEditMinutes(owner: AuthUser, minutes: unknown): Promise<void> {
    if (!MEMBER_EDIT_OPTIONS.some((option) => option === minutes)) {
      throw validationError('INVALID_MINUTES', 'Выберите срок из списка');
    }
    await this.repository.setMemberEditMinutes(this.groupOf(owner), minutes as number);
  }

  async rename(owner: AuthUser, name: unknown): Promise<void> {
    await this.repository.renameGroup(this.groupOf(owner), cleanName(name, 'Название группы'));
  }

  async createCard(owner: AuthUser, name: unknown, currency?: unknown): Promise<string> {
    const groupId = this.groupOf(owner);
    const group = await this.repository.getGroup(groupId);
    try {
      return await this.repository.createCard(
        groupId,
        cleanName(name, 'Название карты'),
        currency === undefined ? group!.reportingCurrency : this.checkedCurrency(currency),
      );
    } catch (error) {
      throw error instanceof NameTakenError ? taken('Карта') : error;
    }
  }

  async updateCard(
    owner: AuthUser,
    cardId: string,
    patch: { name?: unknown; archived?: unknown; currency?: unknown },
  ): Promise<void> {
    await this.requireCard(owner, cardId);
    const update: { name?: string; archived?: boolean; currency?: string } = {};
    if (patch.name !== undefined) update.name = cleanName(patch.name, 'Название карты');
    if (patch.archived !== undefined) update.archived = patch.archived === true;
    if (patch.currency !== undefined) {
      update.currency = this.checkedCurrency(patch.currency);
      // The amounts of the records were kept in the old currency: it can only change while the card is empty
      if (await this.repository.cardHasExpenses(cardId)) {
        throw new AppError(
          409,
          'CARD_HAS_EXPENSES',
          'Валюту карты нельзя изменить: по ней уже есть траты',
        );
      }
    }
    try {
      await this.repository.updateCard(cardId, update);
    } catch (error) {
      throw error instanceof NameTakenError ? taken('Карта') : error;
    }
  }

  /** `levels`: login → access level; members that are not listed lose access to the card. */
  async setCardAccess(
    owner: AuthUser,
    cardId: string,
    levels: Record<string, CardLevel>,
  ): Promise<void> {
    const groupId = await this.requireCard(owner, cardId);
    const resolved = new Map<string, CardLevel>();
    for (const [username, level] of Object.entries(levels)) {
      if (level !== 'view' && level !== 'edit') {
        throw validationError('INVALID_LEVEL', 'Доступ: view или edit');
      }
      const member = await this.repository.findMember(groupId, username);
      if (!member) throw validationError('UNKNOWN_MEMBER', `Нет такого участника: ${username}`);
      resolved.set(member.userId, level);
    }
    await this.repository.setCardAccess(groupId, cardId, resolved);
  }

  async createCategory(owner: AuthUser, name: unknown): Promise<string> {
    try {
      return await this.repository.createCategory(
        this.groupOf(owner),
        cleanName(name, 'Название категории'),
      );
    } catch (error) {
      throw error instanceof NameTakenError ? taken('Категория') : error;
    }
  }

  async updateCategory(
    owner: AuthUser,
    categoryId: string,
    patch: { name?: unknown; archived?: unknown; mergeInto?: unknown },
  ): Promise<void> {
    const groupId = this.groupOf(owner);
    if (!(await this.repository.categoryBelongsToGroup(groupId, categoryId))) {
      throw notFoundError();
    }
    if (patch.mergeInto !== undefined) {
      const target = String(patch.mergeInto);
      if (target === categoryId) {
        throw validationError('INVALID_MERGE', 'Нельзя объединить категорию саму с собой');
      }
      if (!(await this.repository.categoryBelongsToGroup(groupId, target))) throw notFoundError();
      await this.repository.mergeCategory(groupId, categoryId, target);
      return;
    }
    const update: { name?: string; archived?: boolean } = {};
    if (patch.name !== undefined) update.name = cleanName(patch.name, 'Название категории');
    if (patch.archived !== undefined) update.archived = patch.archived === true;
    try {
      await this.repository.updateCategory(groupId, categoryId, update);
    } catch (error) {
      throw error instanceof NameTakenError ? taken('Категория') : error;
    }
  }

  /**
   * Changes the currency the group's totals and charts are in. The reporting amounts of all records are recalculated:
   * the records of cards in the new currency keep their exact amounts, the others are the drams amount at today's rate.
   */
  async setReportingCurrency(owner: AuthUser, currency: unknown): Promise<number> {
    const groupId = this.groupOf(owner);
    const code = this.checkedCurrency(currency);
    const rate = code === this.money.base ? 1 : await this.money.rateOf(code);
    if (rate === undefined || !(rate > 0)) {
      throw validationError('RATE_UNAVAILABLE', `Курс валюты ${code} недоступен`);
    }
    return this.repository.setReportingCurrency(
      groupId,
      code,
      rate,
      code === this.money.base ? 0 : 2,
    );
  }

  invite(owner: AuthUser, role: GroupRole) {
    if (role !== 'owner' && role !== 'member') {
      throw validationError('INVALID_ROLE', 'Роль: owner или member');
    }
    return this.invitations.create({
      kind: 'join',
      groupId: this.groupOf(owner),
      role,
      createdBy: owner.id,
    });
  }

  async revokeInvitation(owner: AuthUser, invitationId: string): Promise<void> {
    if (!(await this.repository.revokeInvitation(this.groupOf(owner), invitationId))) {
      throw notFoundError();
    }
  }

  /** A link to set a new password for a member (they forgot it). */
  async resetPassword(owner: AuthUser, username: string) {
    const member = await this.requireOtherMember(owner, username);
    return this.invitations.create({ kind: 'reset', userId: member.userId, createdBy: owner.id });
  }

  async setRole(owner: AuthUser, username: string, role: GroupRole): Promise<void> {
    await this.auth.setUserRights(owner, username, role === 'owner');
  }

  async removeMember(owner: AuthUser, username: string): Promise<void> {
    const member = await this.requireOtherMember(owner, username);
    if (member.fromEnv) {
      throw new AppError(
        409,
        'MANAGED_BY_SETTINGS',
        'Этот пользователь задан в настройках сервера: его нельзя убрать из приложения',
      );
    }
    await this.repository.removeMember(this.groupOf(owner), member.userId);
  }

  private checkedCurrency(value: unknown): string {
    if (typeof value !== 'string' || !this.money.currencies.includes(value)) {
      throw validationError('INVALID_CURRENCY', 'Выберите валюту из списка');
    }
    return value;
  }

  private groupOf(owner: AuthUser): string {
    if (!owner.groupId) throw notFoundError();
    return owner.groupId;
  }

  private async requireCard(owner: AuthUser, cardId: string): Promise<string> {
    const groupId = this.groupOf(owner);
    if (!(await this.repository.cardBelongsToGroup(groupId, cardId))) throw notFoundError();
    return groupId;
  }

  private async requireOtherMember(owner: AuthUser, username: string) {
    const member = await this.repository.findMember(this.groupOf(owner), username);
    if (!member) throw notFoundError();
    if (member.userId === owner.id) {
      throw validationError('SELF_ACTION', 'Это действие нельзя выполнить над собой');
    }
    return member;
  }
}
