import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { LinkPanel } from '../../group/components/LinkPanel.tsx';
import { dangerButtonClass, smallButtonClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createOwnerInvitation, setGroupDisabled, type AdminGroup } from '../api/admin.api.ts';
import { ADMIN_GROUPS_KEY, useAdminGroups } from '../hooks/useAdminGroups.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { NewGroupForm } from './NewGroupForm.tsx';

type OwnerLink = { groupId: number; token: string; expiresAt: string };

/** All groups of the application: owner links, disabling and creating a group. */
export function GroupsSection() {
  const queryClient = useQueryClient();
  const groups = useAdminGroups();
  const [link, setLink] = useState<OwnerLink | null>(null);
  const [disabling, setDisabling] = useState<AdminGroup | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_GROUPS_KEY });
  const toggle = useAdminMutation(
    ({ id, disabled }: { id: number; disabled: boolean }) => setGroupDisabled(id, disabled),
    refresh,
  );
  const ownerLink = useAdminMutation(createOwnerInvitation, (issued, groupId) =>
    setLink({ groupId, ...issued }),
  );

  async function confirmDisable(group: AdminGroup) {
    try {
      await toggle.mutateAsync({ id: group.id, disabled: true });
    } catch {
      // The error is shown below
    }
    setDisabling(null);
  }

  return (
    <SettingsSection title="Группы">
      {groups.isError && <Notice variant="error">{toErrorMessage(groups.error)}</Notice>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {groups.data?.map((group) => (
          <li key={group.id} className="space-y-1 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate font-medium">{group.name}</span>
              {group.disabled && (
                <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                  отключена
                </span>
              )}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {group.reportingCurrency} · владельцев: {group.owners} · участников: {group.members}
            </div>
            <div className="flex flex-wrap">
              <button
                type="button"
                aria-label={`Ссылка для владельца: ${group.name}`}
                className={smallButtonClass}
                disabled={ownerLink.isPending}
                onClick={() => ownerLink.mutate(group.id)}
              >
                Ссылка для владельца
              </button>
              {group.disabled ? (
                <button
                  type="button"
                  aria-label={`Включить: ${group.name}`}
                  className={smallButtonClass}
                  onClick={() => toggle.mutate({ id: group.id, disabled: false })}
                >
                  Включить
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Отключить: ${group.name}`}
                  className={dangerButtonClass}
                  onClick={() => setDisabling(group)}
                >
                  Отключить
                </button>
              )}
            </div>
            {link?.groupId === group.id && (
              <LinkPanel
                title={`Ссылка для владельца группы «${group.name}»`}
                token={link.token}
                expiresAt={link.expiresAt}
                onClose={() => setLink(null)}
              />
            )}
          </li>
        ))}
      </ul>
      <ErrorNotice mutations={[toggle, ownerLink]} />
      <NewGroupForm />
      {disabling && (
        <ConfirmDialog
          title="Отключить группу?"
          message={`Участники группы «${disabling.name}» не смогут войти. Данные сохранятся.`}
          confirmLabel="Отключить"
          busy={toggle.isPending}
          onConfirm={() => void confirmDisable(disabling)}
          onCancel={() => setDisabling(null)}
        />
      )}
    </SettingsSection>
  );
}
