import { useEffect } from 'react';
import { applyTheme } from '../../../shared/utils/theme.ts';
import { usePreference } from './usePreferences.ts';

/**
 * Keeps the chosen theme on the page. The value comes from the server (and is mirrored in localStorage, where the
 * inline script of `index.html` reads it before the first paint, so there is no flash).
 */
export function useTheme(): void {
  const [theme] = usePreference('theme');
  useEffect(() => applyTheme(theme), [theme]);
}
