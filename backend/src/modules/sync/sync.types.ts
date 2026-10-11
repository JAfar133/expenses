import type { SkippedRow } from '../../services/excel/read.ts';

/**
 * ok          — Excel прочитан и очередь записана
 * locked      — файл открыт в Excel: чтение прошло, запись отложена
 * unavailable — OneDrive недоступен (сеть, авторизация, нет файла)
 * error       — другая ошибка (повреждённый файл, сбой резервной копии и т.п.)
 */
export type SyncStatus = 'ok' | 'locked' | 'unavailable' | 'error';

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  status: SyncStatus;
  /** Новые строки Excel, добавленные в БД */
  imported: number;
  /** Записи из очереди, дописанные в Excel */
  written: number;
  /** Сколько записей ещё ждёт записи в Excel */
  queued: number;
  /** Записи БД, помеченные удалёнными: их строку удалили или изменили в Excel (мягкое удаление) */
  deleted: number;
  /** Ранее удалённые записи, строки которых снова появились в Excel */
  restored: number;
  /** Сколько удалений не применено: пропало слишком много записей сразу, это похоже на ошибку */
  deletionsBlocked: number;
  /** Строки Excel, которые нельзя импортировать */
  skipped: number;
  skippedRows: SkippedRow[];
  error?: { code: string; message: string };
  /** Предупреждение: цикл прошёл, но нужно внимание пользователя (например, заблокировано массовое удаление) */
  warning?: { code: string; message: string };
}

export interface SyncStatusView {
  lastResult?: SyncResult;
  queued: number;
  running: boolean;
}
