import { useState, type FormEvent } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';

export const DEFAULT_KEY_NAME = 'iPhone — IDBank';

/**
 * The name and the default category of an API key: creating a key (`initial` is empty) or changing one. The category
 * is for expenses from the bank when the group has no earlier expense of such a merchant.
 */
export function KeyDialog({
  title,
  submitLabel,
  initial,
  categories,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial?: { name: string; defaultCategory: string | null };
  /** Names of the active categories of the group */
  categories: string[];
  busy: boolean;
  error: unknown;
  onSubmit: (values: { name: string; defaultCategory: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? DEFAULT_KEY_NAME);
  const [category, setCategory] = useState(initial?.defaultCategory ?? '');
  // A category that was archived since stays selectable so that saving does not drop it silently
  const options =
    category && !categories.includes(category) ? [category, ...categories] : categories;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && !busy) onSubmit({ name: name.trim(), defaultCategory: category || null });
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Название ключа
          </span>
          <input
            autoFocus
            aria-label="Название ключа"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${compactInputClass} h-12 w-full`}
          />
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            Чтобы потом понять, с какого телефона или автоматизации пришли расходы
          </span>
        </label>
        <div className="space-y-1.5">
          <label
            htmlFor="key-category"
            className="block text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            Категория по умолчанию
          </label>
          <SelectBox>
            <select
              id="key-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={`${compactInputClass} ${selectPadding} h-12 w-full`}
            >
              <option value="">Не выбрана (будет «другое»)</option>
              {options.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </SelectBox>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Для расходов из банка, если по такому магазину у вас ещё нет трат
          </p>
        </div>
        {error != null && <Notice variant="error">{toErrorMessage(error)}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy || name.trim() === ''}
            className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
