import { WarningIcon } from '../../../shared/ui/icons.tsx';
import type { Budget } from '../api/budgets.api.ts';

const FILL = {
  ok: 'bg-indigo-500 dark:bg-indigo-400',
  warn: 'bg-amber-500',
  over: 'bg-red-500',
};

/** The progress bar of a limit; the part over the limit is hatched. */
export function LimitBar({ budget, className = 'h-1.5' }: { budget: Budget; className?: string }) {
  const fill = Math.min(Math.max(budget.percent, 0), 100);
  const label = budget.category ?? 'Всего';
  // The part over the limit is hatched: it starts where the limit ends
  const limitAt = budget.percent > 100 ? (100 / budget.percent) * 100 : null;
  return (
    <div
      role="progressbar"
      aria-label={`Лимит: ${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fill)}
      className={`relative overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800 ${className}`}
    >
      <div className={`h-full rounded-full ${FILL[budget.level]}`} style={{ width: `${fill}%` }} />
      {limitAt !== null && (
        <div
          className="absolute inset-y-0 right-0"
          style={{
            left: `${limitAt}%`,
            backgroundImage:
              'repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 5px)',
          }}
        />
      )}
    </div>
  );
}

/** The marker of a level: a red circle with «!», an amber triangle or a grey circle. */
export function LevelMark({ tone }: { tone: 'over' | 'warn' | 'plain' }) {
  if (tone === 'warn') {
    return (
      <span aria-hidden="true" className="text-amber-500">
        <WarningIcon />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`flex size-5 items-center justify-center rounded-full text-xs font-bold text-white ${
        tone === 'over' ? 'bg-red-500' : 'bg-zinc-400 dark:bg-zinc-600'
      }`}
    >
      {tone === 'over' ? '!' : 'i'}
    </span>
  );
}
