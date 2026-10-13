import type { CreateExpenseRequest } from '../../expenses/api/expenses.api.ts';

export type QueueStatus = 'pending' | 'failed';

/** An expense saved on the device until it can be sent. */
export interface QueuedExpense {
  /** The idempotency key of the expense: the same one on every attempt, so no duplicates */
  id: string;
  /** Exactly what goes to POST /api/expenses (the positions and the sources of the name and date included) */
  expense: CreateExpenseRequest;
  /** After the photo is uploaded, ask the AI to parse the receipt */
  parse?: boolean;
  /** An already compressed photo of the receipt */
  photo?: Blob;
  createdAt: number;
  status: QueueStatus;
  /** A readable reason when the status is failed */
  error?: string;
  attempts: number;
  /** The id the server gave to the expense once it accepted it: then only the photo is left to send */
  serverId?: string;
  /** The expense is saved on the server, but the photo did not upload */
  photoFailed?: boolean;
}

/** Storage of the queue. Methods reject with `QueueUnavailableError` when the device cannot store anything. */
export interface QueueStore {
  add(item: QueuedExpense): Promise<void>;
  /** Oldest first (by `createdAt`) */
  list(): Promise<QueuedExpense[]>;
  update(id: string, patch: Partial<QueuedExpense>): Promise<void>;
  remove(id: string): Promise<void>;
}

export class QueueUnavailableError extends Error {
  constructor() {
    super('Не удалось сохранить на устройстве, попробуйте позже');
    this.name = 'QueueUnavailableError';
  }
}
