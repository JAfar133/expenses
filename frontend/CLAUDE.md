# Frontend (React 19 + Vite + Tailwind 4)

Project context: [../README.md](../README.md), how everything works: [../docs/PIPELINE.md](../docs/PIPELINE.md) (in Russian),
details: [README.md](README.md).

## Commands

```bash
npm run dev         # Vite, http://127.0.0.1:5173, /api is proxied to the backend (127.0.0.1:3000)
npm test            # Vitest + Testing Library (fetch is mocked, no backend needed)
npm run typecheck   # tsc
npm run build       # tsc + vite build
npm run format      # Prettier
```

Before finishing work: `typecheck`, `test`, `format`.

## Structure

- `src/features/<name>/` by function: `auth`, `expenses`, `sync`, `analytics` (the analytics page: charts on Recharts, colors and palette in `index.css`), `group` (owner page `/group`: members, invitations, cards with access, categories; and the public invitation page `/invite/:token`, outside `AuthGate`), `templates` (quick-action templates v5: the row of chips above the add form, the «Все» panel, the dialog, the settings card), `admin` (application admin page `/admin`: groups, password reset links). Inside: `api/`, `hooks/`, `components/`, `schemas/`.
- User settings (chart views, etc.) are stored on the server: `features/preferences` (described in `model/preferences.ts`, the `usePreference` hook). The settings page `features/settings` is assembled from blocks.
- `src/pages/` pages, `src/app/` the app root, routes (React Router) and the shared `AppShell` frame. The analytics page is loaded lazily.
- `src/shared/` shared code: `api/http.ts` (requests), `ui/` (Button, Field, Notice), `utils/`.
- An unsaved add-expense form (with photo and AI state) is kept in IndexedDB as a draft (`useFormDraft`, 24 h) and restored with a short `Toast`; writes to the draft store stay strictly ordered.
- Server data goes through TanStack Query, forms through React Hook Form + zod.

## Rules

- **Templates (v5) add nothing to the form fields.** The row above them exists only if the user has usable templates and `templates.strip` is on; a template with an amount creates the expense at once (notice with «Отменить»), without an amount or offline it fills the form (`template` prop of `ExpenseForm`).

- **The UI of a regular user (role `member`) stays exactly as it was.** New things are visible only to an owner (link "Группа") and to an application admin (link "Админ"); for others they are not rendered at all (pages also redirect to `/`). Roles are managed only on the group page.

- All API requests go through `apiRequest` from `shared/api/http.ts`: it refreshes the login itself using the refresh token on a 401
  (one retry) and reports a lost session. Do not use `fetch` directly.
- Tokens are stored in HttpOnly cookies and are not in JS or `localStorage`. `localStorage` holds only conveniences (for example, the user's last category).
- The default card is always the logged-in user's card (`user.card`); the last selected card is not remembered.
- Excel on the server is optional: if `GET /api/sync/status` returned `enabled: false`, the sync icon is not shown and the status is not polled (also when an admin switched sync off on `/admin`; the switch invalidates the status query).
- Works on a phone (PWA): fields no smaller than 16px, large controls, take the light and dark themes into account. The theme is the user preference `theme` (`system|light|dark`): an explicit choice sets `data-theme` on `<html>` (an inline script in `index.html` applies it before the first paint), `prefers-color-scheme` counts only without it. Write dark styles with Tailwind `dark:` / CSS variables, never read the scheme with `matchMedia`.
- UI texts are in Russian, identifiers are in English.
- The code is clean and structured: small components, one task per module, wrap long expressions (Prettier).
- Tests live nearby by meaning in `tests/`; mock `fetch`, query elements by role and accessible name.
- Settings for people must be self-explanatory: a title, the choice shown in words (a segmented control with icons or a labeled control, not a bare switch), and one helper line describing the current choice; avoid negative phrasing. See `features/templates/components/ChoiceSetting.tsx`.
- Web Push (`features/push`, `public/sw.js`): the service worker has no `fetch` handler and no cache and must show a notification for EVERY push (iOS revokes silent subscriptions); the permission is requested only inside the click handler of «Включить уведомления на этом устройстве» (nothing awaited before `requestPermission`); on logout this browser's subscription is removed (best effort).
- Personal settings (`features/settings`): `/settings` is a hub of rows on a phone (a menu on the left and the section on the right from `md`; `/settings` goes to `/settings/account` there), sections are `/settings/{account,templates,notifications,appearance,analytics}`; `/settings#notifications` redirects. A section screen provides `EmbeddedContext`: `SettingsSection` then leaves out its title (the screen has it; `embeddedTitle="label"` shows it as a small group label). New personal settings go into a section, not into the hub.
- The group page (`features/group/pages/GroupPage.tsx`, owner only) uses the same layout as the personal settings: `shared/sections/SectionsPage` (hub list on a phone, side menu + section from `md`), sections `/group/{general,members,cards,categories,templates,receipts,integrations,broadcast}`, `/group` goes to `/group/general` on a desktop. Heavier sections are lazy.
