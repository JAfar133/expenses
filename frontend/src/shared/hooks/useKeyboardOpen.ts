import { useEffect, useState } from 'react';

/** The on-screen keyboard is up: the visible area is much smaller than the window (no visualViewport: never). */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setOpen(viewport.height < window.innerHeight * 0.75);
    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);

  return open;
}
