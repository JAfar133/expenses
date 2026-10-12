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

- `src/features/<name>/` by function: `auth`, `expenses`, `sync`, `analytics` (the analytics page: charts on Recharts, colors and palette in `index.css`), `group` (owner page `/group`: members, invitations, cards with access, categories; and the public invitation page `/invite/:token`, outside `AuthGate`), `admin` (application admin page `/admin`: groups, password reset links). Inside: `api/`, `hooks/`, `components/`, `schemas/`.
- User settings (chart views, etc.) are stored on the server: `features/preferences` (described in `model/preferences.ts`, the `usePreference` hook). The settings page `features/settings` is assembled from blocks.
- `src/pages/` pages, `src/app/` the app root, routes (React Router) and the shared `AppShell` frame. The analytics page is loaded lazily.
- `src/shared/` shared code: `api/http.ts` (requests), `ui/` (Button, Field, Notice), `utils/`.
- Server data goes through TanStack Query, forms through React Hook Form + zod.

## Rules

- **The UI of a regular user (role `member`) stays exactly as it was.** New things are visible only to an owner (link "Группа") and to an application admin (link "Админ"); for others they are not rendered at all (pages also redirect to `/`). Roles are managed only on the group page.

- All API requests go through `apiRequest` from `shared/api/http.ts`: it refreshes the login itself using the refresh token on a 401
  (one retry) and reports a lost session. Do not use `fetch` directly.
- Tokens are stored in HttpOnly cookies and are not in JS or `localStorage`. `localStorage` holds only conveniences (for example, the user's last category).
- The default card is always the logged-in user's card (`user.card`); the last selected card is not remembered.
- Excel on the server is optional: if `GET /api/sync/status` returned `enabled: false`, the sync icon is not shown and the status is not polled (also when an admin switched sync off on `/admin`; the switch invalidates the status query).
- Works on a phone (PWA): fields no smaller than 16px, large controls, take the light and dark themes into account.
- UI texts are in Russian, identifiers are in English.
- The code is clean and structured: small components, one task per module, wrap long expressions (Prettier).
- Tests live nearby by meaning in `tests/`; mock `fetch`, query elements by role and accessible name.
