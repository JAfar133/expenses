import { useState } from 'react';
import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
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
import { compactSelectClass, dangerButtonClass, smallButtonClass } from './styles.ts';

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
      hint="Владелец видит все карты группы, добавляет, правит и удаляет траты и управляет группой. Участник видит только карты, к которым ему дан доступ, и добавляет траты на карты с доступом «добавлять»."
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map((member) => (
          <li key={member.userId} className="space-y-2 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{member.displayName}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{member.username}</div>
              </div>
              <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium dark:bg-zinc-800">
                {ROLE_LABELS[member.role]}
              </span>
            </div>
            {member.username !== currentUsername && (
              <div className="flex flex-wrap items-center gap-x-1">
                <select
                  aria-label={`Роль: ${member.displayName}`}
                  value={member.role}
                  disabled={changeRole.isPending}
                  className={compactSelectClass}
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
                <button
                  type="button"
                  aria-label={`Ссылка для сброса пароля: ${member.displayName}`}
                  className={smallButtonClass}
                  disabled={resetLink.isPending}
                  onClick={() => resetLink.mutate(member.username)}
                >
                  Ссылка для сброса пароля
                </button>
                <HelpHint>
                  Одноразовая ссылка на 7 дней: человек сам задаст новый пароль. Старый пароль
                  перестанет работать, его активные входы закроются.
                </HelpHint>
                {!member.fromEnv && (
                  <button
                    type="button"
                    aria-label={`Убрать: ${member.displayName}`}
                    className={dangerButtonClass}
                    onClick={() => setRemoving(member)}
                  >
                    Убрать
                  </button>
                )}
                {!member.fromEnv && (
                  <HelpHint>
                    Человек больше не сможет войти. Его прошлые траты останутся в группе, автором
                    по-прежнему будет он. Вернуть его можно только новым приглашением (с другим
                    логином).
                  </HelpHint>
                )}
              </div>
            )}
            {link?.username === member.username && (
              <LinkPanel
                title={`Ссылка для нового пароля: ${member.displayName}`}
                token={link.issued.token}
                expiresAt={link.issued.expiresAt}
                onClose={() => setLink(null)}
              />
            )}
          </li>
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
