import type { ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Settings page block: title, description and content. New settings are added as new blocks. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm dark:bg-zinc-900">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}
