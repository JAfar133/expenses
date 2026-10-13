import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../../shared/ui/Switch.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { SettingRow } from '../../group/components/SettingRow.tsx';
import { setGroupAi } from '../api/ai.api.ts';
import { AI_STATUS_KEY, useAiStatus } from '../hooks/useAiStatus.ts';

/** «Разбор чеков с помощью ИИ» (owner): off and disabled while the administrator has not turned the AI on. */
export function GroupAiRow() {
  const queryClient = useQueryClient();
  const status = useAiStatus().data;
  const save = useMutation({
    retry: false,
    mutationFn: setGroupAi,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_STATUS_KEY }),
  });
  if (!status) return null;

  return (
    <SettingRow
      title="Разбор чеков с помощью ИИ"
      description={
        status.installationReady
          ? 'Фото чека отправляется в Google (Gemini): название, дата и позиции заполняются автоматически'
          : 'Выключено администратором'
      }
      below={<ErrorNotice mutations={[save]} />}
    >
      <Switch
        checked={status.groupEnabled && status.installationReady}
        label="Разбор чеков с помощью ИИ"
        disabled={!status.installationReady || save.isPending}
        onChange={(enabled) => save.mutate(enabled)}
      />
    </SettingRow>
  );
}
