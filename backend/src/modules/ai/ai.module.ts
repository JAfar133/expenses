import type { Database } from '../../infrastructure/database/database.ts';
import type { ExpenseRepository } from '../../storage/expense.repository.ts';
import type { ExpenseEditor } from '../expenses/expense-editor.ts';
import { ExpenseAiRepository } from '../expense-ai/expense-ai.repository.ts';
import { ReceiptAnalysisService } from '../expense-ai/receipt-analysis.service.ts';
import { ItemsRepository } from '../items/items.repository.ts';
import { ItemsService } from '../items/items.service.ts';
import { LlmRepository } from '../llm/llm.repository.ts';
import { LlmService } from '../llm/llm.service.ts';
import { LlmSettingsRepository, type LlmDefaults } from '../llm/llm.settings.ts';
import type { LlmProvider } from '../llm/llm.types.ts';
import { SecretBox } from '../llm/secret-box.ts';
import type { ReceiptsRepository } from '../receipts/receipts.repository.ts';
import type { ReceiptsService } from '../receipts/receipts.service.ts';

export interface AiModuleOptions {
  database: Database;
  expenses: ExpenseRepository;
  editor: ExpenseEditor;
  receipts: ReceiptsService;
  receiptsRepository: ReceiptsRepository;
  provider: LlmProvider;
  /** Master key for the stored API key (SECRETS_KEY) */
  secretsKey?: string;
  defaults: LlmDefaults;
  now?: () => Date;
}

/** Everything of v4 (items and AI) assembled in one place, so the server and the tests wire it the same way. */
export interface AiModule {
  items: ItemsRepository;
  itemsService: ItemsService;
  llm: LlmService;
  llmSettings: LlmSettingsRepository;
  llmRepository: LlmRepository;
  analysis: ReceiptAnalysisService;
}

export function createAiModule(options: AiModuleOptions): AiModule {
  const { database, expenses, editor, receipts, receiptsRepository } = options;
  const items = new ItemsRepository();
  const llmSettings = new LlmSettingsRepository(
    database,
    new SecretBox(options.secretsKey),
    options.defaults,
  );
  const llmRepository = new LlmRepository(database);
  const llm = new LlmService({
    settings: llmSettings,
    repository: llmRepository,
    provider: options.provider,
  });
  return {
    items,
    itemsService: new ItemsService({
      database,
      repository: items,
      editor,
      expenses,
      access: receiptsRepository,
    }),
    llm,
    llmSettings,
    llmRepository,
    analysis: new ReceiptAnalysisService({
      llm,
      receipts,
      expenses,
      items,
      repository: new ExpenseAiRepository(),
      editor,
      now: options.now,
    }),
  };
}
