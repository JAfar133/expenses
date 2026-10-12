import { PencilIcon } from '../../../shared/ui/icons.tsx';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';
import { compactInputClass, compactSelectClass, textButtonClass } from './styles.ts';

interface EditableRowProps {
  name: string;
  /** Small muted text under the name (e.g. the currency of a card) */
  meta?: string;
  /** A currency that can be changed together with the name (shown only with several options) */
  currency?: { value: string; options: string[] };
  onRename: (name: string, currency?: string) => Promise<unknown>;
  /** Other actions of the row, placed after "Изменить" (buttons, no fragments) */
  children?: ReactNode;
  /** Expands under the row */
  below?: ReactNode;
}

/** A list row with an inline rename: "Изменить" is the first action, the editor replaces the row. */
export function EditableRow({ name, meta, currency, onRename, children, below }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [currencyValue, setCurrencyValue] = useState(currency?.value ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    const currencyChanged = currency !== undefined && currencyValue !== currency.value;
    if (!trimmed || (trimmed === name && !currencyChanged)) return setEditing(false);
    try {
      await onRename(trimmed, currencyChanged ? currencyValue : undefined);
      setEditing(false);
    } catch {
      // The error is shown by the section; stay in the editor
    }
  }

  if (editing) {
    return (
      <li className="py-3">
        <form
          onSubmit={(event) => void submit(event)}
          className="grid gap-2 sm:flex sm:items-center"
        >
          <input
            autoFocus
            aria-label={`Новое название: ${name}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={`${compactInputClass} w-full sm:flex-1`}
          />
          {currency && currency.options.length > 1 && (
            <select
              aria-label={`Валюта: ${name}`}
              value={currencyValue}
              onChange={(event) => setCurrencyValue(event.target.value)}
              className={`${compactSelectClass} h-11 w-full sm:h-10 sm:w-auto`}
            >
              {currency.options.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          )}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0">
            <button type="submit" className={textButtonClass}>
              Сохранить
            </button>
            <button type="button" onClick={() => setEditing(false)} className={textButtonClass}>
              Отмена
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <ListRow
      main={
        <>
          <span className="block font-medium">{name}</span>
          {meta && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{meta}</span>}
        </>
      }
      below={below}
    >
      <RowActions>
        <ActionButton
          label={`Переименовать: ${name}`}
          onClick={() => {
            setValue(name);
            setCurrencyValue(currency?.value ?? '');
            setEditing(true);
          }}
          icon={<PencilIcon />}
        />
        {children}
      </RowActions>
    </ListRow>
  );
}
