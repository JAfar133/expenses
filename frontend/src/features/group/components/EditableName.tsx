import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
import { useState, type FormEvent } from 'react';
import { compactInputClass, smallButtonClass } from './styles.ts';

interface EditableNameProps {
  name: string;
  muted?: boolean;
  /** Help for the rename action */
  hint?: string;
  onRename: (name: string) => Promise<unknown>;
}

/** A name with an inline rename: the field opens in place of the text. */
export function EditableName({ name, muted = false, hint, onRename }: EditableNameProps) {
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

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className={`truncate font-medium ${muted ? 'text-zinc-500' : ''}`}>{name}</span>
        <button
          type="button"
          aria-label={`Переименовать: ${name}`}
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
          className={smallButtonClass}
        >
          Изменить
        </button>
        {hint && <HelpHint>{hint}</HelpHint>}
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex min-w-0 flex-1 gap-2">
      <input
        autoFocus
        aria-label={`Новое название: ${name}`}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={compactInputClass}
      />
      <button type="submit" className={smallButtonClass}>
        Сохранить
      </button>
      <button type="button" onClick={() => setEditing(false)} className={smallButtonClass}>
        Отмена
      </button>
    </form>
  );
}
