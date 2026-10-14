import type { ReactNode } from 'react';
import { IconBadge } from './IconBadge.tsx';

interface FeatureHeaderProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** The switch at the right */
  children: ReactNode;
}

/** The head of a feature card (photos, AI): icon, title, a line under it and the switch. */
export function FeatureHeader({ icon, title, description, children }: FeatureHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <IconBadge>{icon}</IconBadge>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
