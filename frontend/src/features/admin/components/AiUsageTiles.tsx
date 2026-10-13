import type { AdminAi } from '../api/admin.api.ts';

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Step 3: three compact tiles. */
export function AiUsageTiles({ usage }: { usage: AdminAi['usage'] }) {
  return (
    <section aria-label="Использование" className="space-y-2">
      <h3 className="text-sm font-semibold">Использование</h3>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Сегодня" value={usage.today} />
        <Tile label="За 30 дней" value={usage.month} />
        <Tile label="Ошибок за 30 дней" value={usage.errorsMonth} />
      </div>
    </section>
  );
}
