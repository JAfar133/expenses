import { useState } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import type { GroupCategory } from '../api/group.api.ts';
import { compactSelectClass } from './styles.ts';

interface MergeCategoryDialogProps {
  category: GroupCategory;
  targets: GroupCategory[];
  busy: boolean;
  onMerge: (targetId: string) => void;
  onCancel: () => void;
}

/** Choose the category that takes over all records; the merged one disappears. */
export function MergeCategoryDialog({
  category,
  targets,
  busy,
  onMerge,
  onCancel,
}: MergeCategoryDialogProps) {
  const [targetId, setTargetId] = useState(targets[0]?.id);
  const target = targets.find((item) => item.id === targetId);

  return (
    <Modal title={`Объединить категорию «${category.name}»`} onClose={onCancel}>
      <label htmlFor="merge-target" className="mb-1 block text-sm font-medium">
        Объединить с
      </label>
      <select
        id="merge-target"
        value={targetId}
        className={`${compactSelectClass} mb-3 w-full`}
        onChange={(event) => setTargetId(event.target.value)}
      >
        {targets.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      {target && (
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-300">
          Все траты категории «{category.name}» перейдут в «{target.name}», «{category.name}»
          исчезнет. Это нельзя отменить.
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
        >
          Отмена
        </button>
        <button
          type="button"
          disabled={busy || !target}
          onClick={() => target && onMerge(target.id)}
          className="h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
        >
          Объединить
        </button>
      </div>
    </Modal>
  );
}
