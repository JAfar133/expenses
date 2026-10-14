import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';
import type { AiLanguage } from './receipt-parser.ts';

export interface UsageSummary {
  today: number;
  month: number;
  errorsMonth: number;
}

/** Group-level AI switches and the log of parsings (the daily limit counts it). */
export class LlmRepository {
  constructor(private readonly database: Database) {}

  async groupState(
    groupId: string,
  ): Promise<{ enabled: boolean; dailyLimit: number | null; languages: AiLanguage[] }> {
    const [row] = await this.database.query<{
      ai_enabled: boolean;
      ai_daily_limit: number | null;
      ai_languages: AiLanguage[];
    }>('SELECT ai_enabled, ai_daily_limit, ai_languages FROM groups WHERE id = $1', [groupId]);
    return {
      enabled: row?.ai_enabled ?? false,
      dailyLimit: row?.ai_daily_limit ?? null,
      languages: row?.ai_languages ?? ['en', 'ru'],
    };
  }

  async setGroupLanguages(groupId: string, languages: AiLanguage[]): Promise<void> {
    await this.database.query('UPDATE groups SET ai_languages = $2::text[] WHERE id = $1', [
      groupId,
      languages,
    ]);
  }

  async setGroupEnabled(groupId: string, enabled: boolean): Promise<void> {
    await this.database.query('UPDATE groups SET ai_enabled = $2 WHERE id = $1', [
      groupId,
      enabled,
    ]);
  }

  /** Returns false when there is no such group. */
  async setGroupLimit(groupId: string, limit: number | null): Promise<boolean> {
    const rows = await this.database.query(
      'UPDATE groups SET ai_daily_limit = $2 WHERE id = $1 RETURNING id',
      [groupId, limit],
    );
    return rows.length > 0;
  }

  /** Groups with their AI state, for the administrator's page. */
  async groupsOverview(): Promise<
    { id: string; name: string; enabled: boolean; dailyLimit: number | null; usedToday: number }[]
  > {
    const rows = await this.database.query<{
      id: string;
      name: string;
      ai_enabled: boolean;
      ai_daily_limit: number | null;
      used: number;
    }>(
      `SELECT g.id, g.name, g.ai_enabled, g.ai_daily_limit,
              (SELECT count(*)::int FROM ai_usage u
                WHERE u.group_id = g.id AND u.created_at > now() - interval '24 hours') AS used
         FROM groups g ORDER BY g.name`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.ai_enabled,
      dailyLimit: row.ai_daily_limit,
      usedToday: row.used,
    }));
  }

  /** Parsings the group made in the last 24 hours. */
  async countLastDay(groupId: string): Promise<number> {
    const [row] = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ai_usage
        WHERE group_id = $1 AND created_at > now() - interval '24 hours'`,
      [groupId],
    );
    return row?.count ?? 0;
  }

  /** Returns the id of the record: a parsing made before the expense exists is claimed by it later. */
  async recordUsage(entry: {
    groupId: string;
    expenseId: string | null;
    task: string;
    model: string;
    errorCode: string | null;
    by: string;
  }): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO ai_usage (group_id, expense_id, task, model, status, error_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        entry.groupId,
        entry.expenseId,
        entry.task,
        entry.model,
        entry.errorCode ? 'error' : 'ok',
        entry.errorCode,
        entry.by,
      ],
    );
    return row!.id;
  }

  async saveResult(usageId: string, result: unknown, requestKey: string | null): Promise<void> {
    await this.database.query(
      'UPDATE ai_usage SET result = $2::jsonb, request_key = $3 WHERE id = $1',
      [usageId, JSON.stringify(result), requestKey],
    );
  }

  /**
   * A fresh successful parsing of the same request by the same user that no expense has taken yet: the answer is
   * reused instead of asking the model again (and does not count against the daily limit).
   */
  async findReusable(
    groupId: string,
    username: string,
    requestKey: string,
  ): Promise<{ id: string; result: unknown } | undefined> {
    const [row] = await this.database.query<{ id: string; result: unknown }>(
      `SELECT id, result FROM ai_usage
        WHERE group_id = $1 AND created_by = $2 AND request_key = $3 AND expense_id IS NULL
          AND status = 'ok' AND result IS NOT NULL AND created_at > now() - interval '24 hours'
        ORDER BY created_at DESC LIMIT 1`,
      [groupId, username, requestKey],
    );
    return row;
  }

  /**
   * Takes a finished parsing for an expense: only the user's own, of their group, successful, fresh and not taken
   * before. Returns what the model said, or undefined when the parsing cannot be claimed.
   */
  async claim(
    db: SqlExecutor,
    claim: { usageId: string; groupId: string; username: string; expenseId: string },
  ): Promise<{ model: string; result: unknown } | undefined> {
    const [row] = await db.query<{ model: string; result: unknown }>(
      `UPDATE ai_usage SET expense_id = $4
        WHERE id = $1 AND group_id = $2 AND created_by = $3 AND expense_id IS NULL
          AND status = 'ok' AND result IS NOT NULL AND created_at > now() - interval '24 hours'
        RETURNING model, result`,
      [claim.usageId, claim.groupId, claim.username, claim.expenseId],
    );
    return row;
  }

  async usageSummary(): Promise<UsageSummary> {
    const [row] = await this.database.query<UsageSummary>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today,
              count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS month,
              count(*) FILTER (WHERE created_at > now() - interval '30 days' AND status = 'error')::int AS "errorsMonth"
         FROM ai_usage`,
    );
    return row ?? { today: 0, month: 0, errorsMonth: 0 };
  }
}
