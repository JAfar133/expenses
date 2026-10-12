import { useState, type FormEvent } from 'react';
import { compactInputClass } from './styles.ts';

interface AddNameFormProps {
  label: string;
  placeholder: string;
  busy?: boolean;
  onAdd: (name: string) => Promise<unknown>;
}

/** A name input with an "Добавить" button; the field is cleared only after a successful save. */
export function AddNameForm({ label, placeholder, busy = false, onAdd }: AddNameFormProps) {
  const [name, setName] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    try {
      await onAdd(trimmed);
      setName('');
    } catch {
      // The error is shown by the section; keep the typed name
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex gap-2">
      <input
        aria-label={label}
        placeholder={placeholder}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className={compactInputClass}
      />
      <button
        type="submit"
        disabled={busy || name.trim() === ''}
        className="h-11 shrink-0 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        Добавить
      </button>
    </form>
  );
}
