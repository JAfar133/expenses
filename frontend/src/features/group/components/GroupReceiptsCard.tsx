import { GroupAiRow } from '../../ai/components/GroupAiRow.tsx';
import { ReceiptsRow } from '../../receipts/components/ReceiptsRow.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { GroupCategory } from '../api/group.api.ts';

/** «Чеки и ИИ»: photos of receipts (which categories allow them) and the AI that reads them. */
export function GroupReceiptsCard({ categories }: { categories: GroupCategory[] }) {
  return (
    <SettingsSection title="Чеки и ИИ" compact>
      <div className="-mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
        <ReceiptsRow categories={categories} />
        <GroupAiRow categories={categories} />
      </div>
    </SettingsSection>
  );
}
