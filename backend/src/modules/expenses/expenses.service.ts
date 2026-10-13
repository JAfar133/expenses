import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import { validationError } from '../../errors/app-error.ts';
import type {
  ExpenseRepository,
  NameSuggestion,
  StoredExpense,
} from '../../storage/expense.repository.ts';
import type { ExpenseScope } from '../groups/scope.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import { resolveMoney, type AmountContext } from './expense-amount.ts';
import type { ExpenseAiRepository } from '../expense-ai/expense-ai.repository.ts';
import type { ParseClaims } from '../expense-ai/parse-claims.ts';
import type { ItemsRepository } from '../items/items.repository.ts';
import type { CreateExpenseInput } from './expenses.schema.ts';

/** How many "category + name" pairs we give the form for suggestions. */
const NAME_SUGGESTIONS_LIMIT = 500;

/** Who adds an expense: the login goes into the record, the scope decides which cards are allowed. */
export interface ExpenseAuthor {
  username: string;
  scope: ExpenseScope;
}

export interface ExpenseServiceOptions {
  /** Cards and categories of the user's group */
  groups: Pick<
    GroupsRepository,
    'editableCardNames' | 'editableCards' | 'categoryNames' | 'moneyContext'
  >;
  /** Base currency, available currencies and rates for conversion to drams */
  currency: AmountContext;
  /** Positions saved together with a new expense */
  items?: ItemsRepository;
  /** A receipt parsed in the form before saving: tells which values of the new expense came from the AI */
  aiParse?: { claims: ParseClaims; marks: ExpenseAiRepository };
  logger?: { warn: (object: object, message: string) => void };
}

export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly options: ExpenseServiceOptions,
  ) {}

  /** Cards the user may add expenses to, with their currencies. */
  getCardsWithCurrency(scope: ExpenseScope) {
    return this.options.groups.editableCards(scope);
  }

  /** Names of the cards the user may add expenses to. */
  getCards(scope: ExpenseScope, db?: SqlExecutor): Promise<string[]> {
    return this.options.groups.editableCardNames(scope, db);
  }

  /** Categories of the user's group: the owner's list, nothing else. */
  getCategories(scope: ExpenseScope): Promise<string[]> {
    return this.options.groups.categoryNames(scope.groupId);
  }

  /** Name suggestions: from most to least frequent. An unavailable DB does not break the form. */
  async getNameSuggestions(
    scope: ExpenseScope,
    limit = NAME_SUGGESTIONS_LIMIT,
  ): Promise<NameSuggestion[]> {
    try {
      return await this.repository.listNameSuggestions(limit, scope);
    } catch (error) {
      this.options.logger?.warn({ err: error }, 'Failed to read name suggestions from database');
      return [];
    }
  }

  /** Saves the expense to the DB. It reaches Excel through the sync queue. */
  async create(
    db: SqlExecutor,
    input: CreateExpenseInput,
    author: ExpenseAuthor,
  ): Promise<StoredExpense> {
    if (!(await this.getCards(author.scope, db)).includes(input.card)) {
      throw validationError('INVALID_CARD', 'Выберите карту из списка');
    }
    if (
      !(await this.options.groups.categoryNames(author.scope.groupId, db)).includes(input.category)
    ) {
      throw validationError('INVALID_CATEGORY', 'Выберите категорию из списка');
    }
    const currencies = await this.options.groups.moneyContext(author.scope.groupId, input.card, db);
    if (!currencies) throw validationError('INVALID_CARD', 'Выберите карту из списка');
    const money = await resolveMoney(
      { amount: input.amount, currency: input.currency, manualRate: input.rate },
      currencies,
      this.options.currency,
    );
    const { amount, original, ...kept } = money;
    const { date, card, category, name } = input;
    const saved = await this.repository.insertPending(
      db,
      { date, card, category, name, amount },
      author.username,
      original,
      kept,
      { name: input.nameSource ?? 'manual', date: input.dateSource ?? 'manual' },
    );
    const items = input.items ?? [];
    const claimed = await this.claimParse(db, input, author, saved.id, items);
    if (items.length > 0 && this.options.items) {
      await this.options.items.replace(
        db,
        { id: saved.id, groupId: author.scope.groupId! },
        items.map(({ name: itemName, price, quantity }, index) => ({
          name: itemName,
          price,
          quantity,
          source: claimed?.itemIsAi[index] ? ('ai' as const) : ('manual' as const),
        })),
      );
    }
    return saved;
  }

  /** Takes the receipt parsed in the form (if the request names one) and marks what came from it. */
  private async claimParse(
    db: SqlExecutor,
    input: CreateExpenseInput,
    author: ExpenseAuthor,
    expenseId: string,
    items: NonNullable<CreateExpenseInput['items']>,
  ) {
    const { aiParse } = this.options;
    if (!input.aiParseId || !aiParse || !author.scope.groupId) return undefined;
    const claimed = await aiParse.claims.claim(
      db,
      {
        usageId: input.aiParseId,
        groupId: author.scope.groupId,
        username: author.username,
        expenseId,
      },
      { name: input.name, date: input.date, items },
    );
    if (claimed) await aiParse.marks.markCreated(db, expenseId, claimed);
    return claimed;
  }

  findById(id: string): Promise<StoredExpense | undefined> {
    return this.repository.findById(id);
  }
}
