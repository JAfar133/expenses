import type { ReactNode } from 'react';
import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
import { useEmbedded } from '../../../shared/sections/embedded.ts';

interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Help text: a "?" button next to the title */
  hint?: ReactNode;
  /** A control at the right of the title (e.g. «+ Добавить») */
  action?: ReactNode;
  /** Tighter padding on a phone (16px) */
  compact?: boolean;
  /** Inside a settings screen: `hide` leaves the title out (the screen has it), `label` shows it as a small group label */
  embeddedTitle?: 'hide' | 'label';
  children: ReactNode;
}

/** Settings page block: title, description and content. New settings are added as new blocks. */
export function SettingsSection({
  title,
  description,
  hint,
  action,
  compact = false,
  embeddedTitle = 'hide',
  children,
}: SettingsSectionProps) {
  const embedded = useEmbedded();
  if (embedded) {
    const label = embeddedTitle === 'label';
    return (
      <section
        aria-label={title}
        className={`space-y-4 rounded-2xl bg-white shadow-sm dark:bg-zinc-900 ${compact ? 'p-4 sm:p-5' : 'p-5'}`}
      >
        {(label || description || action || hint) && (
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {label && (
                <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
              )}
            </div>
            {hint && <HelpHint>{hint}</HelpHint>}
            {action}
          </div>
        )}
        {children}
      </section>
    );
  }

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
