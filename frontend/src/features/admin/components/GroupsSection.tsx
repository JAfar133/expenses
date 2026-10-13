import { useState } from 'react';
import { HintList } from '../../../shared/ui/HelpHint.tsx';
import {
  ChevronRightSmallIcon,
  LinkIcon,
  PauseIcon,
  UsersIcon,
} from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { useAdminGroups } from '../hooks/useAdminGroups.ts';
import { membersLabel, ownersLabel } from '../model/plural.ts';
import { GroupSheet } from './GroupSheet.tsx';
import { NewGroupForm } from './NewGroupForm.tsx';

/** All groups of the application: a compact row each (a window with the actions opens on a tap) and a new group. */
export function GroupsSection() {
  const groups = useAdminGroups();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const selected = groups.data?.find((group) => group.id === selectedId);

  return (
    <SettingsSection
      title="Группы"
      hint={
        <HintList
          items={[
            [
              'Строка группы',
              'нажмите: ссылка-приглашение для владельца (одноразовая), приостановка и лимит ИИ.',
              <LinkIcon />,
            ],
            [
              'Приостановить',
              'участники не смогут ничего видеть и добавлять; данные остаются, группу можно возобновить.',
              <PauseIcon />,
            ],
            [
              'Новая группа',
              'создаёт пустую группу и ссылку для владельца (7 дней); траты группы вы не увидите.',
            ],
          ]}
        />
      }
    >
      {groups.isError && <Notice variant="error">{toErrorMessage(groups.error)}</Notice>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {groups.data?.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              onClick={() => setSelectedId(group.id)}
              className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"
              >
                <UsersIcon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{group.name}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {group.reportingCurrency} · {ownersLabel(group.owners)} ·{' '}
                  {membersLabel(group.members)}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                  group.disabled
                    ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                }`}
              >
                {group.disabled ? 'Приостановлена' : 'Активна'}
              </span>
              <span aria-hidden="true" className="shrink-0 text-zinc-400">
                <ChevronRightSmallIcon />
              </span>
              <span className="sr-only">{`Открыть группу ${group.name}`}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="flex min-h-12 w-full items-center justify-between rounded-xl bg-indigo-50 px-4 text-sm font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
      >
        + Создать новую группу
        <ChevronRightSmallIcon />
      </button>
      {selected && <GroupSheet group={selected} onClose={() => setSelectedId(null)} />}
      {creating && (
        <Modal title="Новая группа" onClose={() => setCreating(false)}>
          <NewGroupForm />
        </Modal>
      )}
    </SettingsSection>
  );
}
