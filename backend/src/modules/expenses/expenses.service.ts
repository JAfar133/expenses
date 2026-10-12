import type { SqlExecutor } from '../../infrastructure/database/database.ts';
import { validationError } from '../../errors/app-error.ts';
import type {
  ExpenseRepository,
  NameSuggestion,
  StoredExpense,
} from '../../storage/expense.repository.ts';
import type { ExpenseScope } from '../groups/scope.ts';
import type { GroupsRepository } from '../groups/groups.repository.ts';
import { resolveAmount, type AmountContext } from './expense-amount.ts';
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
  groups: Pick<GroupsRepository, 'editableCardNames' | 'categoryNames'>;
  /** Base currency, available currencies and rates for conversion to drams */
  currency: AmountContext;
  logger?: { warn: (object: object, message: string) => void };
}

export class ExpenseService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly options: ExpenseServiceOptions,
  ) {}

  /** Cards the user may add expenses to. */
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
    const { amount, original } = await resolveAmount(
      {
        amount: input.amount,
        currency: input.currency ?? this.options.currency.base,
        manualRate: input.rate,
      },
      this.options.currency,
    );
    const { date, card, category, name } = input;
    return this.repository.insertPending(
      db,
      { date, card, category, name, amount },
      author.username,
      original,
    );
  }

  findById(id: string): Promise<StoredExpense | undefined> {
    return this.repository.findById(id);
  }
}
