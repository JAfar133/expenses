/** Smoothly scrolls an element to the top of the screen; no animation if the user prefers reduced motion. */
export function scrollToElement(element: Element | null | undefined): void {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
