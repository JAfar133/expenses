import { useIsWide } from './useIsWide.ts';

/** On a phone (a narrow screen or a touch pointer) the app offers «Сфотографировать / Выбрать из галереи» itself. */
export function usePhotoMenuNeeded(): boolean {
  const wide = useIsWide();
  const coarse =
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches;
  return !wide || coarse;
}
