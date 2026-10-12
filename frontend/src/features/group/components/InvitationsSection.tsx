import { useState } from 'react';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import {
  createInvitation,
  revokeInvitation,
  type GroupInvitation,
  type IssuedLink,
  type MemberRole,
} from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { formatDateTime } from '../model/format.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { compactSelectClass, dangerButtonClass } from './styles.ts';

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Владелец', member: 'Участник' };

function describe(invitation: GroupInvitation): string {
  if (invitation.kind === 'reset') return `Сброс пароля · ${invitation.username ?? ''}`;
  return `Приглашение · ${ROLE_LABELS[invitation.role ?? 'member']}`;
}

/** Invitations: create a link (shown once) and revoke pending ones. */
export function InvitationsSection({ invitations }: { invitations: GroupInvitation[] }) {
  const [role, setRole] = useState<MemberRole>('member');
  const [issued, setIssued] = useState<IssuedLink | null>(null);

  const create = useGroupMutation(async (chosen: MemberRole) => {
    setIssued(await createInvitation(chosen));
  });
  const revoke = useGroupMutation(revokeInvitation);

  return (
    <SettingsSection title="Приглашения">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Роль приглашённого"
          value={role}
          className={compactSelectClass}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          <option value="member">Участник</option>
          <option value="owner">Владелец</option>
        </select>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate(role)}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          Пригласить
        </button>
      </div>
      {issued && (
        <LinkPanel
          title="Ссылка-приглашение"
          token={issued.token}
          expiresAt={issued.expiresAt}
          onClose={() => setIssued(null)}
        />
      )}
      {invitations.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{describe(invitation)}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  действует до {formatDateTime(invitation.expiresAt)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Отозвать: ${describe(invitation)}`}
                disabled={revoke.isPending}
                className={dangerButtonClass}
                onClick={() => revoke.mutate(invitation.id)}
              >
                Отозвать
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNotice mutations={[create, revoke]} />
    </SettingsSection>
  );
}
