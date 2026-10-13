import { useEffect } from 'react';

/** How many windows are open now: the page is unlocked only when the last one closes. */
let locks = 0;
let saved: { scrollY: number; style: Partial<CSSStyleDeclaration> } | undefined;

const KEYS = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'] as const;

function lock() {
  const { body, documentElement } = document;
  const scrollbar = window.innerWidth - documentElement.clientWidth;
  saved = {
    scrollY: window.scrollY,
    style: Object.fromEntries(KEYS.map((key) => [key, body.style[key]])),
  };
  // position: fixed is what really stops the page behind a sheet in iOS Safari; the offset keeps it in place
  body.style.position = 'fixed';
  body.style.top = `-${saved.scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
}

function unlock() {
  if (!saved) return;
  const { body } = document;
  for (const key of KEYS) body.style[key] = (saved.style[key] as string | undefined) ?? '';
  if (saved.scrollY > 0) window.scrollTo(0, saved.scrollY);
  saved = undefined;
}

/** Locks the scroll of the page behind an open window (counted, so nested windows do not conflict). */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) lock();
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) unlock();
    };
  }, [active]);
}
