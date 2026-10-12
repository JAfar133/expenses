import { PencilIcon } from '../../../shared/ui/icons.tsx';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';
import { compactInputClass, textButtonClass } from './styles.ts';

interface EditableRowProps {
  name: string;
  onRename: (name: string) => Promise<unknown>;
  /** Other actions of the row, placed after "Изменить" (buttons, no fragments) */
  children?: ReactNode;
  /** Expands under the row */
  below?: ReactNode;
}

/** A list row with an inline rename: "Изменить" is the first action, the editor replaces the row. */
export function EditableRow({ name, onRename, children, below }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return setEditing(false);
    try {
      await onRename(trimmed);
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
    <ListRow main={<span className="block font-medium">{name}</span>} below={below}>
      <RowActions>
        <ActionButton
          label={`Переименовать: ${name}`}
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
          icon={<PencilIcon />}
        />
        {children}
      </RowActions>
    </ListRow>
  );
}
