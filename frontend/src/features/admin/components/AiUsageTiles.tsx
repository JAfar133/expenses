import type { AdminAi } from '../api/admin.api.ts';

function Column({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** «Использование (последние 30 дней)»: used today out of the limit, the month, the errors. */
export function AiUsageTiles({
  usage,
  dailyLimit,
}: {
  usage: AdminAi['usage'];
  dailyLimit: number;
}) {
  return (
    <section aria-label="Использование" className="space-y-2">
      <h3 className="text-sm font-semibold">Использование (последние 30 дней)</h3>
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/40">
        <Column label="Сегодня" value={`${usage.today} / ${dailyLimit}`} />
        <Column label="За 30 дней" value={String(usage.month)} />
        <Column label="Ошибок" value={String(usage.errorsMonth)} />
      </div>
    </section>
  );
}
