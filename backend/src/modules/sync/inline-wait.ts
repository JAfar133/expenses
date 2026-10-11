import type { SyncService } from './sync.service.ts';

/** Waits for the sync to finish, but no longer than the limit. Never throws: the change is already saved in the DB. */
export async function waitForExcelWrite(
  sync: Pick<SyncService, 'requestCycle'>,
  waitMs: number,
): Promise<void> {
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref());
  await Promise.race([sync.requestCycle(), timeout]);
}
