import { createHash } from 'node:crypto';
import { AppError } from '../../errors/app-error.ts';
import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import type { ExpenseEditor } from '../expenses/expense-editor.ts';
import type { ExpenseService } from '../expenses/expenses.service.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import type { SyncService } from '../sync/sync.service.ts';
import type { ActiveKey } from './api-keys.repository.ts';
import type {
  ImportLogRepository,
  LogStatus,
  PendingWalletEvent,
} from './import-log.repository.ts';
import type {
  BankImportsRepository,
  CrossSourceMatch,
  ImportStatus,
} from './imports.repository.ts';
import { categoryForMerchant, merchantWords, sameShop } from './merchant-category.ts';
import type { ParsedPurchase } from './parsers/parser.types.ts';
import { parserFor } from './parsers/registry.ts';

/** What the request carried: the three common fields and the whole JSON as it came. */
export interface NotificationPayload {
  source: string;
  title: string;
  body: string;
  raw: Record<string, unknown>;
}

/** What the client is told. `created`, `duplicate` and `unrecognized` are accepted requests. */
export type ImportResult =
  | { status: 'created'; transactionId: string }
  | { status: 'duplicate'; transactionId: string | null }
  | { status: 'unrecognized'; importId: string; message: string }
  | { status: 'unknown_source'; importId: string }
  | { status: Exclude<ImportStatus, 'created'>; message: string; importId: string };

/** How a purchase ended inside the transaction (the log and the answer are made from it). */
type Outcome =
  | { status: 'created'; transactionId: string; merged: string[] }
  | {
      status: 'duplicate';
      transactionId: string | null;
      match: Record<string, unknown>;
      rename?: Rename;
    }
  | { status: 'card_not_found' | 'card_ambiguous'; message: string };

interface Rename {
  expenseId: string;
  from: string;
  to: string;
}

export interface BankImportOptions {
  database: Database;
  imports: BankImportsRepository;
  log: ImportLogRepository;
  expenses: Pick<ExpenseService, 'create' | 'getCards'>;
  editor: Pick<ExpenseEditor, 'update'>;
  groups: Pick<GroupsRepository, 'categoryNames'>;
  sync: Pick<SyncService, 'requestCycle' | 'enabled'>;
  now?: () => Date;
}

/** The category used when nothing better is known about a merchant. */
const FALLBACK_CATEGORY = 'другое';

/** One purchase can come from two places (the bank's notice and Wallet) at nearly the same moment. */
const SAME_PURCHASE_WINDOW_MS = 20 * 60_000;

/** The source whose merchant name is preferred: Wallet writes the name the way a person would. */
const PRIORITY_SOURCE = 'apple_wallet';

/**
 * Turns a notification into an expense of the key's group. Reading is the source's parser; creating is the ordinary
 * expense service (cards, categories, currencies, Excel mirror all work as for an expense typed by hand). Nothing is
 * created from a text that is not understood, one real operation is created once (also when two sources report it),
 * and every authorised request is written to the diagnostic log with its whole JSON.
 */
export class BankImportService {
  constructor(private readonly options: BankImportOptions) {}

  async import(key: ActiveKey, payload: NotificationPayload): Promise<ImportResult> {
    const receivedAt = (this.options.now ?? (() => new Date()))();
    const parser = parserFor(payload.source);
    const source = parser?.source ?? payload.source.trim().toLowerCase();
    const entry = { groupId: key.groupId, keyId: key.id, source, rawPayload: payload.raw };
    if (!parser) {
      const importId = await this.options.log.add({ ...entry, status: 'unknown_source' });
      return { status: 'unknown_source', importId };
    }

    const parsed = parser.parse({
      title: payload.title,
      body: payload.body,
      fields: payload.raw,
      receivedAt,
      timezone: key.timezone,
    });
    if (parsed.kind !== 'expense') {
      const status = parsed.kind === 'unsupported' ? 'unsupported' : 'parse_error';
      const message =
        parsed.kind === 'unsupported' ? 'Этот вид уведомлений не импортируется' : parsed.reason;
      return this.failure(entry, status, message);
    }

    const { purchase } = parsed;
    const summary = summaryOf(purchase);
    let outcome: Outcome;
    try {
      outcome = await this.options.database.transaction((tx) =>
        this.process(tx, key, source, purchase, payload),
      );
    } catch (error) {
      const message = error instanceof AppError ? error.message : 'Внутренняя ошибка сервера';
      if (error instanceof AppError && error.statusCode < 500) {
        return this.accepted(entry, source, 'error', message, summary);
      }
      await this.options.log.add({ ...entry, status: 'error', error: message, parsed: summary });
      throw error;
    }

    if (outcome.status === 'created') {
      if (this.options.sync.enabled) void this.options.sync.requestCycle().catch(() => undefined);
      await this.options.log.add({
        ...entry,
        status: 'created',
        parsed: summary,
        expenseId: outcome.transactionId,
        match: outcome.merged.length > 0 ? { mergedWalletEvents: outcome.merged } : null,
      });
      return { status: 'created', transactionId: outcome.transactionId };
    }
    if (outcome.status === 'duplicate') {
      const renamed = outcome.rename ? await this.rename(key, outcome.rename) : undefined;
      await this.options.log.add({
        ...entry,
        status: 'duplicate',
        parsed: summary,
        expenseId: outcome.transactionId,
        match: { ...outcome.match, ...(renamed ? { renamed } : {}) },
      });
      return { status: 'duplicate', transactionId: outcome.transactionId };
    }
    return this.accepted(entry, source, outcome.status, outcome.message, summary);
  }

  /** A request that made no expense: kept in the log; Wallet is told «unrecognized» (accepted), the bank's source the reason. */
  private async accepted(
    entry: { groupId: string; keyId: string; source: string; rawPayload: Record<string, unknown> },
    source: string,
    status: ImportStatus,
    message: string,
    parsed: Record<string, unknown> | null,
  ): Promise<ImportResult> {
    const wallet = source === PRIORITY_SOURCE;
    // Wallet's request that made no expense stays «unrecognized»: accepted, and a later bank notice may claim it
    const logged: LogStatus = status === 'error' ? 'error' : wallet ? 'unrecognized' : status;
    const importId = await this.options.log.add({
      ...entry,
      status: logged,
      error: message,
      parsed,
    });
    if (wallet) return { status: 'unrecognized', importId, message };
    return { status: status as Exclude<ImportStatus, 'created'>, message, importId };
  }

  private async failure(
    entry: { groupId: string; keyId: string; source: string; rawPayload: Record<string, unknown> },
    status: 'unsupported' | 'parse_error',
    message: string,
  ): Promise<ImportResult> {
    return this.accepted(entry, entry.source, status, message, null);
  }

  private async process(
    tx: SqlExecutor,
    key: ActiveKey,
    source: string,
    purchase: ParsedPurchase,
    payload: NotificationPayload,
  ): Promise<Outcome> {
    const { imports, log, expenses, groups } = this.options;
    const scope = { userId: key.userId, groupId: key.groupId, role: key.role };
    const fingerprint = fingerprintOf(key.groupId, source, purchase);

    // 1. The same request again
    const again = await imports.existingExpense(key.groupId, fingerprint, tx);
    if (again) {
      return {
        status: 'duplicate',
        transactionId: again,
        match: { reason: 'same request', expenseId: again },
      };
    }

    // 2. The same purchase from another source
    const same = await this.sameElsewhere(tx, key, source, purchase);
    if (same) {
      const rename =
        source === PRIORITY_SOURCE && same.expenseName === (same.merchant ?? '')
          ? renameOf(same, purchase.merchant)
          : undefined;
      return {
        status: 'duplicate',
        transactionId: same.expenseId,
        match: {
          reason: same.reason,
          importId: same.importId,
          expenseId: same.expenseId,
          source: same.source,
        },
        ...(rename ? { rename } : {}),
      };
    }

    // 3. The card: by digits, else by the source's name for it; never by guess
    const mine = new Set(await expenses.getCards(scope, tx));
    const card = await this.cardOf(tx, key.groupId, purchase, mine);
    if ('failure' in card) return card.failure;

    const claimed = await imports.claim(
      {
        groupId: key.groupId,
        keyId: key.id,
        source,
        status: 'created',
        fingerprint,
        merchant: purchase.merchant,
        amount: purchase.amount,
        currency: purchase.currency,
        cardLast4: purchase.cardLast4 ?? null,
        occurredAt: purchase.occurredAt,
        title: payload.title,
        body: payload.body,
      },
      tx,
    );
    if (!claimed) {
      return {
        status: 'duplicate',
        transactionId: await imports.existingExpense(key.groupId, fingerprint, tx),
        match: { reason: 'same request' },
      };
    }

    // 4. Wallet requests that wait for this very purchase give it their (better) shop name
    const waiting = await this.waitingWallet(tx, key.groupId, source, purchase);
    const name = waiting[0]?.merchant ?? purchase.merchant;
    const categories = await groups.categoryNames(key.groupId, tx);
    const category = await this.categoryFor(key, name, purchase, categories, tx);
    const saved = await expenses.create(
      tx,
      {
        date: purchase.localDate,
        card: card.name,
        category,
        name: name.slice(0, 255),
        amount: purchase.amount,
        currency: purchase.currency,
        nameSource: 'manual',
        dateSource: 'manual',
      },
      { username: key.username, scope },
    );
    await imports.attachExpense(claimed, saved.id, tx);
    const merged = waiting.map((event) => event.id);
    await log.markMerged(merged, saved.id, tx);
    return { status: 'created', transactionId: saved.id, merged };
  }

  /** An earlier import from another source that is this purchase: the same amount, near in time, alike by shop or card. */
  private async sameElsewhere(
    tx: SqlExecutor,
    key: ActiveKey,
    source: string,
    purchase: ParsedPurchase,
  ): Promise<(CrossSourceMatch & { reason: 'merchant' | 'card' }) | undefined> {
    const candidates = await this.options.imports.otherSourceMatches(
      key.groupId,
      source,
      purchase.amount,
      purchase.currency,
      purchase.occurredAt,
      SAME_PURCHASE_WINDOW_MS,
      tx,
    );
    for (const candidate of candidates) {
      if (candidate.merchant && sameShop(candidate.merchant, purchase.merchant)) {
        return { ...candidate, reason: 'merchant' };
      }
      const sameCard =
        (purchase.cardLast4 !== undefined && candidate.cardLast4 === purchase.cardLast4) ||
        (purchase.cardHint !== undefined && namesAlike(purchase.cardHint, candidate.expenseCard));
      if (sameCard) return { ...candidate, reason: 'card' };
    }
    return undefined;
  }

  /** Wallet requests received earlier and not turned into an expense, for the same amount, time and shop. */
  private async waitingWallet(
    tx: SqlExecutor,
    groupId: string,
    source: string,
    purchase: ParsedPurchase,
  ): Promise<PendingWalletEvent[]> {
    if (source === PRIORITY_SOURCE) return [];
    const events = await this.options.log.pendingWallet(
      groupId,
      purchase.amount,
      purchase.currency,
      purchase.occurredAt,
      SAME_PURCHASE_WINDOW_MS,
      tx,
    );
    return events.filter((event) => sameShop(event.merchant, purchase.merchant));
  }

  private async cardOf(
    tx: SqlExecutor,
    groupId: string,
    purchase: ParsedPurchase,
    mine: Set<string>,
  ): Promise<
    | { name: string }
    | { failure: Extract<Outcome, { status: 'card_not_found' | 'card_ambiguous' }> }
  > {
    let named: string[];
    let described: string;
    if (purchase.cardLast4) {
      named = (await this.options.imports.cardsByLast4(groupId, purchase.cardLast4, tx)).filter(
        (name) => mine.has(name),
      );
      described = `с последними цифрами ${purchase.cardLast4}`;
    } else if (purchase.cardHint) {
      named = [...mine].filter((name) => namesAlike(purchase.cardHint!, name));
      described = `«${purchase.cardHint}»`;
    } else {
      return {
        failure: { status: 'card_not_found', message: 'В запросе нет данных о карте' },
      };
    }
    if (named.length === 1) return { name: named[0]! };
    if (named.length === 0) {
      return {
        failure: {
          status: 'card_not_found',
          message: `Нет карты ${described}: укажите цифры в настройках карты`,
        },
      };
    }
    return {
      failure: { status: 'card_ambiguous', message: `Несколько карт подходят: ${described}` },
    };
  }

  /**
   * What the group did with this shop before (the same or a similar name); else the category the source names, if the
   * group has exactly that one; else the key's category; else «другое»; else the first.
   */
  private async categoryFor(
    key: ActiveKey,
    merchant: string,
    purchase: ParsedPurchase,
    categories: string[],
    tx: SqlExecutor,
  ): Promise<string> {
    const known = categoryForMerchant(
      merchant,
      await this.options.imports.pastExpenses(key.groupId, tx),
    );
    if (known && categories.includes(known)) return known;
    const hinted = purchase.categoryHint
      ? categories.find((name) => name.toLowerCase() === purchase.categoryHint!.toLowerCase())
      : undefined;
    if (hinted) return hinted;
    if (key.defaultCategory && categories.includes(key.defaultCategory)) return key.defaultCategory;
    if (categories.includes(FALLBACK_CATEGORY)) return FALLBACK_CATEGORY;
    const first = categories[0];
    if (!first) throw new AppError(422, 'NO_CATEGORIES', 'В группе нет категорий');
    return first;
  }

  /** The expense of another source gets the preferred shop name, if nobody changed it. Never fails the request. */
  private async rename(
    key: ActiveKey,
    rename: Rename,
  ): Promise<Record<string, string> | undefined> {
    try {
      await this.options.editor.update(
        rename.expenseId,
        { name: rename.to.slice(0, 255) },
        { userId: key.userId, username: key.username, groupId: key.groupId, role: key.role },
      );
      return { from: rename.from, to: rename.to };
    } catch {
      return undefined;
    }
  }
}

const renameOf = (match: CrossSourceMatch, to: string): Rename | undefined =>
  match.expenseName === to
    ? undefined
    : { expenseId: match.expenseId, from: match.expenseName, to };

/** Two names that share all the words of the shorter one («IDBank Visa» and «Visa Digital (IDBank)»). */
function namesAlike(a: string, b: string): boolean {
  const left = new Set(merchantWords(a));
  const right = new Set(merchantWords(b));
  if (left.size === 0 || right.size === 0) return false;
  const shared = [...left].filter((word) => right.has(word));
  return shared.length === left.size || shared.length === right.size;
}

const summaryOf = (purchase: ParsedPurchase): Record<string, unknown> => ({
  amount: purchase.amount,
  currency: purchase.currency,
  merchant: purchase.merchant,
  occurredAt: purchase.occurredAt.toISOString(),
  localDate: purchase.localDate,
  ...(purchase.cardLast4 ? { cardLast4: purchase.cardLast4 } : {}),
  ...(purchase.cardHint ? { cardHint: purchase.cardHint } : {}),
  ...(purchase.categoryHint ? { categoryHint: purchase.categoryHint } : {}),
  ...(purchase.transactionId ? { transactionId: purchase.transactionId } : {}),
});

/**
 * One real operation of one source: the card, the amount, the currency, the merchant and the moment (to the minute);
 * or the source's own id of the operation when it gives one. Two purchases of the same amount in the same shop are
 * different operations unless they are at the same minute.
 */
function fingerprintOf(groupId: string, source: string, purchase: ParsedPurchase): string {
  const identity = purchase.transactionId
    ? ['transaction', purchase.transactionId]
    : [
        purchase.cardLast4 ?? null,
        purchase.amount.toFixed(2),
        purchase.currency,
        purchase.merchant.toLowerCase(),
        purchase.occurredAt.toISOString().slice(0, 16),
      ];
  return createHash('sha256')
    .update(JSON.stringify([groupId, source, ...identity]))
    .digest('hex');
}
