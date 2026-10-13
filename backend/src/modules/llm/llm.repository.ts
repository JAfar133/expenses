import type { Database } from '../../infrastructure/database/database.ts';

export interface UsageSummary {
  today: number;
  month: number;
  errorsMonth: number;
}

/** Group-level AI switches and the log of parsings (the daily limit counts it). */
export class LlmRepository {
  constructor(private readonly database: Database) {}

  async groupState(groupId: string): Promise<{ enabled: boolean; dailyLimit: number | null }> {
    const [row] = await this.database.query<{ ai_enabled: boolean; ai_daily_limit: number | null }>(
      'SELECT ai_enabled, ai_daily_limit FROM groups WHERE id = $1',
      [groupId],
    );
    return { enabled: row?.ai_enabled ?? false, dailyLimit: row?.ai_daily_limit ?? null };
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

  async recordUsage(entry: {
    groupId: string;
    expenseId: string | null;
    task: string;
    model: string;
    errorCode: string | null;
    by: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO ai_usage (group_id, expense_id, task, model, status, error_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
