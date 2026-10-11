import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { inputClassName } from '../../../shared/ui/Field.tsx';

interface DebouncedInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
> {
  value: string;
  onCommit: (value: string) => void;
  delayMs?: number;
}

/** An input that reports its value not on every keystroke but when the user pauses briefly. */
export function DebouncedInput({ value, onCommit, delayMs = 300, ...props }: DebouncedInputProps) {
  const [draft, setDraft] = useState(value);
  // Fresh handler without restarting the timer on every parent re-render
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // The value was changed from outside (e.g. filter reset)
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => commit.current(draft), delayMs);
    return () => clearTimeout(timer);
  }, [draft, value, delayMs]);

  return (
    <input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      className={inputClassName}
    />
  );
}
