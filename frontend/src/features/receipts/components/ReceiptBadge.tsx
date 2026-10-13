import { CameraIcon } from '../../../shared/ui/icons.tsx';

/** A small camera next to a record that has a photo; pressing it opens the photo. */
export function ReceiptBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Есть фото чека"
      title="Фото чека"
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
    >
      <CameraIcon />
    </button>
  );
}
