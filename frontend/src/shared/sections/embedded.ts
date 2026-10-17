import { createContext, useContext } from 'react';

/**
 * Inside a screen of the personal settings the screen itself has the title, so a card does not repeat its own:
 * `SettingsSection` reads this and leaves the title out (or shows it as a small group label).
 */
export const EmbeddedContext = createContext(false);
export const useEmbedded = () => useContext(EmbeddedContext);
