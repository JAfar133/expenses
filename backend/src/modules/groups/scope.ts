import type { AuthUser, GroupRole } from '../auth/auth.types.ts';

/** What a user may see in the group's expenses. Built from the logged-in user, never from request data. */
export interface ExpenseScope {
  userId: string;
  /** null: the user is in no group and sees nothing */
  groupId: string | null;
  role: GroupRole | null;
}

export const scopeOf = (user: AuthUser): ExpenseScope => ({
  userId: user.id,
  groupId: user.groupId,
  role: user.role,
});

interface ScopeColumns {
  group: string;
  card: string;
}

const PLAIN_COLUMNS: ScopeColumns = { group: 'group_id', card: 'card_id' };

/**
 * SQL condition limiting expenses to the user's group and, for members, to the cards they have access to.
 * The owner sees every card of the group; a card without an access row is hidden. Values go in as parameters.
 * `level` restricts to cards where the user may add expenses.
 */
export function scopeCondition(
  scope: ExpenseScope,
  param: (value: unknown) => string,
  { level, columns = PLAIN_COLUMNS }: { level?: 'edit'; columns?: ScopeColumns } = {},
): string {
  if (!scope.groupId || !scope.role) return 'false';

  const inGroup = `${columns.group} = ${param(scope.groupId)}`;
  if (scope.role === 'owner') return inGroup;

  const levelCondition = level === 'edit' ? " AND level = 'edit'" : '';
  return `${inGroup} AND ${columns.card} IN (SELECT card_id FROM card_access WHERE user_id = ${param(scope.userId)}${levelCondition})`;
}
