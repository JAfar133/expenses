import { AccordionItem } from '../../../shared/ui/AccordionItem.tsx';
import type { PreferenceKey } from '../../preferences/model/preferences.ts';
import { PreferenceSwitch, usePreferenceLabel } from './PreferenceSwitch.tsx';

interface SectionDefinition {
  title: string;
  /** The settings of the section: key and the title of its switch */
  items: [PreferenceKey, string][];
}

const SECTIONS: SectionDefinition[] = [
  {
    title: 'Динамика расходов',
    items: [
      ['daily.type', 'Тип графика'],
      ['daily.mode', 'Отображение'],
    ],
  },
  {
    title: 'Расходы по категориям',
    items: [
      ['category.type', 'Тип графика'],
      ['category.tab', 'Раздел'],
    ],
  },
  {
    title: 'Сравнение месяцев',
    items: [
      ['compare.months', 'Период'],
      ['matrix.type', 'Тип графика'],
    ],
  },
];

/** Section with the current values in one line while it is closed («Столбики · За день»). */
function Section({ title, items }: SectionDefinition) {
  const first = usePreferenceLabel(items[0]![0]);
  const second = usePreferenceLabel(items[1]![0]);

  return (
    <AccordionItem title={title} summary={`${first} · ${second}`}>
      {items.map(([key, label]) => (
        <PreferenceSwitch key={key} prefKey={key} label={label} />
      ))}
    </AccordionItem>
  );
}

/** Chart settings of the analytics pages: three sections, several can be open at once. */
export function AnalyticsAccordion() {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {SECTIONS.map((section) => (
        <Section key={section.title} {...section} />
      ))}
    </div>
  );
}
