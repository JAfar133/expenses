import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Switch } from '../../../shared/ui/Switch.tsx';
import { SparkIcon } from '../../../shared/ui/icons.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import type { GroupCategory } from '../../group/api/group.api.ts';
import { CategoriesCount } from '../../group/components/CategoriesCount.tsx';
import { CategoryChips } from '../../group/components/CategoryChips.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { FeatureHeader } from '../../group/components/FeatureHeader.tsx';
import { InfoNote } from '../../group/components/InfoNote.tsx';
import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { useSaveReceiptSettings } from '../../receipts/hooks/useSaveReceiptSettings.ts';
import { setGroupAi } from '../api/ai.api.ts';
import { AI_STATUS_KEY, useAiStatus } from '../hooks/useAiStatus.ts';

/**
 * «Разбор чеков с помощью ИИ» (owner): off and disabled while the administrator has not turned the AI on.
 * When it is on: a note with the real limit and, over the categories that have a photo (the AI needs one), a count
 * and the chips.
 */
export function GroupAiRow({ categories }: { categories: GroupCategory[] }) {
  const queryClient = useQueryClient();
  const status = useAiStatus().data;
  const isAdmin = useCurrentUser().data?.isAdmin === true;
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
    <div className="space-y-3 py-4">
      <FeatureHeader
        icon={<SparkIcon />}
        title="Разбор чеков с помощью ИИ"
        description={
          status.installationReady
            ? 'Фото чека отправляется в Google (Gemini): название, дата и позиции заполняются автоматически'
            : 'Выключено администратором'
        }
      >
        <Switch
          checked={on}
          label="Разбор чеков с помощью ИИ"
          disabled={!status.installationReady || save.isPending}
          onChange={(enabled) => save.mutate(enabled)}
        />
      </FeatureHeader>
      {on && (
        <>
          {status.dailyLimit !== undefined && (
            <InfoNote>
              Лимит: {status.dailyLimit} разборов в сутки на группу, сегодня использовано{' '}
              {status.usedToday ?? 0}.{' '}
              {isAdmin ? (
                <Link
                  to="/admin"
                  className="font-medium text-indigo-700 underline dark:text-indigo-300"
                >
                  Администрирование
                </Link>
              ) : (
                'Лимит задаёт администратор приложения.'
              )}
            </InfoNote>
          )}
          {receipts?.enabled && photoCategories.length > 0 && (
            <>
              <CategoriesCount
                chosen={photoCategories.filter((category) => aiOn(category.name)).length}
                total={photoCategories.length}
              />
              <CategoryChips
                label="Категории с разбором ИИ"
                categories={photoCategories}
                isChosen={aiOn}
                onToggle={toggleAi}
                disabled={saveSettings.isPending}
                hint="Выключите для категорий, где это не нужно"
              />
            </>
          )}
        </>
      )}
      <ErrorNotice mutations={[save, saveSettings]} />
    </div>
  );
}
