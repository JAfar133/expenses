import { Switch } from '../../../shared/ui/Switch.tsx';
import { CameraIcon } from '../../../shared/ui/icons.tsx';
import type { GroupCategory } from '../../group/api/group.api.ts';
import { CategoriesCount } from '../../group/components/CategoriesCount.tsx';
import { CategoryChips } from '../../group/components/CategoryChips.tsx';
import { ErrorNotice } from '../../group/components/ErrorNotice.tsx';
import { FeatureHeader } from '../../group/components/FeatureHeader.tsx';
import { InfoNote } from '../../group/components/InfoNote.tsx';
import type { ReceiptSettings } from '../api/receipts.api.ts';
import { useReceiptSettings } from '../hooks/useReceiptSettings.ts';
import { useSaveReceiptSettings } from '../hooks/useSaveReceiptSettings.ts';

/** «Фото чеков» (owner): the switch, and when it is on a note, «Категории — 9 выбрано из 11» and the chips. */
export function ReceiptsRow({ categories }: { categories: GroupCategory[] }) {
  const settings = useReceiptSettings().data;
  const save = useSaveReceiptSettings();
  if (!settings) return null;

  const change = (patch: Partial<ReceiptSettings>) => save.mutate({ ...settings, ...patch });
  const active = categories.filter((category) => !category.archived);
  const chosen = active.filter((category) => settings.categories.includes(category.name));
  const toggleCategory = (name: string) =>
    change({
      categories: settings.categories.includes(name)
        ? settings.categories.filter((item) => item !== name)
        : [...settings.categories, name],
    });

  return (
    <div className="space-y-3 py-4">
      <FeatureHeader
        icon={<CameraIcon />}
        title="Фото чеков"
        description="К расходу можно прикреплять фото"
      >
        <Switch
          checked={settings.enabled}
          label="Разрешить фото чеков"
          disabled={save.isPending}
          onChange={(enabled) => change({ enabled })}
        />
      </FeatureHeader>
      {settings.enabled && (
        <>
          <InfoNote>Участники смогут добавлять фото только для выбранных категорий</InfoNote>
          <CategoriesCount chosen={chosen.length} total={active.length} />
          <CategoryChips
            label="Категории с фото чека"
            categories={active}
            isChosen={(name) => settings.categories.includes(name)}
            onToggle={toggleCategory}
            disabled={save.isPending}
          />
        </>
      )}
      <ErrorNotice mutations={[save]} />
    </div>
  );
}
