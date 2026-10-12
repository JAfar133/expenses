import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { PauseIcon, PlayIcon } from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { ActionButton, ListRow, RowActions } from '../../group/components/ListRow.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { SYNC_STATE_KEY } from '../../sync/hooks/useSyncState.ts';
import { fetchAdminSync, setAdminSync } from '../api/admin.api.ts';

export const ADMIN_SYNC_KEY = ['admin', 'sync'];

const CONFIRM_TEXT = {
  off: 'Приложение перестанет обращаться к OneDrive: не будет проверять файл и таблицу и вносить в них изменения. Траты, сделанные пока она выключена, останутся в очереди и попадут в Excel при включении.',
  on: 'Приложение снова начнёт сверять Excel с базой и записывать в него траты, в том числе накопившиеся.',
};

/** The switch of Excel synchronization for the whole installation. */
export function SyncSection() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const sync = useQuery({ queryKey: ADMIN_SYNC_KEY, queryFn: fetchAdminSync, retry: false });

  const change = useMutation({
    retry: false,
    mutationFn: setAdminSync,
    // The header icon appears or disappears at once, without waiting for the next poll
    onSuccess: async (state) => {
      queryClient.setQueryData(ADMIN_SYNC_KEY, state);
      await queryClient.invalidateQueries({ queryKey: SYNC_STATE_KEY });
    },
  });

  const state = sync.data;
  const stateText = !state
    ? '…'
    : !state.configured
      ? 'Не настроена на сервере'
      : state.enabled
        ? 'Включена'
        : 'Выключена';

  async function confirm() {
    if (!state) return;
    try {
      await change.mutateAsync(!state.enabled);
    } catch {
      // The error is shown below
    }
    setConfirming(false);
  }

  return (
    <SettingsSection
      title="Синхронизация с Excel"
      hint="Выключатель для всей установки. Выключенная синхронизация не нагружает сервер и не требует доступа к OneDrive. Сам файл остаётся как есть."
    >
      {sync.isError && <Notice variant="error">{toErrorMessage(sync.error)}</Notice>}
      {state && (
        <ul>
          <ListRow
            main={
              <>
                <span className="block font-medium">{stateText}</span>
                {!state.configured && (
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    Включить нельзя: файл Excel не настроен на сервере
                  </span>
                )}
              </>
            }
          >
            <RowActions>
              <ActionButton
                label={state.enabled ? 'Выключить синхронизацию' : 'Включить синхронизацию'}
                tone={state.enabled ? 'danger' : 'success'}
                icon={state.enabled ? <PauseIcon /> : <PlayIcon />}
                disabled={!state.configured || change.isPending}
                onClick={() => setConfirming(true)}
              />
            </RowActions>
          </ListRow>
        </ul>
      )}
      {change.isError && <Notice variant="error">{toErrorMessage(change.error)}</Notice>}
      {confirming && state && (
        <ConfirmDialog
          title={state.enabled ? 'Выключить синхронизацию?' : 'Включить синхронизацию?'}
          message={state.enabled ? CONFIRM_TEXT.off : CONFIRM_TEXT.on}
          confirmLabel={state.enabled ? 'Выключить' : 'Включить'}
          busy={change.isPending}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingsSection>
  );
}
