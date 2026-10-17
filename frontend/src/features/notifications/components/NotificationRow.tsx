import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  CloseIcon,
  CreditCardIcon,
  DocumentIcon,
  MegaphoneIcon,
  TrashIcon,
  WarningIcon,
} from '../../../shared/ui/icons.tsx';
import type { AppNotification, NotificationType } from '../api/notifications.api.ts';
import { relativeTime } from '../model/time.ts';

const ICONS: Record<NotificationType, ReactNode> = {
  expense_imported: <CreditCardIcon />,
  import_problem: <WarningIcon />,
  receipt_parsed: <DocumentIcon />,
  announcement: <MegaphoneIcon />,
};

const INTENT_PX = 8;
const COMMIT_RATIO = 0.4;
const FLICK_PX_PER_MS = 0.6;
const MOVE_MS = 180;

const reducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

interface Gesture {
  id: number;
  x: number;
  y: number;
  time: number;
  dragging: boolean;
}

/**
 * One notification: the type in a soft circle, title, body, time and a dot while it is unread. A swipe to the left
 * (touch or mouse) hides it: the row follows the finger, a red «Скрыть» shows behind it, past 40% of the width (or a
 * quick flick) it slides out and folds up. The «×» button and the Delete key do the same for the keyboard and mouse.
 */
export function NotificationRow({
  item,
  onOpen,
  onHide,
}: {
  item: AppNotification;
  onOpen: (item: AppNotification) => void;
  onHide: (item: AppNotification) => void;
}) {
  const warn = item.type === 'import_problem';
  const row = useRef<HTMLLIElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'out' | 'fold'>('idle');
  const [height, setHeight] = useState<number>();

  const hide = () => {
    if (phase !== 'idle') return;
    if (reducedMotion()) return onHide(item);
    setHeight(row.current?.offsetHeight);
    setPhase('out');
    window.setTimeout(() => setPhase('fold'), MOVE_MS);
    window.setTimeout(() => onHide(item), MOVE_MS * 2);
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'idle' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      dragging: false,
    };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.dragging) {
      // The horizontal drag starts only on a clear horizontal intent; a vertical one is the page's scroll
      if (Math.abs(dy) > INTENT_PX && Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      if (Math.abs(dx) < INTENT_PX) return;
      g.dragging = true;
      setDragging(true);
      try {
        front.current?.setPointerCapture(event.pointerId);
      } catch {
        // Without capture the move events still arrive while the pointer is over the row
      }
    }
    setOffset(Math.min(0, dx));
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !g.dragging) return;
    setDragging(false);
    swallowClick.current = true;
    const dx = event.clientX - g.x;
    const width = front.current?.offsetWidth ?? 0;
    const speed = dx / Math.max(1, event.timeStamp - g.time);
    const flick = speed < -FLICK_PX_PER_MS && dx < -40;
    if (!cancelled && (flick || -dx > width * COMMIT_RATIO)) hide();
    else setOffset(0);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      hide();
    }
  };

  const out = phase !== 'idle';
  const base = warn
    ? 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/60'
    : 'bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60';

  return (
    <li
      ref={row}
      data-type={item.type}
      data-read={item.read}
      data-id={item.id}
      data-unread={!item.read}
      style={
        phase === 'idle'
          ? undefined
          : { height: phase === 'fold' ? 0 : height, transition: `height ${MOVE_MS}ms ease` }
      }
      className="group relative overflow-hidden rounded-xl"
    >
      {(offset < 0 || out) && (
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-end gap-2 bg-red-600 pr-5 text-sm font-semibold text-white"
        >
          <TrashIcon />
          Скрыть
        </div>
      )}
      <div
        ref={front}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
        onClickCapture={(event) => {
          // The click that ends a swipe is not a tap
          if (swallowClick.current) {
            swallowClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        style={{
          touchAction: 'pan-y',
          transform: out
            ? 'translateX(-100%)'
            : offset === 0
              ? undefined
              : `translateX(${offset}px)`,
          transition: dragging || reducedMotion() ? 'none' : `transform ${MOVE_MS}ms ease`,
        }}
        className={`relative rounded-xl ${base}`}
      >
        <button
          type="button"
          onClick={() => onOpen(item)}
          onKeyDown={onKey}
          className="flex min-h-14 w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left [@media(hover:hover)]:pr-9"
        >
          <span
            aria-hidden="true"
            className={
              'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ' +
              (warn
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                : 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300')
            }
          >
            {ICONS[item.type]}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={
                'block text-sm ' +
                (item.read ? 'font-medium' : 'font-semibold text-zinc-900 dark:text-zinc-50')
              }
            >
              {item.title}
            </span>
            {typeof item.data?.senderName === 'string' && item.data.senderName && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                Отправитель: {item.data.senderName}
              </span>
            )}
            <span className="line-clamp-2 block text-sm text-zinc-600 dark:text-zinc-300">
              {item.body}
            </span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              {relativeTime(item.createdAt)}
            </span>
          </span>
          <span
            {...(item.read
              ? { 'aria-hidden': true }
              : { role: 'img', 'aria-label': 'Не прочитано' })}
            className={
              'mt-2 size-2.5 shrink-0 rounded-full bg-indigo-600 transition-opacity duration-500 dark:bg-indigo-400 ' +
              (item.read ? 'opacity-0' : 'opacity-100')
            }
          />
        </button>
        <button
          type="button"
          aria-label="Скрыть уведомление"
          title="Скрыть"
          onClick={hide}
          // On a mouse it shows on hover or focus; on a touch screen the swipe is the way, the button stays for assistive tech
          className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full text-zinc-500 opacity-0 hover:bg-zinc-200/70 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 dark:text-zinc-400 dark:hover:bg-zinc-700/70 [@media(hover:none)]:pointer-events-none"
        >
          <CloseIcon />
        </button>
      </div>
    </li>
  );
}
