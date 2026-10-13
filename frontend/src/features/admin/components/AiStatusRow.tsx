import { Switch } from '../../../shared/ui/Switch.tsx';
import type { AdminAi } from '../api/admin.api.ts';
import { aiStatusOf, type AiTone } from '../model/ai-status.ts';

const DOT: Record<AiTone, string> = {
  grey: 'bg-zinc-400',
  yellow: 'bg-amber-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
};
const CHIP: Record<AiTone, string> = {
  grey: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  yellow: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  green: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  red: 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200',
};

type Setup = Pick<AdminAi, 'keyConfigured' | 'enabled'>;

/** The state as a coloured chip: no key, key without the switch, working, or the last check failed. */
export function AiStatusChip({ ai, lastCheckFailed }: { ai: Setup; lastCheckFailed: boolean }) {
  const status = aiStatusOf(ai, lastCheckFailed);
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${CHIP[status.tone]}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status.tone]}`} />
      {status.label}
    </span>
  );
}

interface AiSwitchRowProps {
  ai: Setup;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}

/** «Использовать ИИ для установки» with the switch; without a key the switch is off and says why. */
export function AiSwitchRow({ ai, busy, onToggle }: AiSwitchRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">Использовать ИИ для установки</div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {ai.keyConfigured ? 'Автоматическое распознавание чеков' : 'Сначала задайте ключ'}
        </p>
      </div>
      <Switch
        checked={ai.enabled}
        label="Использовать ИИ для установки"
        disabled={!ai.keyConfigured || busy}
        onChange={onToggle}
      />
    </div>
  );
}
