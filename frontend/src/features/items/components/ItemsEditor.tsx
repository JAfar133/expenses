import { CloseIcon, PlusIcon } from '../../../shared/ui/icons.tsx';
import { AiMark } from '../../ai/components/AiMark.tsx';
import {
  MAX_ITEMS,
  MAX_NAME_LENGTH,
  emptyDraft,
  formatPrice,
  formatQuantity,
  isAiGenerated,
  type DraftItem,
} from '../model/draft-items.ts';

const fieldClass =
  'h-11 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900';
const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800';

interface ItemsEditorProps {
  value: DraftItem[];
  onChange: (value: DraftItem[]) => void;
}

/** Rows «название, цена, количество (необязательно)» with icon buttons to add and remove a row. */
export function ItemsEditor({ value, onChange }: ItemsEditorProps) {
  const change = (key: string, patch: Partial<DraftItem>) =>
    onChange(value.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {value.map((row, index) => (
          <li
            key={row.key}
            className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200 p-2 sm:flex-nowrap sm:border-0 sm:p-0 dark:border-zinc-700"
          >
            {/* On a phone the name has the whole first line; the price, the quantity and the cross share the second */}
            <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
              <input
                type="text"
                aria-label={`Название позиции ${index + 1}`}
                placeholder="Название"
                autoComplete="off"
                maxLength={MAX_NAME_LENGTH}
                value={row.name}
                onChange={(event) => change(row.key, { name: event.target.value })}
                className={`${fieldClass} w-full ${isAiGenerated(row) ? 'pr-8' : ''}`}
              />
              {isAiGenerated(row) && (
                <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
                  <AiMark />
                </span>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Цена позиции ${index + 1}`}
              placeholder="Цена"
              autoComplete="off"
              value={row.price}
              onChange={(event) => change(row.key, { price: formatPrice(event.target.value) })}
              className={`${fieldClass} w-32 text-right tabular-nums sm:w-28`}
            />
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Количество позиции ${index + 1}`}
                placeholder="Кол."
                autoComplete="off"
                value={row.quantity}
                onChange={(event) =>
                  change(row.key, { quantity: formatQuantity(event.target.value) })
                }
                className={`${fieldClass} w-20 text-right tabular-nums`}
              />
            </div>
            <button
              type="button"
              aria-label={`Удалить позицию ${index + 1}`}
              title="Удалить позицию"
              onClick={() => onChange(value.filter((item) => item.key !== row.key))}
              className={`${iconButton} ml-auto`}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-label="Добавить позицию"
        title="Добавить позицию"
        disabled={value.length >= MAX_ITEMS}
        onClick={() => onChange([...value, emptyDraft()])}
        className="flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
      >
        <PlusIcon />
        Добавить позицию
      </button>
    </div>
  );
}
