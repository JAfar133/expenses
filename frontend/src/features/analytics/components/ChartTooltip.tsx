interface TooltipRow {
  label: string;
  value: string;
  /** Marker color (not text): text keeps the UI color */
  color?: string;
}

/** Hover tooltip: a title and "marker · value" rows. */
export function ChartTooltip({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
      {title && <div className="mb-1 font-medium text-zinc-900 dark:text-zinc-50">{title}</div>}
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
          {row.color && (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: row.color }}
            />
          )}
          <span>{row.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
