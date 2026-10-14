import { needsPhotoMenu } from '../utils/photo-source.ts';
import { useIsWide } from './useIsWide.ts';

/**
 * On touch devices without a system choice for a file input (Chrome, Firefox on Android) the app offers
 * «Сфотографировать / Выбрать из галереи» itself. `phone` forces the touch case (the bottom bar exists only there).
 */
export function usePhotoMenuNeeded({ phone = false }: { phone?: boolean } = {}): boolean {
  const wide = useIsWide();
  if (typeof navigator === 'undefined') return false;
  const coarse =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
  return needsPhotoMenu({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    touch: phone || !wide || coarse,
  });
}
