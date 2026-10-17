import type { Database, SqlExecutor } from '../../infrastructure/database/database.ts';

export type LogStatus =
  | 'created'
  | 'duplicate'
  | 'merged'
  | 'unrecognized'
  | 'parse_error'
  | 'unsupported'
  | 'card_not_found'
  | 'card_ambiguous'
  | 'unknown_source'
  | 'error';

export interface LogEntry {
  groupId: string;
  keyId: string;
  source: string;
  /** The request as it came (unknown fields included), already cleaned of anything that looks like a key */
  rawPayload: Record<string, unknown>;
  status: LogStatus;
  error?: string | null;
  parsed?: Record<string, unknown> | null;
  match?: Record<string, unknown> | null;
  expenseId?: string | null;
}

export interface LogView {
  id: string;
  receivedAt: string;
  source: string;
  keyName: string | null;
  status: LogStatus;
  error: string | null;
  rawPayload: Record<string, unknown>;
  parsed: Record<string, unknown> | null;
  match: Record<string, unknown> | null;
  expenseId: string | null;
}

/** A Wallet request that was received but did not become an expense: a later bank notice may claim it. */
export interface PendingWalletEvent {
  id: string;
  merchant: string;
}

/** SQL for the diagnostic log of import requests. */
export class ImportLogRepository {
  constructor(private readonly database: Database) {}

  async add(entry: LogEntry): Promise<string> {
    const [row] = await this.database.query<{ id: string }>(
      `INSERT INTO import_log (group_id, key_id, source, raw_payload, status, error, parsed, match, expense_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9) RETURNING id`,
      [
        entry.groupId,
        entry.keyId,
        entry.source,
        JSON.stringify(entry.rawPayload),
        entry.status,
        entry.error ?? null,
        entry.parsed ? JSON.stringify(entry.parsed) : null,
        entry.match ? JSON.stringify(entry.match) : null,
        entry.expenseId ?? null,
      ],
    );
    return row!.id;
  }

  async list(groupId: string, limit: number, source?: string): Promise<LogView[]> {
    const rows = await this.database.query<{
      id: string;
      received_at: Date;
      source: string;
      key_name: string | null;
      status: LogStatus;
      error: string | null;
      raw_payload: Record<string, unknown>;
      parsed: Record<string, unknown> | null;
      match: Record<string, unknown> | null;
      expense_id: string | null;
    }>(
      `SELECT l.id, l.received_at, l.source, k.name AS key_name, l.status, l.error, l.raw_payload,
              l.parsed, l.match, l.expense_id
         FROM import_log l LEFT JOIN api_keys k ON k.id = l.key_id
        WHERE l.group_id = $1 AND ($3::text IS NULL OR l.source = $3)
        ORDER BY l.received_at DESC LIMIT $2`,
      [groupId, limit, source ?? null],
    );
    return rows.map((row) => ({
      id: row.id,
      receivedAt: row.received_at.toISOString(),
      source: row.source,
      keyName: row.key_name,
      status: row.status,
      error: row.error,
      rawPayload: row.raw_payload,
      parsed: row.parsed,
      match: row.match,
      expenseId: row.expense_id,
    }));
  }

  /**
   * Wallet requests of the group that were taken but made no expense (the card was unknown, say), with this
   * amount and currency around this moment: a bank notice for the same purchase may use them.
   */
  async pendingWallet(
    groupId: string,
    amount: number,
    currency: string,
    around: Date,
    windowMs: number,
    db: SqlExecutor,
  ): Promise<PendingWalletEvent[]> {
    const rows = await db.query<{ id: string; merchant: string | null }>(
      `SELECT id, parsed->>'merchant' AS merchant FROM import_log
        WHERE group_id = $1 AND source = 'apple_wallet' AND status = 'unrecognized'
          AND (parsed->>'amount')::numeric = $2 AND parsed->>'currency' = $3
          AND (parsed->>'occurredAt')::timestamptz BETWEEN $4 AND $5
        ORDER BY received_at DESC`,
      [
        groupId,
        amount,
        currency,
        new Date(around.getTime() - windowMs),
        new Date(around.getTime() + windowMs),
      ],
    );
    return rows
      .filter((row) => row.merchant)
      .map((row) => ({ id: row.id, merchant: row.merchant! }));
  }

  /** The Wallet requests that a created expense took over. */
  async markMerged(ids: string[], expenseId: string, db: SqlExecutor): Promise<void> {
    if (ids.length === 0) return;
    await db.query(
      "UPDATE import_log SET status = 'merged', expense_id = $2 WHERE id = ANY($1::uuid[])",
      [ids, expenseId],
    );
  }

  /** Daily maintenance: the log is kept for a limited time. */
  async deleteOlderThan(moment: Date): Promise<number> {
    const rows = await this.database.query(
      'DELETE FROM import_log WHERE received_at < $1 RETURNING id',
      [moment],
    );
    return rows.length;
  }
}
