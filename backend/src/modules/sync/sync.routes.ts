import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import type { SyncSwitch } from './sync-switch.ts';
import type { SyncScheduler } from './sync.scheduler.ts';
import type { SyncService } from './sync.service.ts';

/** Request body is optional. applyDeletions confirms a mass deletion blocked by the safeguard (editors only). */
const runSyncBodySchema = z.object({ applyDeletions: z.boolean().optional() }).optional();

export interface SyncRoutesDeps {
  sync: SyncService;
  scheduler: SyncScheduler;
  /** The administrator's on/off switch */
  syncSwitch?: Pick<SyncSwitch, 'view' | 'set'>;
}

export const syncRoutes =
  ({ sync, scheduler, syncSwitch }: SyncRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    /** State for the UI: the queue, the last result and the next run time. */
    const view = async () => {
      const status = await sync.status();
      return {
        success: true,
        data: {
          ...status,
          intervalMs: scheduler.intervalMs,
          nextRunAt: scheduler.nextRun?.toISOString() ?? null,
          // The client needs it to show a timer independent of the device clock
          serverTime: new Date().toISOString(),
        },
      };
    };

    app.get('/sync/status', view);

    /** Manual run. If a sync is already in progress, it joins it. */
    app.post('/sync', async (request) => {
      const body = runSyncBodySchema.safeParse(request.body);
      if (!body.success) throw validationError('INVALID_REQUEST', 'Некорректный запрос');

      const applyDeletions = body.data?.applyDeletions === true;
      if (applyDeletions && !request.user?.canEdit) throw forbiddenError();
      await scheduler.syncNow({ applyDeletions });
      return view();
    });

    /** Excel sync switch (application administrator only). */
    if (syncSwitch) {
      app.get('/admin/sync', async (request) => {
        if (!request.user?.isAdmin) throw forbiddenError();
        return { success: true, data: await syncSwitch.view() };
      });

      app.put('/admin/sync', async (request) => {
        if (!request.user?.isAdmin) throw forbiddenError();
        const enabled = (request.body as { enabled?: unknown } | undefined)?.enabled;
        if (typeof enabled !== 'boolean') {
          throw validationError('INVALID_REQUEST', 'Укажите enabled: true или false');
        }
        request.log.info(
          { operation: 'admin.sync', userId: request.user.username, enabled },
          'Excel sync switched',
        );
        return { success: true, data: await syncSwitch.set(enabled) };
      });
    }
  };
