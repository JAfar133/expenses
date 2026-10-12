import { useEffect, useRef, useState } from 'react';
import { copyText } from '../../../shared/utils/clipboard.ts';
import { formatDateTime } from '../model/format.ts';

interface LinkPanelProps {
  title: string;
  token: string;
  expiresAt: string;
  onClose?: () => void;
}

/** A one-time invitation link with a copy button. The token is not stored anywhere else. */
export function LinkPanel({ title, token, expiresAt, onClose }: LinkPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const link = `${window.location.origin}/invite/${token}`;

  // The "copied" label goes back to the button after a moment
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    setState((await copyText(link, input.current)) ? 'copied' : 'failed');
  }

  return (
    <div className="space-y-2 rounded-xl bg-indigo-50 p-3 dark:bg-indigo-950/50">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex gap-2">
        <input
          ref={input}
          readOnly
          value={link}
          aria-label="Ссылка"
          onFocus={(event) => event.target.select()}
          className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={state === 'copied' ? 'Скопировано' : 'Скопировать'}
          title={state === 'copied' ? 'Скопировано' : 'Скопировать'}
          className={
            'flex size-11 shrink-0 items-center justify-center rounded-lg text-white transition ' +
            (state === 'copied' ? 'bg-green-600' : 'bg-indigo-600 hover:bg-indigo-500')
          }
        >
          {state === 'copied' ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {state === 'failed' && (
        <p role="status" className="text-xs text-red-600 dark:text-red-400">
          Не удалось скопировать автоматически: нажмите на ссылку и выберите «Копировать».
        </p>
      )}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>действует до {formatDateTime(expiresAt)}</span>
        {onClose && (
          <button type="button" onClick={onClose} className="font-medium text-indigo-600">
            Закрыть
          </button>
        )}
      </div>
    </div>
  );
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
