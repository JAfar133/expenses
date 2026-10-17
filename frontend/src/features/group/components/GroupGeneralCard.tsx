import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { GroupOverview } from '../api/group.api.ts';
import { GroupNameRow } from './GroupNameRow.tsx';
import { MemberEditRow } from './MemberEditRow.tsx';
import { ReportingCurrencyRow } from './ReportingCurrencyRow.tsx';

/** «Основные»: the name of the group, the reporting currency and how long members may edit their own expenses. */
export function GroupGeneralCard({
  group,
  currencies,
}: {
  group: GroupOverview['group'];
  currencies: string[];
}) {
  return (
    <SettingsSection title="Основные настройки" compact>
      <div className="-mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
        <GroupNameRow name={group.name} />
        <ReportingCurrencyRow current={group.reportingCurrency} currencies={currencies} />
        <MemberEditRow minutes={group.memberEditMinutes ?? 10080} />
      </div>
    </SettingsSection>
  );
}
