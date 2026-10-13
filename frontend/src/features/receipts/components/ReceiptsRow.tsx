import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { SettingRow } from '../../group/components/SettingRow.tsx';
import type { GroupCategory } from '../../group/api/group.api.ts';
import { saveReceiptSettings, type ReceiptSettings } from '../api/receipts.api.ts';
import { RECEIPT_SETTINGS_KEY, useReceiptSettings } from '../hooks/useReceiptSettings.ts';

/** Receipt photos (owner): a switch, and when it is on the chips of the categories where a photo may be attached. */
export function ReceiptsRow({ categories }: { categories: GroupCategory[] }) {
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
    <SettingRow
      title="Фото чеков"
      description="К расходу можно приложить фото"
      below={
        <>
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
        </>
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={settings.enabled}
        aria-label="Разрешить фото чеков"
        disabled={save.isPending}
        onClick={() => change({ enabled: !settings.enabled })}
        className={
          'relative h-7 w-12 rounded-full transition disabled:opacity-60 ' +
          (settings.enabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700')
        }
      >
        <span
          aria-hidden="true"
          className={
            'absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ' +
            (settings.enabled ? 'left-[1.375rem]' : 'left-0.5')
          }
        />
      </button>
    </SettingRow>
  );
}
