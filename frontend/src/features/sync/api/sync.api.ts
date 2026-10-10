import { apiRequest } from '../../../shared/api/http.ts';

export type SyncStatus = 'ok' | 'locked' | 'unavailable' | 'error';

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  status: SyncStatus;
  /** Новые строки Excel, добавленные в базу */
  imported: number;
  /** Записи из очереди, дописанные в Excel */
  written: number;
  queued: number;
  /** Записи базы, которых нет в Excel (удалены или изменены там) */
  diverged: number;
  /** Строки Excel, которые нельзя импортировать */
  skipped: number;
  error?: { code: string; message: string };
}

export interface SyncState {
  lastResult?: SyncResult;
  /** Сколько записей ждёт записи в Excel */
  queued: number;
  running: boolean;
  intervalMs: number;
  /** Когда запустится следующая синхронизация; null, пока идёт текущая */
  nextRunAt: string | null;
  /** Время сервера: по нему считаем таймер, не полагаясь на часы устройства */
  serverTime: string;
}

export const fetchSyncState = async () => (await apiRequest<SyncState>('/sync/status')).data;

export const runSync = async () => (await apiRequest<SyncState>('/sync', { method: 'POST' })).data;
