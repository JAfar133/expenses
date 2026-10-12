import { KeyIcon, UserMinusIcon } from '../../../shared/ui/icons.tsx';
import { useState } from 'react';
import { HintList } from '../../../shared/ui/HelpHint.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import {
  createMemberResetLink,
  removeMember,
  setMemberRole,
  type GroupMember,
  type IssuedLink,
  type MemberRole,
} from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { ActionButton, ListRow, RowActions, roleSelectClass } from './ListRow.tsx';

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Владелец', member: 'Участник' };

interface MembersSectionProps {
  members: GroupMember[];
  currentUsername: string;
}

/** Members of the group: role, password reset link and removal. Nothing is offered for yourself. */
export function MembersSection({ members, currentUsername }: MembersSectionProps) {
  const [link, setLink] = useState<{ username: string; issued: IssuedLink } | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);

  const changeRole = useGroupMutation(
    ({ username, role }: { username: string; role: MemberRole }) => setMemberRole(username, role),
  );
  const resetLink = useGroupMutation(async (username: string) => {
    setLink({ username, issued: await createMemberResetLink(username) });
  });
  const remove = useGroupMutation(removeMember);

  async function confirmRemove(member: GroupMember) {
    try {
      await remove.mutateAsync(member.username);
    } catch {
      // The error is shown below
    }
    setRemoving(null);
  }

  return (
    <SettingsSection
      title="Участники"
      hint={
        <HintList
          items={[
            [
              'Роль',
              'владелец видит все карты, правит траты и управляет группой; участник видит только карты с доступом и добавляет траты на карты с доступом «добавлять».',
            ],
            [
              'Ссылка для сброса пароля',
              'одноразовая, на 7 дней: человек сам задаст новый пароль, старый перестанет работать, активные входы закроются.',
              <KeyIcon />,
            ],
            [
              'Убрать',
              'человек больше не сможет войти; его прошлые траты остаются в группе. Вернуть можно только новым приглашением (с другим логином).',
              <UserMinusIcon />,
            ],
          ]}
        />
      }
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map((member) => (
          <ListRow
            key={member.userId}
            main={
              <>
                <div className="font-medium">{member.displayName}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{member.username}</div>
              </>
            }
            badge={
              member.username === currentUsername ? (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium dark:bg-zinc-800">
                  {ROLE_LABELS[member.role]}
                </span>
              ) : (
                <select
                  aria-label={`Роль: ${member.displayName}`}
                  value={member.role}
                  disabled={changeRole.isPending}
                  className={roleSelectClass}
                  onChange={(event) =>
                    changeRole.mutate({
                      username: member.username,
                      role: event.target.value as MemberRole,
                    })
                  }
                >
                  <option value="member">Участник</option>
                  <option value="owner">Владелец</option>
                </select>
              )
            }
            below={
              link?.username === member.username && (
                <div className="mt-2">
                  <LinkPanel
                    title={`Ссылка для нового пароля: ${member.displayName}`}
                    token={link.issued.token}
                    expiresAt={link.issued.expiresAt}
                    onClose={() => setLink(null)}
                  />
                </div>
              )
            }
          >
            {member.username !== currentUsername && (
              <RowActions>
                <ActionButton
                  label={`Ссылка для сброса пароля: ${member.displayName}`}
                  disabled={resetLink.isPending}
                  onClick={() => resetLink.mutate(member.username)}
                  icon={<KeyIcon />}
                />
                {!member.fromEnv && (
                  <ActionButton
                    label={`Убрать: ${member.displayName}`}
                    onClick={() => setRemoving(member)}
                    tone="danger"
                    icon={<UserMinusIcon />}
                  />
                )}
              </RowActions>
            )}
          </ListRow>
        ))}
      </ul>
      <ErrorNotice mutations={[changeRole, resetLink, remove]} />
      {removing && (
        <ConfirmDialog
          title="Убрать участника?"
          message={`${removing.displayName} потеряет доступ к группе. Записи останутся в группе.`}
          confirmLabel="Убрать"
          busy={remove.isPending}
          onConfirm={() => void confirmRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </SettingsSection>
  );
}
