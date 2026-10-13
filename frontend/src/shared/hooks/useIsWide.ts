import { useEffect, useState } from 'react';

const QUERY = '(min-width: 640px)';

/** True from the `sm` breakpoint up. Without `matchMedia` (tests, old engines) it is a desktop. */
export function useIsWide(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(QUERY)?.matches ?? true);

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (!media?.addEventListener) return;
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return wide;
}
