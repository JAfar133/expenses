import { useEffect, useState } from 'react';

const QUERY = '(min-width: 768px)';

/** True from the `md` breakpoint up (two columns on a desktop). Without `matchMedia` (tests) it is a desktop. */
export function useIsMedium(): boolean {
  const [medium, setMedium] = useState(() => globalThis.matchMedia?.(QUERY)?.matches ?? true);

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (!media?.addEventListener) return;
    const update = () => setMedium(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return medium;
}
