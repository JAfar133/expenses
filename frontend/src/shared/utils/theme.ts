export type ThemeChoice = 'system' | 'light' | 'dark';

/**
 * The explicit theme goes to `<html data-theme>`; «system» removes the attribute, and then the CSS follows
 * `prefers-color-scheme`. The same rule is in the inline script of `index.html` (it runs before the first paint).
 */
export function applyTheme(choice: ThemeChoice | string | undefined): void {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');
}
