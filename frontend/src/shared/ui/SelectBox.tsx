import type { ReactNode } from 'react';
import { ChevronDownIcon } from './icons.tsx';

/** A native select with a chevron on the right, in the look of the other form fields (pass the select as a child). */
export function SelectBox({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-zinc-400"
      >
        <ChevronDownIcon />
      </span>
    </div>
  );
}

/** Extra class for a select inside `SelectBox`: room for the chevron. */
export const selectPadding = 'pr-11';
