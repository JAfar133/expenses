import type { ReactNode } from 'react';

interface GroupRowProps {
  /** An avatar or an icon */
  lead?: ReactNode;
  /** The name and a line under it */
  main: ReactNode;
  /** What stands before the menu: a value, a badge */
  trailing?: ReactNode;
  /** The «⋯» menu */
  menu?: ReactNode;
  /** Expands under the row: a link panel */
  below?: ReactNode;
}

/** A row of a list card: lead, name, value and the «⋯» menu; the same on every width. */
export function GroupRow({ lead, main, trailing, menu, below }: GroupRowProps) {
  return (
    <li className="py-3.5">
      <div className="flex items-center gap-3">
        {lead}
        <div className="min-w-0 flex-1">{main}</div>
        {trailing}
        {menu}
      </div>
      {below}
    </li>
  );
}
