import { PlusIcon } from '../../../shared/ui/icons.tsx';

/** The «+ …» button in the header of a list card. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
    >
      <PlusIcon />
      {label}
    </button>
  );
}
