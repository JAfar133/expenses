import { useEffect, useRef, type RefObject } from 'react';
import type { AppNotification } from '../api/notifications.api.ts';

const VISIBLE_RATIO = 0.6;
const DWELL_MS = 800;
const QUIET_MS = 500;
const FALLBACK_MS = 1500;

const pageVisible = () => document.visibilityState !== 'hidden' && !document.hidden;

/** The nearest ancestor that scrolls: the rows are measured against it, not against the screen. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}

/**
 * Unread rows become read by themselves when they are really seen: at least 60% of a row inside the scroll area for
 * about 0.8 s while the tab is visible. The ids are gathered and sent in ONE request after half a second of quiet.
 * Without IntersectionObserver the loaded unread rows are marked after 1.5 s. The rows carry `data-id` and
 * `data-unread`. Only a mounted (open) panel runs this.
 */
export function useAutoRead(
  list: RefObject<HTMLElement | null>,
  items: AppNotification[],
  onRead: (ids: string[]) => void,
) {
  const send = useRef(onRead);
  send.current = onRead;
  const batch = useRef(new Set<string>());
  const flush = useRef<number | undefined>(undefined);
  const unreadIds = items.filter((item) => !item.read).map((item) => item.id);
  const signature = unreadIds.join('|');

  const queue = (id: string) => {
    batch.current.add(id);
    window.clearTimeout(flush.current);
    flush.current = window.setTimeout(() => {
      const ids = [...batch.current];
      batch.current.clear();
      if (ids.length > 0) send.current(ids);
    }, QUIET_MS);
  };

  // Nothing waits after the panel is closed
  useEffect(() => () => window.clearTimeout(flush.current), []);

  useEffect(() => {
    const element = list.current;
    if (!element || signature === '') return;

    if (typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => {
        if (pageVisible()) send.current(signature.split('|'));
      }, FALLBACK_MS);
      return () => window.clearTimeout(timer);
    }

    const timers = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target;
          const id = target.getAttribute('data-id');
          if (!id) continue;
          if (entry.intersectionRatio >= VISIBLE_RATIO) {
            if (timers.has(target)) continue;
            timers.set(
              target,
              window.setTimeout(() => {
                timers.delete(target);
                if (pageVisible()) queue(id);
              }, DWELL_MS),
            );
          } else {
            window.clearTimeout(timers.get(target));
            timers.delete(target);
          }
        }
      },
      { root: scrollParent(element), threshold: [0, VISIBLE_RATIO, 1] },
    );
    element.querySelectorAll('[data-unread="true"]').forEach((row) => observer.observe(row));

    // A hidden tab stops the count: a row has to be seen for the whole time
    const onVisibility = () => {
      if (pageVisible()) return;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
    };
    // `signature` stands for the set of unread rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, list]);
}
