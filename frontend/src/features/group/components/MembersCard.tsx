import { useState } from 'react';
import { ActionMenu, type MenuAction } from '../../../shared/ui/ActionMenu.tsx';
import { Avatar } from '../../../shared/ui/Avatar.tsx';
import {
  CrownIcon,
  CrownOffIcon,
  KeyIcon,
  LockIcon,
  UserMinusIcon,
} from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import {
  createMemberResetLink,
  removeMember,
  setMemberRole,
  type GroupCard,
  type GroupInvitation,
  type GroupMember,
  type IssuedLink,
  type MemberRole,
} from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddButton } from './AddButton.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { GroupRow } from './GroupRow.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { MemberAccessDialog } from './MemberAccessDialog.tsx';
import { PendingInvitations } from './PendingInvitations.tsx';

const ROLE_LABELS: Record<MemberRole, string> = { owner: 'Владелец', member: 'Участник' };

interface MembersCardProps {
  members: GroupMember[];
  invitations: GroupInvitation[];
  cards: GroupCard[];
  currentUsername: string;
}

/** «Участники»: the people of the group with a «⋯» menu each, the invitation window and pending invitations. */
export function MembersCard({ members, invitations, cards, currentUsername }: MembersCardProps) {
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ username: string; issued: IssuedLink } | null>(null);
  const [switching, setSwitching] = useState<GroupMember | null>(null);
  const [removing, setRemoving] = useState<GroupMember | null>(null);
  const [accessFor, setAccessFor] = useState<GroupMember | null>(null);

  const changeRole = useGroupMutation(
    ({ username, role }: { username: string; role: MemberRole }) => setMemberRole(username, role),
  );
  const resetLink = useGroupMutation(async (username: string) => {
    setLink({ username, issued: await createMemberResetLink(username) });
  });
  const remove = useGroupMutation(removeMember);

  async function confirmRoleChange(member: GroupMember, role: MemberRole) {
    try {
      await changeRole.mutateAsync({ username: member.username, role });
    } catch {
      // The error is shown below
    }
    setSwitching(null);
  }

  async function confirmRemove(member: GroupMember) {
    try {
      await remove.mutateAsync(member.username);
    } catch {
      // The error is shown below
    }
    setRemoving(null);
  }

  /** Only what this person can do with that member: nothing for yourself, no removal of accounts set by the server. */
  const actionsFor = (member: GroupMember): MenuAction[] => {
    const actions: MenuAction[] = [
      {
        label: 'Изменить роль',
        icon: member.role === 'owner' ? <CrownOffIcon /> : <CrownIcon />,
        onSelect: () => setSwitching(member),
      },
    ];
    if (member.role !== 'owner') {
      actions.push({
        label: 'Доступ к картам',
        icon: <LockIcon />,
        onSelect: () => setAccessFor(member),
      });
    }
    actions.push({
      label: 'Ссылка для сброса пароля',
      icon: <KeyIcon />,
      onSelect: () => resetLink.mutate(member.username),
    });
    if (!member.fromEnv) {
      actions.push({
        label: 'Исключить из группы',
        icon: <UserMinusIcon />,
        tone: 'danger',
        onSelect: () => setRemoving(member),
      });
    }
    return actions;
  };

  return (
    <SettingsSection
      title={`Участники (${members.length})`}
      compact
      action={<AddButton label="Пригласить" onClick={() => setInviting(true)} />}
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map((member) => (
          <GroupRow
            key={member.userId}
            lead={<Avatar name={member.displayName} />}
            main={
              <>
                <div className="truncate text-sm font-medium">{member.displayName}</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  @{member.username} · {ROLE_LABELS[member.role]}
                </div>
              </>
            }
            menu={
              member.username === currentUsername ? undefined : (
                <ActionMenu
                  label={`Действия: ${member.displayName}`}
                  actions={actionsFor(member)}
                />
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
          />
        ))}
      </ul>
      <ErrorNotice mutations={[changeRole, resetLink, remove]} />
      <PendingInvitations invitations={invitations} />

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {accessFor && (
        <MemberAccessDialog
          member={accessFor}
          members={members}
          cards={cards}
          onClose={() => setAccessFor(null)}
        />
      )}
      {switching && (
        <ConfirmDialog
          title="Сменить роль?"
          message={
            switching.role === 'owner'
              ? `Сделать ${switching.displayName} участником? Он будет видеть только карты, к которым ему дан доступ, и не сможет править траты.`
              : `Сделать ${switching.displayName} владельцем? Он будет видеть все карты и сможет править и удалять траты.`
          }
          confirmLabel={switching.role === 'owner' ? 'Сделать участником' : 'Сделать владельцем'}
          busy={changeRole.isPending}
          onConfirm={() =>
            void confirmRoleChange(switching, switching.role === 'owner' ? 'member' : 'owner')
          }
          onCancel={() => setSwitching(null)}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Исключить участника?"
          message={`${removing.displayName} потеряет доступ к группе. Записи останутся в группе.`}
          confirmLabel="Исключить"
          busy={remove.isPending}
          onConfirm={() => void confirmRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </SettingsSection>
  );
}
