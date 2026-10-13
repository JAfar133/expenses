import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '../../../shared/ui/Switch.tsx';
import type { GroupCategory } from '../../group/api/group.api.ts';
import { CategoryChips } from '../../group/components/CategoryChips.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { SettingRow } from '../../group/components/SettingRow.tsx';
import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { useSaveReceiptSettings } from '../../receipts/hooks/useSaveReceiptSettings.ts';
import { setGroupAi } from '../api/ai.api.ts';
import { AI_STATUS_KEY, useAiStatus } from '../hooks/useAiStatus.ts';

/**
 * «Разбор чеков с помощью ИИ» (owner): off and disabled while the administrator has not turned the AI on.
 * When it is on, right under it the categories where the AI reads receipts (only those that allow a photo).
 */
export function GroupAiRow({ categories }: { categories: GroupCategory[] }) {
  const queryClient = useQueryClient();
  const status = useAiStatus().data;
  const receipts = useReceiptSettings().data;
  const saveSettings = useSaveReceiptSettings();
  const save = useMutation({
    retry: false,
    mutationFn: setGroupAi,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_STATUS_KEY }),
  });
  if (!status) return null;

  const on = status.groupEnabled && status.installationReady;
  const photoCategories = categories.filter(
    (category) => !category.archived && receipts?.categories.includes(category.name),
  );
  // By default the AI reads receipts in every category
  const aiOn = (name: string) => receipts?.aiCategories?.includes(name) ?? true;
  const toggleAi = (name: string) => {
    if (!receipts) return;
    const current = receipts.aiCategories ?? categories.map((category) => category.name);
    saveSettings.mutate({
      ...receipts,
      aiCategories: current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    });
  };

  return (
    <SettingRow
      title="Разбор чеков с помощью ИИ"
      description={
        status.installationReady
          ? 'Фото чека отправляется в Google (Gemini): название, дата и позиции заполняются автоматически'
          : 'Выключено администратором'
      }
      below={
        <>
          {on && receipts?.enabled && photoCategories.length > 0 && (
            <CategoryChips
              caption="Категории, где ИИ читает чеки"
              label="Категории с разбором ИИ"
              categories={photoCategories}
              isChosen={aiOn}
              onToggle={toggleAi}
              disabled={saveSettings.isPending}
              hint="Выключите для категорий, где это не нужно"
            />
          )}
          <ErrorNotice mutations={[save, saveSettings]} />
        </>
      }
    >
      <Switch
        checked={on}
        label="Разбор чеков с помощью ИИ"
        disabled={!status.installationReady || save.isPending}
        onChange={(enabled) => save.mutate(enabled)}
      />
    </SettingRow>
  );
}
