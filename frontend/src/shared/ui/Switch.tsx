interface SwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A toggle switch (role=switch); the label is its accessible name. */
export function Switch({ checked, label, disabled = false, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ' +
        (checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700')
      }
    >
      <span
        aria-hidden="true"
        className={
          'absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ' +
          (checked ? 'left-[1.375rem]' : 'left-0.5')
        }
      />
    </button>
  );
}
