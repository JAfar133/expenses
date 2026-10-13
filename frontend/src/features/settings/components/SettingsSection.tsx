import type { ReactNode } from 'react';
import { HelpHint } from '../../../shared/ui/HelpHint.tsx';

interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Help text: a "?" button next to the title */
  hint?: ReactNode;
  /** A control at the right of the title (e.g. «+ Добавить») */
  action?: ReactNode;
  /** Tighter padding on a phone (16px) */
  compact?: boolean;
  children: ReactNode;
}

/** Settings page block: title, description and content. New settings are added as new blocks. */
export function SettingsSection({
  title,
  description,
  hint,
  action,
  compact = false,
  children,
}: SettingsSectionProps) {
  return (
    <section
      className={`space-y-4 rounded-2xl bg-white shadow-sm dark:bg-zinc-900 ${compact ? 'p-4 sm:p-5' : 'p-5'}`}
    >
      <div>
        <div className="relative flex items-center gap-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <HelpHint>{hint}</HelpHint>}
          {action && <div className="ml-auto">{action}</div>}
        </div>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}
