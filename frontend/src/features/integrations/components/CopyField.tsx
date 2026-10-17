import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '../../../shared/ui/icons.tsx';
import { copyText } from '../../../shared/utils/clipboard.ts';

/** A read-only value in a monospace box with a «Копировать» button and «Скопировано» feedback. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className="flex gap-2">
        <input
          ref={input}
          readOnly
          value={value}
          aria-label={label}
          onFocus={(event) => event.target.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="button"
          onClick={async () =>
            setState((await copyText(value, input.current)) ? 'copied' : 'failed')
          }
          aria-label={`Копировать: ${label}`}
          className={
            'flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white transition ' +
            (state === 'copied' ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500')
          }
        >
          {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
          {state === 'copied' ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      {state === 'failed' && (
        <p role="status" className="text-xs text-red-600 dark:text-red-400">
          Не удалось скопировать автоматически: нажмите на поле и выберите «Копировать».
        </p>
      )}
    </div>
  );
}
