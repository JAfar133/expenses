import type { SyncService } from './sync.service.ts';

/** Ждёт завершения синхронизации, но не дольше лимита. Ошибок не бросает: изменение уже сохранено в БД. */
export async function waitForExcelWrite(
  sync: Pick<SyncService, 'requestCycle'>,
  waitMs: number,
): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref());
  await Promise.race([sync.requestCycle(), timeout]);
}
