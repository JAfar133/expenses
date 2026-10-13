import { Switch } from '../../../shared/ui/Switch.tsx';
import type { AdminAi } from '../api/admin.api.ts';
import { aiStatusOf, switchCaption, type AiTone } from '../model/ai-status.ts';

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

interface AiStatusRowProps {
  ai: Pick<AdminAi, 'keyConfigured' | 'enabled'>;
  lastCheckFailed: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
}

/** The top line: the state as a coloured chip, and the switch of the AI for the whole installation. */
export function AiStatusRow({ ai, lastCheckFailed, busy, onToggle }: AiStatusRowProps) {
  const status = aiStatusOf(ai, lastCheckFailed);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span
        role="status"
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${CHIP[status.tone]}`}
      >
        <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status.tone]}`} />
        {status.label}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-right">
          <span className="block text-sm font-medium">ИИ для установки</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {switchCaption(ai)}
          </span>
        </span>
        <Switch
          checked={ai.enabled}
          label="ИИ для установки"
          disabled={!ai.keyConfigured || busy}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}
