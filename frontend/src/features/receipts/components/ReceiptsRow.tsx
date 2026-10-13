import { CategoryChips } from '../../group/components/CategoryChips.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { SettingRow } from '../../group/components/SettingRow.tsx';
import { Switch } from '../../../shared/ui/Switch.tsx';
import type { GroupCategory } from '../../group/api/group.api.ts';
import type { ReceiptSettings } from '../api/receipts.api.ts';
import { useReceiptSettings } from '../hooks/useReceiptSettings.ts';
import { useSaveReceiptSettings } from '../hooks/useSaveReceiptSettings.ts';

/** Receipt photos (owner): a switch, and when it is on the chips of the categories where a photo may be attached. */
export function ReceiptsRow({ categories }: { categories: GroupCategory[] }) {
  const settings = useReceiptSettings().data;
  const save = useSaveReceiptSettings();
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
            <CategoryChips
              caption="Категории, где можно прикреплять фото"
              label="Категории с фото чека"
              categories={active}
              isChosen={(name) => settings.categories.includes(name)}
              onToggle={toggleCategory}
              disabled={save.isPending}
            />
          )}
          <ErrorNotice mutations={[save]} />
        </>
      }
    >
      <Switch
        checked={settings.enabled}
        label="Разрешить фото чеков"
        disabled={save.isPending}
        onChange={(enabled) => change({ enabled })}
      />
    </SettingRow>
  );
}
