import { AppError } from '../../errors/app-error.ts';
import type { LlmRepository, UsageSummary } from './llm.repository.ts';
import type { LlmSettingsRepository, LlmSettingsView } from './llm.settings.ts';
import {
  aiDisabled,
  aiKeyMissing,
  aiLimitReached,
  type LlmImage,
  type LlmProvider,
} from './llm.types.ts';
import { parseReceiptAnswer, receiptRequest, type ParsedReceipt } from './receipt-parser.ts';

/** Whether the AI can be used by a group right now, and why not. */
export interface AiStatus {
  /** The administrator switched the AI on and a key is set */
  installationReady: boolean;
  groupEnabled: boolean;
  /** Both switches are on and the key is set: parsing buttons may be shown */
  available: boolean;
  /** Parsings the group may make per day (its own limit or the installation default) and how many it used in 24 hours */
  dailyLimit: number;
  usedToday: number;
}

export interface ParsedByModel {
  receipt: ParsedReceipt;
  model: string;
  /** The record of this attempt in the usage log */
  usageId: string;
}

export interface LlmServiceOptions {
  settings: LlmSettingsRepository;
  repository: LlmRepository;
  provider: LlmProvider;
}

const TASK_RECEIPT = 'receipt-parse';

/**
 * The single entry to the model for the rest of the app: switches, key, daily limit, the call itself and the
 * check of the answer. Callers never see the key or the format of a concrete provider.
 */
export class LlmService {
  constructor(private readonly options: LlmServiceOptions) {}

  async status(groupId: string | null): Promise<AiStatus> {
    const settings = await this.options.settings.load();
    const installationReady = settings.enabled && settings.apiKey !== undefined;
    const group = groupId ? await this.options.repository.groupState(groupId) : undefined;
    const groupEnabled = group?.enabled ?? false;
    return {
      installationReady,
      groupEnabled,
      available: installationReady && groupEnabled,
      dailyLimit: group?.dailyLimit ?? settings.dailyLimit,
      usedToday: groupId ? await this.options.repository.countLastDay(groupId) : 0,
    };
  }

  async adminView(): Promise<LlmSettingsView & { usage: UsageSummary }> {
    return {
      ...(await this.options.settings.view()),
      usage: await this.options.repository.usageSummary(),
    };
  }

  /** Asks the provider whether the key works and the model exists (the answer never contains the key). */
  async check(): Promise<{ model: string }> {
    const { apiKey, model } = await this.options.settings.load();
    if (!apiKey) throw aiKeyMissing();
    await this.options.provider.check({ apiKey, model });
    return { model };
  }

  /** Reads a receipt photo. Every attempt that reached the model is counted against the group's daily limit. */
  async parseReceipt(request: {
    groupId: string;
    username: string;
    /** The expense the photo belongs to; none while the form is still being filled in */
    expenseId: string | null;
    image: LlmImage;
    /** Categories the model may pick from (the form has none chosen yet); none: no category is asked for */
    categories?: string[];
    /** Today in the user's time zone, YYYY-MM-DD: helps with receipts without a year */
    today: string;
  }): Promise<ParsedByModel> {
    const { settings, repository, provider } = this.options;
    const config = await settings.load();
    const group = await repository.groupState(request.groupId);
    if (!config.enabled || !group.enabled) throw aiDisabled();
    if (!config.apiKey) throw aiKeyMissing();

    const limit = group.dailyLimit ?? config.dailyLimit;
    if ((await repository.countLastDay(request.groupId)) >= limit) throw aiLimitReached();

    const usage = {
      groupId: request.groupId,
      expenseId: request.expenseId,
      task: TASK_RECEIPT,
      model: config.model,
      by: request.username,
    };
    try {
      const answer = await provider.generateJson(
        receiptRequest(request.image, request.today, request.categories),
        { apiKey: config.apiKey, model: config.model },
      );
      const receipt = parseReceiptAnswer(answer, request.categories);
      const usageId = await repository.recordUsage({ ...usage, errorCode: null });
      return { receipt, model: config.model, usageId };
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'AI_UNAVAILABLE';
      await repository.recordUsage({ ...usage, errorCode: code });
      throw error;
    }
  }
}
