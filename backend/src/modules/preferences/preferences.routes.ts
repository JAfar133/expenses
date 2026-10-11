import type { FastifyPluginAsync } from 'fastify';
import { validationError } from '../../errors/app-error.ts';
import type { PreferencesRepository } from './preferences.repository.ts';
import { preferencesSchema } from './preferences.schema.ts';

/** Settings of the current user. Other users' settings are inaccessible: the id comes from the session. */
export const preferencesRoutes =
  (repository: Pick<PreferencesRepository, 'get' | 'merge'>): FastifyPluginAsync =>
  async (app) => {
    app.get('/preferences', async (request) => ({
      success: true,
      data: await repository.get(request.user!.id),
    }));

    /** Changes only the settings that were passed. */
    app.put('/preferences', async (request) => {
      const parsed = preferencesSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError('INVALID_PREFERENCES', 'Некорректные настройки');
      }
      return { success: true, data: await repository.merge(request.user!.id, parsed.data) };
    });
  };
