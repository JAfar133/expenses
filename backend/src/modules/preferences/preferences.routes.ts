import type { FastifyPluginAsync } from 'fastify';
import { validationError } from '../../errors/app-error.ts';
import type { PreferencesRepository } from './preferences.repository.ts';
import { preferencesSchema } from './preferences.schema.ts';

/** Настройки текущего пользователя. Чужие настройки недоступны: идентификатор берётся из сессии. */
export const preferencesRoutes =
  (repository: Pick<PreferencesRepository, 'get' | 'merge'>): FastifyPluginAsync =>
  async (app) => {
    app.get('/preferences', async (request) => ({
      success: true,
      data: await repository.get(request.user!.id),
    }));

    /** Меняет только переданные настройки. */
    app.put('/preferences', async (request) => {
      const parsed = preferencesSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError('INVALID_PREFERENCES', 'Некорректные настройки');
      }
      return { success: true, data: await repository.merge(request.user!.id, parsed.data) };
    });
  };
