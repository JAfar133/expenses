import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AutomationIcon } from '../../../shared/ui/icons.tsx';

const SOURCES: Record<string, string> = { idbank: 'IDBank' };

/** The bank as a person knows it; an unknown source is shown as it is. */
export const sourceName = (source: string) => SOURCES[source.toLowerCase()] ?? source;

const WIDTH = 288;
const HEIGHT = 170;

/** «16 окт., 20:40» */
const whenText = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/**
 * A small marker next to the name of an expense that came in automatically (bank notification through an API key).
 * A tap or a click opens a short popover with the key and the bank; it closes on Escape and on a tap outside. The
 * popover is in a portal and placed against the screen, so a table or a list never clips it, and the click does not
 * reach the row.
 */
export function ImportBadge({
  keyName,
  source,
  createdAt,
}: {
  keyName?: string | null;
  source?: string | null;
  /** When the expense was created */
  createdAt?: string;
}) {
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    arrow: number;
    above: boolean;
  } | null>(null);
  const [shown, setShown] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const open = place !== null;
  const when = createdAt ? whenText(createdAt) : null;

  const title = keyName ? `Добавлено автоматически · ключ «${keyName}»` : 'Добавлено автоматически';
  const label = keyName
    ? `Добавлено автоматически из уведомления банка, ключ ${keyName}`
    : 'Добавлено автоматически из уведомления банка';

  const toggle = () => {
    if (open) return setPlace(null);
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8);
    // Under the marker; above it when there is no room below
    const below = rect.bottom + 10;
    const above = below + HEIGHT > window.innerHeight;
    const top = above ? Math.max(8, rect.top - 10 - HEIGHT) : below;
    const centre = rect.left + rect.width / 2 - left;
    setShown(false);
    setPlace({ left, top, arrow: Math.min(Math.max(centre, 16), WIDTH - 16), above });
  };

  // A soft fade and scale-in (switched off by prefers-reduced-motion in the classes below)
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setPlace(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPlace(null);
      button.current?.focus();
    };
    const close = () => setPlace(null);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={title}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className="relative inline-flex shrink-0 items-center text-indigo-400 before:absolute before:-inset-2 before:content-[''] dark:text-indigo-300/80 [&>svg]:size-4"
      >
        <AutomationIcon />
      </button>
      {place &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label="Как добавлен расход"
            style={{
              left: place.left,
              top: place.top,
              width: WIDTH,
              maxWidth: 'calc(100vw - 16px)',
              transformOrigin: `${place.arrow}px ${place.above ? '100%' : '0'}`,
            }}
            className={
              'fixed z-50 rounded-xl border border-zinc-200 bg-white p-3.5 text-sm shadow-xl transition duration-150 ease-out motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900 ' +
              (shown ? 'scale-100 opacity-100' : 'scale-95 opacity-0 motion-reduce:scale-100')
            }
          >
            <span
              aria-hidden="true"
              style={{ left: place.arrow - 6 }}
              className={
                'absolute size-3 rotate-45 border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 ' +
                (place.above ? '-bottom-1.5 border-r border-b' : '-top-1.5 border-t border-l')
              }
            />
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                <AutomationIcon badge size={24} />
              </span>
              <div className="min-w-0">
                <div className="font-semibold">Добавлено автоматически</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">из уведомления банка</div>
              </div>
            </div>
            {(keyName || source || when) && (
              <dl className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                {keyName && <Row label="API-ключ">{keyName}</Row>}
                {source && <Row label="Банк">{sourceName(source)}</Row>}
                {when && <Row label="Добавлено">{when}</Row>}
              </dl>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
