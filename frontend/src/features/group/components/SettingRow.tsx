import type { ReactNode } from 'react';

interface SettingRowProps {
  title: string;
  description?: string;
  /** The control at the right */
  children: ReactNode;
  /** Extra content under the row (e.g. the chips of the receipts) */
  below?: ReactNode;
}

/** A row of the settings card: the title with a short description on the left, the control on the right. */
export function SettingRow({ title, description, children, below }: SettingRowProps) {
  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {description && <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      </div>
      {below && <div className="mt-3">{below}</div>}
    </div>
  );
}
