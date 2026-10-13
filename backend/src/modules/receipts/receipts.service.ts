import { randomUUID } from 'node:crypto';
import {
  AppError,
  forbiddenError,
  notFoundError,
  validationError,
} from '../../errors/app-error.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import { detectReceiptType } from './receipt-file.ts';
import type { ReceiptExpense, ReceiptSettings, ReceiptsRepository } from './receipts.repository.ts';
import type { ReceiptStore } from './receipts.store.ts';

/** A member may add a photo to their own fresh expense even when editing is off for members. */
const FRESH_MINUTES = 30;

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

export interface ReceiptsServiceOptions {
  repository: ReceiptsRepository;
  store: ReceiptStore;
  groups: Pick<GroupsRepository, 'memberEditMinutes' | 'canAddToCardOf'>;
  now?: () => Date;
}

/** Receipt photos: who may see, attach and remove them. Files are never deleted from the disk. */
export class ReceiptsService {
  constructor(private readonly options: ReceiptsServiceOptions) {}

  settings(user: AuthUser): Promise<ReceiptSettings> {
    if (!user.groupId) return Promise.resolve({ enabled: false, categories: [] });
    return this.options.repository.settings(user.groupId);
  }

  async saveSettings(user: AuthUser, input: unknown): Promise<void> {
    if (user.role !== 'owner' || !user.groupId) throw forbiddenError();
    const body = input as Partial<ReceiptSettings> | null;
    if (
      typeof body?.enabled !== 'boolean' ||
      !Array.isArray(body.categories) ||
      !body.categories.every((name) => typeof name === 'string')
    ) {
      throw validationError('INVALID_RECEIPT_SETTINGS', 'Некорректные настройки фото чеков');
    }
    await this.options.repository.saveSettings(user.groupId, {
      enabled: body.enabled,
      categories: body.categories,
    });
  }

  /** The photo of an expense the user may see; undefined when there is none. */
  async read(user: AuthUser, expenseId: string) {
    const expense = await this.visibleExpense(user, expenseId);
    const attachment = await this.options.repository.current(expense.id);
    if (!attachment) return undefined;
    return {
      contentType: attachment.contentType,
      bytes: await this.options.store.read(attachment.filePath),
    };
  }

  async attach(user: AuthUser, expenseId: string, bytes: Buffer): Promise<void> {
    const expense = await this.visibleExpense(user, expenseId);
    await this.requireMayChange(user, expense);

    const settings = await this.options.repository.settings(expense.groupId);
    if (!settings.enabled || !settings.categories.includes(expense.category)) {
      throw new AppError(
        403,
        'RECEIPTS_OFF',
        'Фото чека для этой категории не включено владельцем группы',
      );
    }
    if (expense.deleted) throw new AppError(409, 'EXPENSE_DELETED', 'Запись удалена');
    if (bytes.length === 0) throw validationError('EMPTY_RECEIPT', 'Файл пустой');
    if (bytes.length > MAX_RECEIPT_BYTES) {
      throw new AppError(413, 'RECEIPT_TOO_LARGE', 'Фото слишком большое');
    }
    const type = detectReceiptType(bytes);
    if (!type)
      throw validationError('INVALID_RECEIPT', 'Нужна фотография в формате JPEG, PNG или WebP');

    const id = randomUUID();
    const filePath = `${expense.groupId}/${expense.id}/${id}.${type.extension}`;
    // The file first: a row never points to a missing file (an orphan file after a failure is harmless)
    await this.options.store.save(filePath, bytes);
    await this.options.repository.replace(
      expense,
      { id, filePath, contentType: type.contentType, size: bytes.length },
      user.username,
    );
  }

  async remove(user: AuthUser, expenseId: string): Promise<void> {
    const expense = await this.visibleExpense(user, expenseId);
    await this.requireMayChange(user, expense);
    await this.options.repository.replace(expense, undefined, user.username);
  }

  /** An expense of the user's group on a card the user may see; anything else looks like a missing one. */
  private async visibleExpense(user: AuthUser, expenseId: string): Promise<ReceiptExpense> {
    const expense = await this.options.repository.findExpense(expenseId);
    if (!expense || !user.groupId || expense.groupId !== user.groupId) throw notFoundError();
    // A member sees the photo only of an expense on a card they have access to (the same rule as the lists)
    if (user.role !== 'owner' && !(await this.options.repository.memberSees(user.id, expense.id))) {
      throw notFoundError();
    }
    return expense;
  }

  /** The owner changes any photo; a member only on their own expense inside the time window. */
  private async requireMayChange(user: AuthUser, expense: ReceiptExpense): Promise<void> {
    if (user.role === 'owner') return;
    const { groups } = this.options;
    if (expense.createdBy !== user.username) throw forbiddenError();
    if (!(await groups.canAddToCardOf(user.id, expense.id))) throw forbiddenError();

    const minutes = Math.max(await groups.memberEditMinutes(user.groupId), FRESH_MINUTES);
    const age =
      (this.options.now ?? (() => new Date()))().getTime() - Date.parse(expense.createdAt);
    if (age > minutes * 60_000) {
      throw new AppError(403, 'EDIT_WINDOW_CLOSED', 'Срок, когда эту трату можно исправить, истёк');
    }
  }
}
