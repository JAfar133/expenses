import { useEffect, useState } from 'react';

export const COLLAPSE_MS = 150;

/**
 * For a block that grows down and shrinks back: `mounted` while there is anything to show (so the content is loaded
 * only after the first opening), `shown` for the transition (one frame after mounting, so the growth is animated).
 */
export function useCollapse(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS + 30);
    return () => clearTimeout(timer);
  }, [open]);

  return { mounted, shown };
}
