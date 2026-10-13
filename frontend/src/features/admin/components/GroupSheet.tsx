import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkIcon, PauseIcon, PlayIcon } from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { LinkPanel } from '../../group/components/LinkPanel.tsx';
import { createOwnerInvitation, setGroupDisabled, type AdminGroup } from '../api/admin.api.ts';
import { ADMIN_GROUPS_KEY } from '../hooks/useAdminGroups.ts';
import { useAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { groupLimit } from '../model/ai-status.ts';
import { GroupLimit } from './GroupLimit.tsx';

const actionClass =
  'flex h-11 w-full items-center gap-3 rounded-xl border px-4 text-sm font-medium disabled:opacity-60';

/** The window of a group: the owner link, pausing and resuming, and the limit of AI receipts per day. */
export function GroupSheet({ group, onClose }: { group: AdminGroup; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ai = useAdminAi().data;
  const aiGroup = ai?.groups.find((item) => item.id === group.id);
  const [link, setLink] = useState<{ token: string; expiresAt: string } | null>(null);
  const [pausing, setPausing] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_GROUPS_KEY });
  const toggle = useAdminMutation(
    (disabled: boolean) => setGroupDisabled(group.id, disabled),
    refresh,
  );
  const ownerLink = useAdminMutation(createOwnerInvitation, (issued) => setLink(issued));

  async function confirmPause() {
    try {
      await toggle.mutateAsync(true);
    } catch {
      // The error is shown below
    }
    setPausing(false);
  }

  return (
    <Modal title={group.name} onClose={onClose}>
      <div className="space-y-3 pb-2">
        <button
          type="button"
          disabled={ownerLink.isPending}
          onClick={() => ownerLink.mutate(group.id)}
          className={`${actionClass} border-zinc-300 dark:border-zinc-700`}
        >
          <LinkIcon />
          Ссылка-приглашение
        </button>
        {link && (
          <LinkPanel
            title={`Ссылка для владельца группы «${group.name}»`}
            token={link.token}
            expiresAt={link.expiresAt}
            onClose={() => setLink(null)}
          />
        )}

        {group.disabled ? (
          <button
            type="button"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(false)}
            className={`${actionClass} border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300`}
          >
            <PlayIcon />
            Возобновить
          </button>
        ) : (
          <button
            type="button"
            disabled={toggle.isPending}
            onClick={() => setPausing(true)}
            className={`${actionClass} border-red-300 text-red-600 dark:border-red-900 dark:text-red-400`}
          >
            <PauseIcon />
            Приостановить
          </button>
        )}

        {ai && aiGroup && (
          <section
            aria-label="ИИ группы"
            className="space-y-1.5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/40"
          >
            <div className="text-sm font-medium">Лимит ИИ в сутки</div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {aiGroup.enabled ? 'ИИ включён владельцем' : 'ИИ выключен владельцем'} · сегодня
              разобрано {aiGroup.usedToday} из {groupLimit(aiGroup.dailyLimit, ai.dailyLimit)}
            </p>
            <GroupLimit group={aiGroup} commonLimit={ai.dailyLimit} />
          </section>
        )}
        <ErrorNotice mutations={[toggle, ownerLink]} />
      </div>
      {pausing && (
        <ConfirmDialog
          title="Приостановить группу?"
          message={`Участники группы «${group.name}» не смогут войти. Данные сохранятся.`}
          confirmLabel="Приостановить"
          busy={toggle.isPending}
          onConfirm={() => void confirmPause()}
          onCancel={() => setPausing(false)}
        />
      )}
    </Modal>
  );
}
