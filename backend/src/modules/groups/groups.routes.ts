import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { forbiddenError, validationError } from '../../errors/app-error.ts';
import { setAuthCookies } from '../auth/auth.plugin.ts';
import type { AuthService } from '../auth/auth.service.ts';
import type { GroupService } from './group.service.ts';
import type { InvitationsService } from './invitations.service.ts';
import type { PlatformAdminService } from './platform-admin.service.ts';

const idSchema = z.uuid();
const parseId = (value: unknown) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw validationError('INVALID_ID', 'Некорректный идентификатор');
  return parsed.data;
};

const bodyOf = (request: FastifyRequest): Record<string, unknown> => {
  const body = request.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  throw validationError('INVALID_REQUEST', 'Некорректный запрос');
};

const ownerOnly = (request: FastifyRequest) => {
  if (request.user?.role !== 'owner' || !request.user.groupId) throw forbiddenError();
  return request.user;
};

const adminOnly = (request: FastifyRequest) => {
  if (!request.user?.isAdmin) throw forbiddenError();
  return request.user;
};

const tokenResponse = ({ token, expiresAt }: { token: string; expiresAt: Date }) => ({
  success: true,
  data: { token, expiresAt: expiresAt.toISOString() },
});

/** Management of the user's own group (owner only). */
export const groupRoutes =
  (service: GroupService): FastifyPluginAsync =>
  async (app) => {
    app.get('/group', async (request) => ({
      success: true,
      data: await service.view(ownerOnly(request)),
    }));

    app.patch('/group', async (request) => {
      await service.rename(ownerOnly(request), bodyOf(request).name);
      return { success: true };
    });

    app.post('/group/cards', async (request, reply) => {
      const id = await service.createCard(ownerOnly(request), bodyOf(request).name);
      return reply.code(201).send({ success: true, data: { id } });
    });

    app.patch('/group/cards/:id', async (request) => {
      const body = bodyOf(request);
      await service.updateCard(ownerOnly(request), parseId((request.params as { id: string }).id), {
        name: body.name,
        archived: body.archived,
      });
      return { success: true };
    });

    /** Body: `{ "access": { "<login>": "view" | "edit" } }`; members that are not listed lose access. */
    app.put('/group/cards/:id/access', async (request) => {
      const access = bodyOf(request).access;
      if (!access || typeof access !== 'object' || Array.isArray(access)) {
        throw validationError('INVALID_REQUEST', 'Укажите access: { логин: view | edit }');
      }
      await service.setCardAccess(
        ownerOnly(request),
        parseId((request.params as { id: string }).id),
        access as Record<string, 'view' | 'edit'>,
      );
      return { success: true };
    });

    app.post('/group/categories', async (request, reply) => {
      const id = await service.createCategory(ownerOnly(request), bodyOf(request).name);
      return reply.code(201).send({ success: true, data: { id } });
    });

    app.patch('/group/categories/:id', async (request) => {
      const body = bodyOf(request);
      await service.updateCategory(
        ownerOnly(request),
        parseId((request.params as { id: string }).id),
        { name: body.name, archived: body.archived },
      );
      return { success: true };
    });

    app.post('/group/invitations', async (request, reply) => {
      const role = bodyOf(request).role ?? 'member';
      const created = await service.invite(ownerOnly(request), role as 'owner' | 'member');
      return reply.code(201).send(tokenResponse(created));
    });

    app.delete('/group/invitations/:id', async (request) => {
      await service.revokeInvitation(
        ownerOnly(request),
        parseId((request.params as { id: string }).id),
      );
      return { success: true };
    });

    app.put('/group/members/:username/role', async (request) => {
      const role = bodyOf(request).role;
      if (role !== 'owner' && role !== 'member') {
        throw validationError('INVALID_ROLE', 'Роль: owner или member');
      }
      await service.setRole(
        ownerOnly(request),
        (request.params as { username: string }).username,
        role,
      );
      return { success: true };
    });

    app.post('/group/members/:username/reset-password', async (request, reply) => {
      const created = await service.resetPassword(
        ownerOnly(request),
        (request.params as { username: string }).username,
      );
      return reply.code(201).send(tokenResponse(created));
    });

    app.delete('/group/members/:username', async (request) => {
      await service.removeMember(
        ownerOnly(request),
        (request.params as { username: string }).username,
      );
      return { success: true };
    });
  };

/** Groups for the application administrator. */
export const adminRoutes =
  (service: PlatformAdminService): FastifyPluginAsync =>
  async (app) => {
    app.get('/admin/groups', async (request) => {
      adminOnly(request);
      return { success: true, data: await service.listGroups() };
    });

    app.post('/admin/groups', async (request, reply) => {
      const admin = adminOnly(request);
      const body = bodyOf(request);
      const created = await service.createGroup(admin, {
        name: body.name,
        currency: body.currency,
        timezone: body.timezone,
      });
      return reply.code(201).send({
        success: true,
        data: { id: created.id, token: created.token, expiresAt: created.expiresAt.toISOString() },
      });
    });

    app.patch('/admin/groups/:id', async (request) => {
      adminOnly(request);
      const disabled = bodyOf(request).disabled;
      if (typeof disabled !== 'boolean') {
        throw validationError('INVALID_REQUEST', 'Укажите disabled: true или false');
      }
      await service.setDisabled(parseId((request.params as { id: string }).id), disabled);
      return { success: true };
    });

    app.post('/admin/groups/:id/owner-invitations', async (request, reply) => {
      const admin = adminOnly(request);
      const created = await service.inviteOwner(
        admin,
        parseId((request.params as { id: string }).id),
      );
      return reply.code(201).send(tokenResponse(created));
    });

    app.post('/admin/users/:username/reset-password', async (request, reply) => {
      const admin = adminOnly(request);
      const created = await service.resetPassword(
        admin,
        (request.params as { username: string }).username,
      );
      return reply.code(201).send(tokenResponse(created));
    });
  };

/** Invitation links: open without login (the token is the proof). */
export const invitationRoutes =
  (invitations: InvitationsService, auth: AuthService): FastifyPluginAsync =>
  async (app) => {
    app.get('/invitations/:token', { config: { public: true } }, async (request) => ({
      success: true,
      data: await invitations.preview((request.params as { token: string }).token),
    }));

    /** Creates the account (or sets the new password) and signs the person in. */
    app.post('/invitations/:token/accept', { config: { public: true } }, async (request, reply) => {
      const body = bodyOf(request);
      const { username } = await invitations.accept((request.params as { token: string }).token, {
        username: typeof body.username === 'string' ? body.username : undefined,
        displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
        password: typeof body.password === 'string' ? body.password : '',
      });
      const { user, tokens } = await auth.login(username, String(body.password), {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setAuthCookies(reply, tokens, request.protocol === 'https');
      return reply.code(201).send({ success: true, data: { username: user.username } });
    });
  };
