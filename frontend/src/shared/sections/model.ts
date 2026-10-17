import type { ReactNode } from 'react';

/** The background of the colored square of a row. */
export const TONES = {
  account: 'bg-indigo-500',
  templates: 'bg-amber-500',
  notifications: 'bg-red-500',
  appearance: 'bg-violet-500',
  analytics: 'bg-blue-500',
  group: 'bg-emerald-500',
  admin: 'bg-zinc-500',
  general: 'bg-zinc-500',
  members: 'bg-emerald-500',
  cards: 'bg-blue-500',
  categories: 'bg-pink-500',
  receipts: 'bg-teal-500',
  integrations: 'bg-indigo-500',
  broadcast: 'bg-violet-500',
} as const;

export type RowTone = keyof typeof TONES;

export interface RowData {
  to: string;
  tone: RowTone;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** The current value on the right (phone list only): «Включены», «5», «AMD» */
  value?: string;
  /** A red badge with a number; `badgeSuffix` adds a word on the phone list («2 новых») */
  badge?: number;
  badgeSuffix?: string;
  /** Not in the phone list (another row of it already leads here, e.g. the profile); the side menu of a desktop keeps it */
  hiddenInHub?: boolean;
}

export interface RowGroup {
  /** A small label above the group on the hub of a phone */
  label?: string;
  /** The accessible name of the side menu of a desktop for this group (default: the label) */
  menuLabel?: string;
  rows: RowData[];
}
