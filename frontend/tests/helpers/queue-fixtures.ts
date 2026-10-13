import type { QueuedExpense } from '../../src/features/offline-queue/model/queue-types.ts';

export function queued(id: string, patch: Partial<QueuedExpense> = {}): QueuedExpense {
  return {
    id,
    expense: {
      date: '2026-10-15',
      card: 'Миша',
      category: 'кафе',
      name: `Расход ${id}`,
      amount: 1000,
    },
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    status: 'pending',
    attempts: 0,
    ...patch,
  };
}
