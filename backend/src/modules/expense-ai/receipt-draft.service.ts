import { AppError, validationError } from '../../errors/app-error.ts';
import { todayIn } from '../analytics/date-math.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { LlmRepository } from '../llm/llm.repository.ts';
import { aiCategoryOff } from '../llm/llm.types.ts';
import type { ReceiptsRepository } from '../receipts/receipts.repository.ts';
import type { LlmService } from '../llm/llm.service.ts';
import type { ParsedItem } from '../llm/receipt-parser.ts';
import { detectReceiptType } from '../receipts/receipt-file.ts';
import { MAX_RECEIPT_BYTES } from '../receipts/receipts.service.ts';
import { believableDate } from './plan-receipt.ts';

/** What the form gets from a photo before the expense exists. */
export interface ReceiptDraft {
  /** Sent back with the new expense, so that the server knows which values came from the AI */
  parseId: string;
  name: string | null;
  /** The category the model chose (it fills an empty field or is offered as a hint); null when none fits */
  category: string | null;
  /** Only a believable date (not in the future, not too old) */
  date: string | null;
  items: ParsedItem[];
  total: number | null;
  currency: string | null;
  dropped: number;
}

export interface ReceiptDraftOptions {
  llm: Pick<LlmService, 'status' | 'parseReceipt'>;
  repository: Pick<LlmRepository, 'saveResult'>;
  /** Which categories the owner allowed the AI for */
  categories: Pick<ReceiptsRepository, 'aiAllowed' | 'photoAiCategories'>;
  now?: () => Date;
}

/** Reads a receipt photo for the "Add" form: nothing is saved except the attempt and its result in the usage log. */
export class ReceiptDraftService {
  constructor(private readonly options: ReceiptDraftOptions) {}

  /**
   * `category`: the category chosen in the form (the owner may have turned the AI off for it). Without it the model
   * picks one of the categories that allow both the photo and the AI; with it, the model's pick is only a suggestion.
   */
  async parse(user: AuthUser, bytes: Buffer, category?: string): Promise<ReceiptDraft> {
    if (!user.groupId) throw validationError('NO_GROUP', 'Вы не состоите в группе');
    const { categories } = this.options;
    if (category && !(await categories.aiAllowed(user.groupId, category))) throw aiCategoryOff();
    // The model always names a category when it can: it fills the empty field, or is shown to the person as a hint
    // when they chose another one. Only categories that allow the photo are offered, so applying it keeps the photo.
    const candidates = await categories.photoAiCategories(user.groupId);
    if (!category && candidates.length === 0) throw aiCategoryOff();
    if (bytes.length === 0) throw validationError('EMPTY_RECEIPT', 'Файл пустой');
    if (bytes.length > MAX_RECEIPT_BYTES) {
      throw new AppError(413, 'RECEIPT_TOO_LARGE', 'Фото слишком большое');
    }
    const type = detectReceiptType(bytes);
    if (!type) {
      throw validationError('INVALID_RECEIPT', 'Нужна фотография в формате JPEG, PNG или WebP');
    }

    const today = todayIn(user.timezone, this.options.now?.());
    const { receipt, usageId } = await this.options.llm.parseReceipt({
      groupId: user.groupId,
      username: user.username,
      expenseId: null,
      categories: candidates,
      image: { bytes, contentType: type.contentType },
      today,
    });
    const draft: ReceiptDraft = {
      parseId: usageId,
      name: receipt.name ?? null,
      category: receipt.category ?? null,
      date: believableDate(receipt.date, today) ?? null,
      items: receipt.items,
      total: receipt.total ?? null,
      currency: receipt.currency ?? null,
      dropped: receipt.dropped,
    };
    await this.options.repository.saveResult(usageId, draft);
    return draft;
  }
}
