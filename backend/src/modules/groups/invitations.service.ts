import { randomUUID } from 'node:crypto';
import { AppError, validationError } from '../../errors/app-error.ts';
import type { Database } from '../../infrastructure/database/database.ts';
import { hashPassword } from '../auth/password.ts';
import { generateToken, hashToken } from '../auth/tokens.ts';
import type { GroupRole } from '../auth/auth.types.ts';

const DAY_MS = 86_400_000;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MAX_NAME_LENGTH = 40;
const MAX_PASSWORD_LENGTH = 1024;

export interface InvitationsServiceOptions {
  database: Database;
  ttlDays?: number;
  minPasswordLength: number;
  now?: () => Date;
}

export type NewInvitation =
  | { kind: 'join'; groupId: string; role: GroupRole; createdBy: string }
  | { kind: 'reset'; userId: string; createdBy: string };

export interface InvitationPreview {
  kind: 'join' | 'reset';
  groupName: string | null;
  role: GroupRole | null;
  /** For a password reset: the login whose password is set */
  username: string | null;
}

export interface AcceptInput {
  username?: string;
  displayName?: string;
  password: string;
}

interface InvitationRow {
  id: string;
  kind: 'join' | 'reset';
  group_id: string | null;
  role: GroupRole | null;
  user_id: string | null;
}

const invalidInvitation = () =>
  new AppError(404, 'INVITATION_INVALID', 'Приглашение недействительно или истекло');

/** Invitations to a group and password reset links. The token is shown once; only its hash is stored. */
export class InvitationsService {
  /** Told after a person has joined a group (the bell): set by the server once the notifications exist */
  onJoined?: (event: { username: string; groupId: string }) => void | Promise<void>;
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: InvitationsServiceOptions) {
    this.ttlMs = (options.ttlDays ?? 7) * DAY_MS;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: NewInvitation): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    await this.options.database.query(
      `INSERT INTO invitations (kind, group_id, role, user_id, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.kind,
        input.kind === 'join' ? input.groupId : null,
        input.kind === 'join' ? input.role : null,
        input.kind === 'reset' ? input.userId : null,
        hashToken(token),
        input.createdBy,
        expiresAt,
      ],
    );
    return { token, expiresAt };
  }

  /** What the invited person sees before choosing a login and password. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findValid(token);
    if (!invitation) throw invalidInvitation();
    return this.describe(invitation);
  }

  /**
   * Accepts an invitation: creates the user (join) or sets the new password (reset). The invitation is used up.
   * Returns the login so the caller can sign the person in.
   */
  async accept(token: string, input: AcceptInput): Promise<{ username: string }> {
    const first = await this.findValid(token);
    if (!first) throw invalidInvitation();

    this.validatePassword(input.password);
    const passwordHash = await hashPassword(input.password);

    const joined: { groupId: string | null } = { groupId: null };
    const result = await this.options.database.transaction(async (tx) => {
      const [invitation] = await tx.query<InvitationRow>(
        `SELECT id, kind, group_id, role, user_id FROM invitations
          WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2
          FOR UPDATE`,
        [hashToken(token), this.now()],
      );
      if (!invitation) throw invalidInvitation();

      let username: string;
      if (invitation.kind === 'reset') {
        const [user] = await tx.query<{ username: string }>(
          'UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1 AND disabled_at IS NULL RETURNING username',
          [invitation.user_id, passwordHash],
        );
        if (!user) throw invalidInvitation();
        await tx.query(
          'UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [invitation.user_id],
        );
        username = user.username;
      } else {
        username = await this.createMember(tx, invitation, input, passwordHash);
        joined.groupId = invitation.group_id;
      }

      await tx.query('UPDATE invitations SET used_at = now() WHERE id = $1', [invitation.id]);
      return { username };
    });
    if (joined.groupId && this.onJoined) {
      try {
        await this.onJoined({ username: result.username, groupId: joined.groupId });
      } catch {
        // A lost notification must not undo the registration
      }
    }
    return result;
  }

  private async createMember(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    invitation: InvitationRow,
    input: AcceptInput,
    passwordHash: string,
  ): Promise<string> {
    const username = (input.username ?? '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw validationError(
        'INVALID_USERNAME',
        'Логин: от 3 до 32 символов, латинские буквы, цифры, точка, дефис и подчёркивание',
      );
    }
    // The name is optional in the form: without it the login is shown
    const displayName = (input.displayName ?? '').trim() || username;
    if (displayName.length > MAX_NAME_LENGTH) {
      throw validationError('INVALID_NAME', `Имя: не длиннее ${MAX_NAME_LENGTH} символов`);
    }
    const taken = await tx.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (taken.length > 0) throw new AppError(409, 'USERNAME_TAKEN', 'Этот логин уже занят');

    const [group] = await tx.query<{ timezone: string; reporting_currency: string }>(
      'SELECT timezone, reporting_currency FROM groups WHERE id = $1 AND disabled_at IS NULL',
      [invitation.group_id],
    );
    if (!group) throw invalidInvitation();

    // The first owner of an empty group gets a card named after them: the form is usable right away
    if (invitation.role === 'owner') {
      await tx.query(
        `INSERT INTO cards (group_id, name, currency)
         SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM cards WHERE group_id = $1)`,
        [invitation.group_id, displayName, group.reporting_currency],
      );
    }
    const [firstCard] = await tx.query<{ name: string }>(
      `SELECT name FROM cards WHERE group_id = $1 AND archived_at IS NULL ORDER BY position, name LIMIT 1`,
      [invitation.group_id],
    );

    const userId = randomUUID();
    await tx.query(
      `INSERT INTO users (id, username, display_name, card, password_hash, timezone_default, from_env)
       VALUES ($1, $2, $3, $4, $5, $6, false)`,
      [userId, username, displayName, firstCard?.name ?? '', passwordHash, group.timezone],
    );
    await tx.query('INSERT INTO memberships (user_id, group_id, role) VALUES ($1, $2, $3)', [
      userId,
      invitation.group_id,
      invitation.role,
    ]);
    // A new member can add records to every card until the owner narrows it down
    if (invitation.role === 'member') {
      await tx.query(
        `INSERT INTO card_access (card_id, user_id, level)
         SELECT id, $2, 'edit' FROM cards WHERE group_id = $1 AND archived_at IS NULL`,
        [invitation.group_id, userId],
      );
    }
    return username;
  }

  private validatePassword(password: string): void {
    if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
      throw validationError('WEAK_PASSWORD', 'Некорректный пароль');
    }
    if (password.length < this.options.minPasswordLength) {
      throw validationError(
        'WEAK_PASSWORD',
        `Пароль слишком короткий: нужно не меньше ${this.options.minPasswordLength} символов`,
      );
    }
  }

  private async findValid(token: string): Promise<InvitationRow | undefined> {
    if (!token || token.length > 256) return undefined;
    const [row] = await this.options.database.query<InvitationRow>(
      `SELECT id, kind, group_id, role, user_id FROM invitations
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2`,
      [hashToken(token), this.now()],
    );
    return row;
  }

  private async describe(invitation: InvitationRow): Promise<InvitationPreview> {
    const { database } = this.options;
    if (invitation.kind === 'join') {
      const [group] = await database.query<{ name: string }>(
        'SELECT name FROM groups WHERE id = $1 AND disabled_at IS NULL',
        [invitation.group_id],
      );
      if (!group) throw invalidInvitation();
      return { kind: 'join', groupName: group.name, role: invitation.role, username: null };
    }
    const [user] = await database.query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1 AND disabled_at IS NULL',
      [invitation.user_id],
    );
    if (!user) throw invalidInvitation();
    return { kind: 'reset', groupName: null, role: null, username: user.username };
  }
}
