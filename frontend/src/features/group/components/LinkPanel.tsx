import { useRef, useState } from 'react';
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
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/invite/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard access: select the text so it can be copied by hand
      input.current?.select();
    }
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
          className="h-11 shrink-0 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
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
