import { revokeInvitation, type GroupInvitation, type MemberRole } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { formatDateTime } from '../model/format.ts';
import { ErrorNotice } from './ErrorNotice.tsx';

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Владелец', member: 'Участник' };

const describe = (invitation: GroupInvitation) =>
  invitation.kind === 'reset'
    ? `Сброс пароля · ${invitation.username ?? ''}`
    : `Приглашение · ${ROLE_LABELS[invitation.role ?? 'member']}`;

/** Invitations that have not been used yet: a collapsed block, shown only when there are some. */
export function PendingInvitations({ invitations }: { invitations: GroupInvitation[] }) {
  const revoke = useGroupMutation(revokeInvitation);
  if (invitations.length === 0) return null;

  return (
    <details className="group rounded-xl border border-zinc-100 p-3 dark:border-zinc-800">
      <summary className="cursor-pointer list-none text-sm font-medium">
        Ожидающие приглашения ({invitations.length})
      </summary>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{describe(invitation)}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                действует до {formatDateTime(invitation.expiresAt)}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Отозвать: ${describe(invitation)}`}
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(invitation.id)}
              className="h-9 shrink-0 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950"
            >
              Отозвать
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2">
        <ErrorNotice mutations={[revoke]} />
      </div>
    </details>
  );
}
