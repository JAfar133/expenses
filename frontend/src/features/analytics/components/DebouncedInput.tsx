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

/** Поле, которое сообщает о значении не на каждую букву, а когда пользователь на мгновение остановился. */
export function DebouncedInput({ value, onCommit, delayMs = 300, ...props }: DebouncedInputProps) {
  const [draft, setDraft] = useState(value);
  // Свежий обработчик без перезапуска таймера при каждой перерисовке родителя
  const commit = useRef(onCommit);
  commit.current = onCommit;

  // Значение изменили снаружи (например, сброс фильтров)
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
