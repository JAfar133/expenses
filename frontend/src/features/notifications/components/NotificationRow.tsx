import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DocumentIcon,
  MegaphoneIcon,
  TrashIcon,
  UserIcon,
  WarningIcon,
} from '../../../shared/ui/icons.tsx';
import { sourceLabel } from '../../integrations/model/format.ts';
import type { AppNotification, NotificationType } from '../api/notifications.api.ts';
import { relativeTime } from '../model/time.ts';

const ICONS: Record<NotificationType, ReactNode> = {
  expense_imported: <CheckIcon />,
  import_problem: <WarningIcon />,
  receipt_parsed: <DocumentIcon />,
  announcement: <MegaphoneIcon />,
  member_joined: <UserIcon />,
};

/** The soft square of the icon: green for an added expense, amber for a problem, blue for people, grey for a receipt. */
const SQUARES: Record<NotificationType, string> = {
  expense_imported: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300',
  import_problem: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300',
  announcement: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300',
  member_joined: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300',
  receipt_parsed: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** The one muted line under the title: who or where it is from, and when. */
export function metaLine(item: AppNotification): string {
  const data = item.data ?? {};
  const time = relativeTime(item.createdAt);
  if (item.type === 'announcement') {
    return [text(data.senderName), text(data.groupName), time].filter(Boolean).join(' · ');
  }
  if (item.type === 'import_problem' || item.type === 'expense_imported') {
    const source =
      text(data.sourceLabel) ?? (text(data.source) ? sourceLabel(String(data.source)) : null);
    return [source, time].filter(Boolean).join(' · ');
  }
  return time;
}

/** The short text under the meta line: for a problem it is the reason. */
export const bodyOf = (item: AppNotification): string =>
  (item.type === 'import_problem' ? text(item.data?.reason) : null) ?? item.body;

/** A guess for places without layout (tests): long enough to be cut by the clamp. The real check is the measurement. */
export const isLong = (value: string) => value.length > 90 || value.includes('\n');

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
  const announcement = item.type === 'announcement';
  const [expanded, setExpanded] = useState(false);
  const body = bodyOf(item);
  const bodyBox = useRef<HTMLSpanElement>(null);
  // Whether the clamp really hides something, measured while the text is folded; unknown (null) without layout
  const [overflows, setOverflows] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const box = bodyBox.current;
    if (!announcement || !box || expanded) return;
    const measure = () => {
      if (box.clientHeight > 0) setOverflows(box.scrollHeight > box.clientHeight + 1);
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [announcement, expanded, body]);
  const long = announcement && (overflows ?? isLong(body));
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
  // A white card; a problem only gets a thin amber accent at the left
  const base =
    'bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60' +
    (warn ? ' border-l-2 border-amber-400 dark:border-amber-500' : '');

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
      className="group relative overflow-hidden border-b border-zinc-100 last:border-b-0 dark:border-zinc-800"
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
          aria-expanded={announcement ? expanded : undefined}
          onClick={() => {
            if (announcement) setExpanded((value) => !value);
            onOpen(item);
          }}
          onKeyDown={onKey}
          className="flex min-h-14 w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left [@media(hover:hover)]:pr-9"
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${SQUARES[item.type]}`}
          >
            {ICONS[item.type]}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={
                'block text-sm ' +
                (item.read ? 'font-semibold' : 'font-semibold text-zinc-900 dark:text-zinc-50')
              }
            >
              {item.title}
            </span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{metaLine(item)}</span>
            <span
              ref={bodyBox}
              className={
                'mt-0.5 block text-sm break-words whitespace-pre-line text-zinc-600 dark:text-zinc-300 ' +
                (announcement && expanded ? '' : 'line-clamp-2')
              }
            >
              {body}
            </span>
            {long && (
              <span className="mt-0.5 block text-sm font-medium text-indigo-600 dark:text-indigo-400">
                {expanded ? 'Свернуть' : 'Читать полностью'}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-center gap-2 pt-1">
            <span
              {...(item.read
                ? { 'aria-hidden': true }
                : { role: 'img', 'aria-label': 'Не прочитано' })}
              className={
                'size-2.5 rounded-full bg-indigo-600 transition-opacity duration-500 dark:bg-indigo-400 ' +
                (item.read ? 'opacity-0' : 'opacity-100')
              }
            />
            {(announcement ? long : true) && (
              <span
                aria-hidden="true"
                className={
                  'text-zinc-400 transition ' + (announcement && expanded ? 'rotate-180' : '')
                }
              >
                {announcement ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </span>
            )}
          </span>
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
