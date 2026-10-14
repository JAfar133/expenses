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

/** «Настройки группы»: the main settings as rows that open small windows, then the cards of photos and of the AI. */
export function GroupSettingsCard({ group, currencies, categories }: GroupSettingsCardProps) {
  return (
    <SettingsSection title="Настройки группы" compact>
      <div className="-mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
        <section aria-label="Основные настройки" className="pb-1">
          <h3 className="pb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Основные настройки
          </h3>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <GroupNameRow name={group.name} />
            <ReportingCurrencyRow current={group.reportingCurrency} currencies={currencies} />
            <MemberEditRow minutes={group.memberEditMinutes ?? 10080} />
          </div>
        </section>
        <ReceiptsRow categories={categories} />
        <GroupAiRow categories={categories} />
      </div>
    </SettingsSection>
  );
}
