import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { clampIndex, dropIndex, moveItem, shiftOf } from '../model/reorder.ts';

interface Options {
  /** Ids in the displayed order */
  ids: string[];
  /** The part of the list a row may move inside (both ends included); default: the whole list */
  bounds?: (id: string) => readonly [number, number];
  /** Spoken name of a row */
  labelOf: (id: string) => string;
  /** The row was dropped at a new place: the whole new order and the id that moved */
  onDrop: (ids: string[], movedId: string) => void;
}

interface PointerDrag {
  id: string;
  from: number;
  height: number;
  /** Original centres of all rows, in document coordinates */
  centers: number[];
  startY: number;
  startScroll: number;
  top: number;
}

const EDGE = 72;
const SCROLL_STEP = 12;

/**
 * Drag-and-drop ordering without a library: a handle per row starts a drag by pointer (touch and mouse), or by
 * keyboard (Space picks up, arrows move, Space/Enter drops, Escape cancels). The dragged row follows the pointer, the
 * other rows shift to make room, the page scrolls near the screen edge. The caller saves the order in `onDrop`.
 */
export function useSortableList({ ids, bounds, labelOf, onDrop }: Options) {
  const rows = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLElement>());
  const pointer = useRef<PointerDrag | null>(null);
  const lastY = useRef(0);
  const [drag, setDrag] = useState<{ id: string; dy: number; target: number } | null>(null);
  const [kbd, setKbd] = useState<{ id: string; order: string[] } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const order = kbd?.order ?? ids;
  const rangeOf = useCallback(
    (id: string) => bounds?.(id) ?? ([0, ids.length - 1] as const),
    [bounds, ids.length],
  );

  const position = (list: string[], id: string) =>
    `позиция ${list.indexOf(id) + 1} из ${list.length}`;

  /** Recomputes the dragged row's shift and the place it would drop to. */
  const update = useCallback(
    (clientY: number) => {
      const state = pointer.current;
      if (!state) return;
      const dy = clientY - state.startY + (window.scrollY - state.startScroll);
      const centre = state.top + state.height / 2 + dy;
      const target = clampIndex(dropIndex(state.centers, state.from, centre), rangeOf(state.id));
      setDrag({ id: state.id, dy, target });
    },
    [rangeOf],
  );

  // Keeps scrolling while the pointer rests near the top or the bottom edge
  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const tick = () => {
      const y = lastY.current;
      const step = y < EDGE ? -SCROLL_STEP : y > window.innerHeight - EDGE ? SCROLL_STEP : 0;
      if (step !== 0) {
        window.scrollBy(0, step);
        update(y);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, update]);

  // After a keyboard move the row is re-rendered at its new place: the handle must keep the focus
  const kbdId = kbd?.id;
  const kbdOrderKey = kbd?.order.join('|');
  useLayoutEffect(() => {
    if (kbdId) handles.current.get(kbdId)?.focus();
  }, [kbdId, kbdOrderKey]);

  const start = (event: PointerEvent<HTMLElement>, id: string) => {
    if (event.button !== undefined && event.button > 0) return;
    const from = ids.indexOf(id);
    const row = rows.current.get(id);
    if (from < 0 || !row) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a convenience: without it the move events still arrive on the handle
    }
    const centers = ids.map((other) => {
      const rect = rows.current.get(other)?.getBoundingClientRect();
      return rect ? rect.top + window.scrollY + rect.height / 2 : 0;
    });
    const rect = row.getBoundingClientRect();
    pointer.current = {
      id,
      from,
      height: rect.height,
      centers,
      startY: event.clientY,
      startScroll: window.scrollY,
      top: rect.top + window.scrollY,
    };
    lastY.current = event.clientY;
    setDrag({ id, dy: 0, target: from });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    if (!pointer.current) return;
    lastY.current = event.clientY;
    update(event.clientY);
  };

  const finish = (commit: boolean) => {
    const state = pointer.current;
    const current = drag;
    pointer.current = null;
    setDrag(null);
    if (!commit || !state || !current || current.target === state.from) return;
    onDrop(moveItem(ids, state.from, current.target), state.id);
  };

  const keyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    const picked = kbd?.id === id;
    if (!picked) {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setKbd({ id, order: [...ids] });
        setAnnouncement(
          `Шаблон «${labelOf(id)}»: ${position(ids, id)}. Стрелки вверх и вниз перемещают, пробел отпускает, Escape отменяет`,
        );
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const from = kbd.order.indexOf(id);
      const to = clampIndex(from + (event.key === 'ArrowUp' ? -1 : 1), rangeOf(id));
      if (to === from) return;
      const next = moveItem(kbd.order, from, to);
      setKbd({ id, order: next });
      setAnnouncement(`Шаблон «${labelOf(id)}»: ${position(next, id)}`);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const next = kbd.order;
      setKbd(null);
      if (next.join('|') !== ids.join('|')) {
        onDrop(next, id);
        setAnnouncement(`Шаблон «${labelOf(id)}» перемещён: ${position(next, id)}`);
      } else setAnnouncement(`Шаблон «${labelOf(id)}» остался на месте`);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setKbd(null);
      setAnnouncement('Перемещение отменено');
    }
  };

  const rowStyle = (id: string): CSSProperties | undefined => {
    if (!drag || !pointer.current) return undefined;
    const state = pointer.current;
    if (id === drag.id) {
      return {
        transform: `translateY(${drag.dy}px)`,
        position: 'relative',
        zIndex: 20,
        boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
        borderRadius: 12,
        transition: 'none',
      };
    }
    const shift = shiftOf(ids.indexOf(id), state.from, drag.target, state.height);
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' };
  };

  return {
    /** The ids in the order to display (follows the keyboard move live) */
    order,
    draggingId: drag?.id ?? null,
    pickedId: kbd?.id ?? null,
    announcement,
    rowProps: (id: string) => ({
      ref: (element: HTMLElement | null) => {
        if (element) rows.current.set(id, element);
        else rows.current.delete(id);
      },
      style: rowStyle(id),
    }),
    handleProps: (id: string) => ({
      ref: (element: HTMLElement | null) => {
        if (element) handles.current.set(id, element);
        else handles.current.delete(id);
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => start(event, id),
      onPointerMove: move,
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(event, id),
      'aria-pressed': kbd?.id === id,
    }),
  };
}
