import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { GroupCategory } from '../../group/api/group.api.ts';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { saveReceiptSettings, type ReceiptSettings } from '../api/receipts.api.ts';
import { RECEIPT_SETTINGS_KEY, useReceiptSettings } from '../hooks/useReceiptSettings.ts';

/** Receipt photos for the group (owner): the switch and the categories where a photo may be attached. */
export function ReceiptsSection({ categories }: { categories: GroupCategory[] }) {
  const queryClient = useQueryClient();
  const settings = useReceiptSettings().data;
  const save = useMutation({
    retry: false,
    mutationFn: saveReceiptSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECEIPT_SETTINGS_KEY }),
  });
  if (!settings) return null;

  const change = (patch: Partial<ReceiptSettings>) => save.mutate({ ...settings, ...patch });
  const active = categories.filter((category) => !category.archived);
  const toggleCategory = (name: string) =>
    change({
      categories: settings.categories.includes(name)
        ? settings.categories.filter((item) => item !== name)
        : [...settings.categories, name],
    });

  return (
    <SettingsSection
      title="Фото чеков"
      hint="К расходу можно приложить фото чека. Включите функцию и выберите категории, где это нужно: в остальных кнопки фото не будет. Участники видят фото по картам, к которым у них есть доступ."
    >
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={save.isPending}
          onChange={(event) => change({ enabled: event.target.checked })}
          className="size-5 accent-indigo-600"
        />
        Разрешить фото чеков
      </label>
      {settings.enabled && (
        <div role="group" aria-label="Категории с фото чека" className="flex flex-wrap gap-2">
          {active.map((category) => {
            const chosen = settings.categories.includes(category.name);
            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={chosen}
                disabled={save.isPending}
                onClick={() => toggleCategory(category.name)}
                className={
                  'h-9 rounded-full border px-3.5 text-sm transition disabled:opacity-60 ' +
                  (chosen
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200')
                }
              >
                {category.name}
              </button>
            );
          })}
        </div>
      )}
      <ErrorNotice mutations={[save]} />
    </SettingsSection>
  );
}
