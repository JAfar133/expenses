import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import type { ExpenseService } from '../expenses/expenses.service.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type { SyncService } from '../sync/sync.service.ts';
import type { ActiveKey } from './api-keys.repository.ts';
import type { BankImportsRepository, ImportRecord, ImportStatus } from './imports.repository.ts';
import { categoryForMerchant } from './merchant-category.ts';
import type { ParsedPurchase } from './parsers/parser.types.ts';
import { parserFor } from './parsers/registry.ts';

export interface NotificationPayload {
  source: string;
  title: string;
  body: string;
}

/** What the client is told; `created` and `duplicate` are successes. */
export type Outcome =
  | { status: 'created'; transactionId: string }
  | { status: 'duplicate'; transactionId: string | null }
  | { status: Exclude<ImportStatus, 'created'>; message: string };

export type ImportResult = Outcome | { status: 'unknown_source' };

export interface BankImportOptions {
  database: Database;
  imports: BankImportsRepository;
  expenses: Pick<ExpenseService, 'create' | 'getCards'>;
  groups: Pick<GroupsRepository, 'categoryNames'>;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
}

/** The category used when nothing better is known about a merchant. */
const FALLBACK_CATEGORY = 'другое';

/**
 * Turns a bank notification into an expense of the key's group. Reading is the bank's parser; creating is the
 * ordinary expense service (cards, categories, currencies, Excel mirror all work as for an expense typed by hand).
 * Nothing is created from a text that is not understood, and one real operation is created once.
 */
export class BankImportService {
  constructor(private readonly options: BankImportOptions) {}

  async import(key: ActiveKey, payload: NotificationPayload): Promise<ImportResult> {
    const parser = parserFor(payload.source);
    if (!parser) return { status: 'unknown_source' };

    const base = {
      groupId: key.groupId,
      keyId: key.id,
      source: parser.source,
      title: payload.title,
      body: payload.body,
    };
    const parsed = parser.parse(payload.title, payload.body);
    if (parsed.kind === 'unsupported') {
      await this.options.imports.recordFailure({ ...base, status: 'unsupported' });
      return { status: 'unsupported', message: 'Этот вид уведомлений не импортируется' };
    }
    if (parsed.kind === 'error') {
      await this.options.imports.recordFailure({
        ...base,
        status: 'parse_error',
        errorCode: parsed.reason,
      });
      return { status: 'parse_error', message: parsed.reason };
    }

    const { purchase } = parsed;
    const details = {
      ...base,
      merchant: purchase.merchant,
      amount: purchase.amount,
      currency: purchase.currency,
      cardLast4: purchase.cardLast4,
      occurredAt: purchase.occurredAt,
    };
    try {
      const result = await this.options.database.transaction((tx) =>
        this.createExpense(tx, key, parser.source, purchase, details),
      );
      if (result.status === 'created' && this.options.sync.enabled) {
        void this.options.sync.requestCycle().catch(() => undefined);
      }
      if (result.status === 'created' || result.status === 'duplicate') return result;
      await this.options.imports.recordFailure({ ...details, status: result.status });
      return result;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      await this.options.imports.recordFailure({ ...details, status: 'error', errorCode: code });
      if (error instanceof AppError && error.statusCode < 500) {
        return { status: 'error', message: error.message };
      }
      throw error;
    }
  }

  private async createExpense(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    key: ActiveKey,
    source: string,
    purchase: ParsedPurchase,
    details: Omit<ImportRecord, 'status'>,
  ): Promise<Outcome> {
    const { imports, expenses, groups } = this.options;
    const scope = { userId: key.userId, groupId: key.groupId, role: key.role };

    // The card is found by its last four digits; an unclear match never picks a card by guess
    const mine = new Set(await expenses.getCards(scope, tx));
    const named = (await imports.cardsByLast4(key.groupId, purchase.cardLast4, tx)).filter((name) =>
      mine.has(name),
    );
    if (named.length === 0) {
      return {
        status: 'card_not_found',
        message: `Нет карты с последними цифрами ${purchase.cardLast4}: укажите их в настройках карты`,
      };
    }
    if (named.length > 1) {
      return {
        status: 'card_ambiguous',
        message: `Несколько карт заканчиваются на ${purchase.cardLast4}`,
      };
    }

    const fingerprint = fingerprintOf(key.groupId, source, purchase);
    const claimed = await imports.claim({ ...details, status: 'created', fingerprint }, tx);
    if (!claimed) {
      return {
        status: 'duplicate',
        transactionId: await imports.existingExpense(key.groupId, fingerprint, tx),
      };
    }

    const categories = await groups.categoryNames(key.groupId, tx);
    const category = await this.categoryFor(key, purchase.merchant, categories, tx);
    const saved = await expenses.create(
      tx,
      {
        date: purchase.localDate,
        card: named[0]!,
        category,
        name: purchase.merchant.slice(0, 255),
        amount: purchase.amount,
        currency: purchase.currency,
        nameSource: 'manual',
        dateSource: 'manual',
      },
      { username: key.username, scope },
    );
    await imports.attachExpense(claimed, saved.id, tx);
    return { status: 'created', transactionId: saved.id };
  }

  /** What the group did with this shop before (the same or a similar name); else the key's category; else «другое»; else the first. */
  private async categoryFor(
    key: ActiveKey,
    merchant: string,
    categories: string[],
    tx: Parameters<BankImportsRepository['pastExpenses']>[1],
  ): Promise<string> {
    const known = categoryForMerchant(
      merchant,
      await this.options.imports.pastExpenses(key.groupId, tx),
    );
    if (known && categories.includes(known)) return known;
    if (key.defaultCategory && categories.includes(key.defaultCategory)) return key.defaultCategory;
    if (categories.includes(FALLBACK_CATEGORY)) return FALLBACK_CATEGORY;
    const first = categories[0];
    if (!first) throw new AppError(422, 'NO_CATEGORIES', 'В группе нет категорий');
    return first;
  }
}

/**
 * One real operation: the bank, the card, the amount, the currency, the merchant and the moment (to the minute).
 * Two purchases of the same amount in the same shop are different operations unless they are at the same minute.
 */
function fingerprintOf(groupId: string, source: string, purchase: ParsedPurchase): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        groupId,
        source,
        purchase.cardLast4,
        purchase.amount.toFixed(2),
        purchase.currency,
        purchase.merchant.toLowerCase(),
        purchase.occurredAt.toISOString(),
      ]),
    )
    .digest('hex');
}
