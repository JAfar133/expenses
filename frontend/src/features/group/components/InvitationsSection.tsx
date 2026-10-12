import { CloseIcon } from '../../../shared/ui/icons.tsx';
import { useState } from 'react';
import { HintList } from '../../../shared/ui/HelpHint.tsx';
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
import { compactSelectClass } from './styles.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';

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
    <SettingsSection
      title="Приглашения"
      hint={
        <HintList
          intro="Ссылка одноразовая и действует 7 дней. Человек сам выбирает логин и пароль."
          items={[
            [
              'Показ',
              'ссылка видна только сразу после создания; потеряли — отзовите и создайте новую.',
            ],
            ['Участник', 'получает доступ ко всем текущим картам, потом вы можете сузить его.'],
            ['Владелец', 'получает те же права, что и вы.'],
          ]}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <select
          aria-label="Роль приглашённого"
          value={role}
          className={`${compactSelectClass} h-11 w-full min-w-0 sm:h-10 sm:w-auto`}
          onChange={(event) => setRole(event.target.value as MemberRole)}
        >
          <option value="member">Участник</option>
          <option value="owner">Владелец</option>
        </select>
        <button
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate(role)}
          className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 sm:min-h-10"
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
            <ListRow
              key={invitation.id}
              main={
                <>
                  <div className="text-sm font-medium">{describe(invitation)}</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    действует до {formatDateTime(invitation.expiresAt)}
                  </div>
                </>
              }
            >
              <RowActions>
                <ActionButton
                  label={`Отозвать: ${describe(invitation)}`}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invitation.id)}
                  tone="danger"
                  icon={<CloseIcon />}
                />
              </RowActions>
            </ListRow>
          ))}
        </ul>
      )}
      <ErrorNotice mutations={[create, revoke]} />
    </SettingsSection>
  );
}
