import { GroupAiRow } from '../../ai/components/GroupAiRow.tsx';
import { ReceiptsRow } from '../../receipts/components/ReceiptsRow.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { GroupCategory, GroupOverview } from '../api/group.api.ts';
import { GroupNameRow } from './GroupNameRow.tsx';
import { MemberEditRow } from './MemberEditRow.tsx';
import { ReportingCurrencyRow } from './ReportingCurrencyRow.tsx';

interface GroupSettingsCardProps {
  group: GroupOverview['group'];
  currencies: string[];
  categories: GroupCategory[];
}

/** «Настройки группы»: one card, the settings are rows separated by thin lines. */
export function GroupSettingsCard({ group, currencies, categories }: GroupSettingsCardProps) {
  return (
    <SettingsSection title="Настройки группы" compact>
      <div className="-my-3.5 divide-y divide-zinc-100 dark:divide-zinc-800">
        <GroupNameRow name={group.name} />
        <ReportingCurrencyRow current={group.reportingCurrency} currencies={currencies} />
        <MemberEditRow minutes={group.memberEditMinutes ?? 10080} />
        <ReceiptsRow categories={categories} />
        <GroupAiRow categories={categories} />
      </div>
    </SettingsSection>
  );
}
