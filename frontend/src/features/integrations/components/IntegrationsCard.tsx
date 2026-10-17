import type { GroupCard } from '../../group/api/group.api.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { ApiKeysSection } from './ApiKeysSection.tsx';
import { ImportsSection } from './ImportsSection.tsx';
import { SetupInstructions } from './SetupInstructions.tsx';

/** «Интеграции» on the owner's page: API keys, the iPhone setup instruction and the history of imports. */
export function IntegrationsCard({ cards }: { cards: GroupCard[] }) {
  const hasLast4 = cards.some((card) => !card.archived && card.last4);

  return (
    <SettingsSection
      title="Интеграции"
      description="Автоматическое добавление расходов из уведомлений банка"
      compact
    >
      {!hasLast4 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Чтобы расходы попадали на карту,{' '}
          <button
            type="button"
            onClick={() =>
              document.getElementById('group-cards')?.scrollIntoView?.({ behavior: 'smooth' })
            }
            className="font-medium text-indigo-600 underline dark:text-indigo-400"
          >
            укажите последние 4 цифры в настройках карты
          </button>
        </p>
      )}
      <ApiKeysSection />
      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-medium">
          Как настроить автоматизацию на iPhone
        </summary>
        <div className="px-3 pb-3">
          <SetupInstructions />
        </div>
      </details>
      <ImportsSection />
    </SettingsSection>
  );
}
