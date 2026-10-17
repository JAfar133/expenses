import { createHash, randomBytes } from 'node:crypto';
import {
  AppError,
  forbiddenError,
  notFoundError,
  validationError,
} from '../../errors/app-error.ts';
import type { AuthUser } from '../auth/auth.types.ts';
import type { ActiveKey, ApiKeysRepository, ApiKeyView } from './api-keys.repository.ts';

const KEY_PREFIX = 'etk_';
/** The characters of the key shown in the list (the prefix and the first bytes) */
const SHOWN_CHARS = 10;
const MAX_NAME = 60;
const MAX_KEYS = 20;

export const hashKey = (key: string): string => createHash('sha256').update(key).digest('hex');

/**
 * The group's API keys for importing notifications. A key belongs to a group (not to a session), has no expiry, is
 * shown once when created and can be revoked at any moment. Only its hash is stored.
 */
export class ApiKeysService {
  constructor(private readonly repository: ApiKeysRepository) {}

  /** Only the owner of the group manages keys. */
  async create(
    owner: AuthUser,
    name: unknown,
    defaultCategory?: unknown,
  ): Promise<{ id: string; key: string }> {
    const groupId = this.requireOwner(owner);
    const clean = this.cleanName(name);
    const defaultCategoryId = await this.categoryIdOf(groupId, defaultCategory);
    const active = (await this.repository.list(groupId)).filter((key) => !key.revokedAt);
    if (active.length >= MAX_KEYS) {
      throw new AppError(409, 'TOO_MANY_KEYS', 'Слишком много активных ключей: отзовите ненужные');
    }
    const key = KEY_PREFIX + randomBytes(32).toString('base64url');
    const id = await this.repository.create({
      groupId,
      userId: owner.id,
      name: clean,
      prefix: key.slice(0, SHOWN_CHARS),
      hash: hashKey(key),
      defaultCategoryId: defaultCategoryId ?? null,
    });
    return { id, key };
  }

  async list(owner: AuthUser): Promise<ApiKeyView[]> {
    return this.repository.list(this.requireOwner(owner));
  }

  /** Renames a key and/or sets its default category (`null` removes it). */
  async update(owner: AuthUser, id: string, patch: { name?: unknown; defaultCategory?: unknown }) {
    const groupId = this.requireOwner(owner);
    const update: { name?: string; defaultCategoryId?: string | null } = {};
    if (patch.name !== undefined) update.name = this.cleanName(patch.name);
    if (patch.defaultCategory !== undefined) {
      update.defaultCategoryId = (await this.categoryIdOf(groupId, patch.defaultCategory)) ?? null;
    }
    if (!(await this.repository.update(groupId, id, update))) throw notFoundError();
  }

  async revoke(owner: AuthUser, id: string): Promise<void> {
    if (!(await this.repository.revoke(this.requireOwner(owner), id))) throw notFoundError();
  }

  /** The key behind what the client sent, or undefined (unknown, revoked, malformed). */
  async authenticate(presented: string | undefined): Promise<ActiveKey | undefined> {
    if (!presented || !presented.startsWith(KEY_PREFIX) || presented.length > 200) return undefined;
    const key = await this.repository.findActive(hashKey(presented));
    if (key) await this.repository.touch(key.id);
    return key;
  }

  private cleanName(name: unknown): string {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!clean) throw validationError('INVALID_NAME', 'Введите название ключа');
    if (clean.length > MAX_NAME) {
      throw validationError('INVALID_NAME', `Название не длиннее ${MAX_NAME} символов`);
    }
    return clean;
  }

  /** A category of the group by its name; undefined for «none»; an unknown name is an error. */
  private async categoryIdOf(groupId: string, name: unknown): Promise<string | undefined> {
    if (name === undefined || name === null || name === '') return undefined;
    const id =
      typeof name === 'string' ? await this.repository.categoryId(groupId, name) : undefined;
    if (!id) throw validationError('INVALID_CATEGORY', 'Выберите категорию из списка');
    return id;
  }

  private requireOwner(user: AuthUser): string {
    if (!user.groupId || user.role !== 'owner') throw forbiddenError();
    return user.groupId;
  }
}
