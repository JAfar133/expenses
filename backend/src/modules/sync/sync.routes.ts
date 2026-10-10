import type { FastifyPluginAsync } from 'fastify';
import type { SyncScheduler } from './sync.scheduler.ts';
import type { SyncService } from './sync.service.ts';

export interface SyncRoutesDeps {
  sync: SyncService;
  scheduler: SyncScheduler;
}

export const syncRoutes =
  ({ sync, scheduler }: SyncRoutesDeps): FastifyPluginAsync =>
  async (app) => {
    /** Состояние для интерфейса: очередь, последний результат и время следующего запуска. */
    const view = async () => {
      const status = await sync.status();
      return {
        success: true,
        data: {
          ...status,
          intervalMs: scheduler.intervalMs,
          nextRunAt: scheduler.nextRun?.toISOString() ?? null,
          // Нужно клиенту, чтобы показывать таймер без привязки к часам устройства
          serverTime: new Date().toISOString(),
        },
      };
    };

    app.get('/sync/status', view);

    /** Ручной запуск. Если синхронизация уже идёт, присоединяется к ней. */
    app.post('/sync', async () => {
      await scheduler.syncNow();
      return view();
    });
  };
