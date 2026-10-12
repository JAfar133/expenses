# Frontend

React + TypeScript + Vite + Tailwind CSS. An expense entry form designed for iPhone
(fields from 48 px, safe area, dark theme, a numeric keyboard for the amount).

## Running

Needs a running [backend](../backend/README.md).

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

In development mode, `/api/*` requests are proxied to `http://127.0.0.1:3000` (see `vite.config.ts`).

### Checking on an iPhone

```bash
npm run dev -- --host
```

On the phone, open `http://<your-Mac-IP>:5173` (the devices must be on the same Wi-Fi network). For
proxying to work, the backend must run on the same Mac. Installing to the home screen (PWA) requires
HTTPS, so it can only be fully checked after deployment to a server.

## Build

```bash
npm run build      # output in dist/
npm run preview
```

`dist/` contains static files. In production they are served by Caddy/Nginx, which also proxies `/api` to the backend.

## Commands

| Command             | Action                           |
| ------------------- | -------------------------------- |
| `npm run dev`       | Development server               |
| `npm run build`     | Type check and build             |
| `npm test`          | Tests (Vitest + Testing Library) |
| `npm run typecheck` | Type check                       |
| `npm run format`    | Prettier formatting              |

## Login

The app opens with a login form (`src/features/auth/`): username and password, the fields are prepared for Safari and iOS password managers
(`autocomplete="username"` and `"current-password"`, no auto-capitalization).

- Tokens are stored in HttpOnly cookies; JavaScript cannot see or store them. The page only knows who is logged in (the `GET /api/auth/me` request).
- **Seamless refresh.** If the server answers any request with 401 (the 24-hour access token expired), the client calls `POST /api/auth/refresh` once
  and repeats the request. Several requests that got 401 at the same time wait for one shared refresh. If the refresh token is also invalid (a week
  passed without use, 30 days since the password was entered, the password was changed), the login form is shown.
- A network failure during a refresh does not throw the user out: the login form is shown only when the server refuses.
- At the top of the page: "Вы вошли как Миша" ("You are logged in as Misha") and the "Выйти" ("Log out") button. On logout (and when the user changes), the previous user's data is removed from the cache.
- Login errors: wrong username or password, "too many attempts" (with how many minutes to wait before retrying), no connection to the server.

## Form behavior

- The date defaults to today (local, without a UTC shift).
- The default card is the logged-in user's card (Misha → "Миша", Nastya → "Настя"); it can be changed manually, and the last selected card is not remembered.
- The last category is remembered in `localStorage` separately for each user.
- The amount is entered with spaces between thousands: `25 890`, and the number `25890` is sent to the server.
- The button is disabled while the request is in flight.
- An `Idempotency-Key` is added to every attempt. When resubmitting after an error, the key is the same;
  after a success, a new one is created. The backend does not allow a duplicate to be created for a key.
- After a success, the name and amount are cleared; the date, card and category stay.
- If Excel is unavailable (the file is open), the expense is still saved: the form says "Расход сохранён. В Excel он
  появится позже" ("The expense is saved. It will appear in Excel later") and clears as usual.
- If no server response is received, the form asks you to check whether the expense was added before sending again.

## Sync icon

On the right of the header there is the Excel-and-database sync icon (`src/features/sync/`): an icon and a countdown to the
next run, for example `4:34`. The timer follows the server's clock, not the device's.

- Tapping it starts a synchronization immediately and restarts the timer. While it runs, the icon spins and `…` replaces the timer.
- A **yellow** icon: the file is open in Excel or OneDrive is unavailable, there are entries in the queue (the number on the icon),
  or a mass deletion is blocked (too many entries disappeared from Excel).
- A **red** icon: a synchronization error, the synchronization could not be started (for 8 seconds), or there is no connection to the server.
- Details (the reason, the queue size) are in the tooltip on hover and in the description for screen readers.

The state is refreshed by polling `GET /api/sync/status` every 5 seconds (2 seconds while a synchronization is running).

## Analytics

Amounts on the analytics pages can be shown in another currency (selected with flags above the page, converted at the current Central Bank rate on the client, the choice is stored in the settings). The "Анализ" ("Analytics") section (`/analytics`) contains the "Обзор" ("Overview") and "Сравнение месяцев" ("Month comparison") tabs, a shared filter panel (all values are in the address bar) and a period selector (a date range in a single field for "Свой", i.e. "Custom"). The overview shows: spend per day, a chart by day, and the categories with the biggest spending
(bars, columns, a ring or a pie; the view is remembered). The data is calculated by the backend (`/api/analytics/*`). The page loads as a separate
chunk, so the expense form stays light. To run the development mode against a different backend, set `API_TARGET`
(default `http://127.0.0.1:3000`): `API_TARGET=http://127.0.0.1:3100 npm run dev`.

## Groups and administration

- `/invite/:token` is a public page (no sign-in): joining a group by an invitation link or setting a new password by a reset link. On success the server signs the person in.
- `/group` (link "Группа", only for a group owner): group name, members (role, password reset link, removal), invitations (the link is shown once, with a copy button), cards with per-member access, categories.
- `/admin` (link "Админ", only for an application admin): all groups (owner link, disable/enable, create a group) and password reset links by login.
- `/admin` also has the "Синхронизация с Excel" switch (`GET/PUT /api/admin/sync`, with a confirmation): while it is off the header sync icon is not rendered at all and `/api/sync/status` is no longer polled; switching it refetches the status.
- The UI of a regular member (role `member`) is unchanged: these links and pages are not rendered for them.

- The "Операции" tab has a "Скачать Excel" icon button: it downloads `/api/expenses/export.xlsx` for exactly the current filters, period and display currency (`downloadFile` in `shared/api/http.ts`: cookie auth, refresh on 401, file name from `Content-Disposition`).

- `/admin` starts with the "Бэкап базы" block (`GET /api/admin/backup`, read-only status of the nightly dump); the "Админ" link in the header gets a small red dot when the backup is `stale` or `failed` (requested only for application admins, no polling).

- A member sees "Изменить"/"Удалить" only on their own records that the server marks `editable` (window set by the owner on `/group`, "Правка своих трат участниками"); the tooltip shows the deadline. Nothing else changes for a member.

- Limits (budgets): `GET /api/budgets` feeds the progress bars (`features/budgets`, shown under the add form and at the top of the analysis "Обзор" tab; nothing is rendered when the group has no limits). The owner manages them in the "Лимиты" section of `/group` (amount, period kind, optional day of month).

## Structure

```
src/
  app/               root component, routes (React Router), shared frame and providers
  pages/             pages
  features/expenses/ form, API requests, hooks, validation schema
  features/auth/     login: the login form, access gate, logout button
  features/group/    owner page (members, invitations, cards, categories) and the invitation page
  features/admin/    application admin page (groups, password reset)
  features/sync/     sync icon: timer, launch, queue state
  features/analytics/ analytics page: tiles, charts (Recharts), the "spent this month" block
  shared/            HTTP client, UI components, utilities
public/              manifest.webmanifest and icons
tests/
```
