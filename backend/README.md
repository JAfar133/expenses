# Backend

Node.js + TypeScript + Fastify + PostgreSQL. Expenses are stored in PostgreSQL, while the existing
`Операции` ("Operations") table in Excel on OneDrive is kept as a mirror: the app writes to both places, and every
few minutes it compares Excel with the database and pulls in rows that were added to Excel by hand.

## Requirements

- Node.js 22+
- PostgreSQL 16+ (started locally via `docker compose`, see the root README)
- [rclone](https://rclone.org/) with a remote configured for a personal OneDrive

## Setting up rclone

```bash
rclone config                 # create a remote of type onedrive (personal), name: onedrive
rclone lsl "onedrive:Документы/Расходы-dev.xlsx"   # check access to the file
```

The rclone configuration file contains OAuth tokens: do not add it to Git.

## Running

The easiest way is from the repository root: `./scripts/start-all.sh` (it starts PostgreSQL in Docker by itself).
Backend only:

```bash
npm install
cp .env.example .env
docker compose -f ../docker-compose.yml up -d --wait postgres   # PostgreSQL on 127.0.0.1:5433
npm run dev        # restarts on changes
```

On startup the backend waits for the database, applies migrations, starts synchronization with Excel and listens on
`HOST:PORT` (by default `127.0.0.1:3000`). Production build: `npm run build && npm run start:prod`.

## Environment variables

| Variable                       | Default                         | Description                                                                                                          |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                     | `development`                   | Environment                                                                                                          |
| `HOST`, `PORT`                 | `127.0.0.1`, `3000`             | Server address                                                                                                       |
| `DATABASE_URL`                 | **required**                    | PostgreSQL connection, for example `postgres://expenses:…@127.0.0.1:5433/expenses`                                   |
| `DEFAULT_CURRENCY`             | `AMD`                           | Base currency: bookkeeping and Excel use it                                                                          |
| `CURRENCIES`                   | `AMD,RUB,USD,EUR`               | Currencies in which expenses can be entered                                                                          |
| `EXCHANGE_RATES_URL`           | `https://cb.am/latest.json.php` | Rate source (Central Bank of Armenia, drams per unit of currency)                                                    |
| `EXCHANGE_RATES_REFRESH_HOURS` | `6`                             | How often to refresh the rates                                                                                       |
| `APP_TIMEZONE`                 | `Asia/Yerevan`                  | Time zone for backup names                                                                                           |
| `EXCEL_SHEET_NAME`             | `Лист1`                         | Sheet with the table                                                                                                 |
| `EXCEL_TABLE_NAME`             | `Операции`                      | Excel structured table                                                                                               |
| `ONEDRIVE_REMOTE`              | `onedrive`                      | rclone remote name                                                                                                   |
| `ONEDRIVE_FILE_PATH`           | not set (Excel disabled)        | Path to the file in OneDrive, for example `Документы/Расходы-dev.xlsx`                                               |
| `RCLONE_CONFIG`                | default rclone path             | Path to `rclone.conf`                                                                                                |
| `RCLONE_MODE`                  | `daemon`                        | `daemon` is a persistent rclone process (fast), `cli` starts rclone for every command                                |
| `RCLONE_TIMEOUT_MS`            | `120000`                        | Timeout of a single rclone operation                                                                                 |
| `SYNC_INTERVAL_MINUTES`        | `5`                             | How often to synchronize Excel and the database                                                                      |
| `SYNC_RETRY_SECONDS`           | `60`                            | Retry interval while entries cannot be appended to Excel (file is open)                                              |
| `SYNC_INLINE_WAIT_SECONDS`     | `15`                            | How long to wait for the Excel write before responding to an expense creation                                        |
| `SYNC_MAX_DELETE_PERCENT`      | `25`                            | Safeguard: what share of entries may be marked deleted in one cycle                                                  |
| `AUTH_USERS`                   | `misha:Миша,nastya:Настя`       | Users: `username:default card`. Username: lowercase Latin letters, digits, `_`                                       |
| `AUTH_PASSWORD_<USERNAME>`     | not set                         | The user's password (`AUTH_PASSWORD_MISHA`, `AUTH_PASSWORD_NASTYA`), at least `AUTH_MIN_PASSWORD_LENGTH`             |
| `EDITOR_USERS`                 | `misha`                         | Who may edit and delete entries **by default**; after that the editors change rights themselves on the settings page |
| `ADMIN_USERS`                  | empty                           | Application administrators (v2: manage groups)                                                                       |
| `DEFAULT_GROUP_NAME`           | `Семья`                         | Name of the group created for the existing users on the first start (v2)                                             |
| `AUTH_MIN_PASSWORD_LENGTH`     | `8`                             | Minimum password length (less than 8 is not allowed)                                                                 |
| `ACCESS_TOKEN_TTL_HOURS`       | `24`                            | Access token lifetime (the login cookie)                                                                             |
| `REFRESH_TOKEN_TTL_DAYS`       | `7`                             | Refresh token lifetime; extended on every refresh                                                                    |
| `SESSION_MAX_DAYS`             | `30`                            | Upper limit of a session's life since the password was entered                                                       |
| `TRUST_PROXY`                  | `false`                         | Behind Caddy: real IP and protocol from `X-Forwarded-*` (`true` in compose)                                          |
| `ALLOWED_ORIGINS`              | empty                           | Additional allowed site addresses (Origin), comma-separated                                                          |
| `BACKUP_DIR`                   | `./backups`                     | Excel backup folder                                                                                                  |
| `BACKUP_RETENTION_DAYS`        | `30`                            | How many days to keep backups and idempotency keys                                                                   |
| `CARDS`                        | `Миша,Настя`                    | Comma-separated list of cards                                                                                        |
| `CATEGORIES`                   | `кафе,одежда,продукты,…`        | Initial categories; values from the database are added to them                                                       |

**Excel is optional.** There is deliberately no default for `ONEDRIVE_FILE_PATH`: this way the app will not write data to the
working file by accident. For development use `Расходы-dev.xlsx`.

- Variable not set or empty: working with Excel is disabled. Expenses are stored in the database only, rclone is not started,
  and there is no synchronization or sync icon in the UI. Entries added in this mode stay in the queue:
  if you later set `ONEDRIVE_FILE_PATH`, they are appended to Excel on their own.
- Variable set, but the file does not exist or OneDrive is unavailable: the app does not crash, expenses are saved in the database and wait in the queue,
  and synchronization shows the reason (`FILE_NOT_FOUND`, `AUTH_FAILED`, etc.) and retries on schedule.

## How storage works

```
 form ──POST──▶  PostgreSQL  ──queue──▶  Excel (OneDrive)
                     ▲                          │
                     └────── synchronization ◀──┘   (rows added to Excel by hand)
```

1. **The expense is saved to PostgreSQL** (together with the idempotency key, in one transaction) with the
   status `pending`. From this moment it cannot be lost.
2. **We immediately try to write it to Excel.** If that works, the status becomes `synced` and the response has `excelStatus: "synced"`.
3. **If Excel is unavailable** (the file is open in Excel on another device, no network, OneDrive does not respond),
   the expense stays in the queue and the response comes right away: `201` with `excelStatus: "queued"`. The queue
   is appended to Excel automatically as soon as the file is free (a retry every `SYNC_RETRY_SECONDS`).
4. **Every `SYNC_INTERVAL_MINUTES` and on the button in the UI**, synchronization runs (see below).

Statuses of the Excel write (`expenses.excel_status`): `pending` means waiting in the queue, `writing` means the write
has started and the result is not yet confirmed, `synced` means the row is in Excel.

Reading Excel is not blocked by an open file, so rows added by hand are pulled into the database
even when the Excel write is deferred.

## PostgreSQL ↔ Excel synchronization

One cycle (`src/modules/sync/`):

1. A fresh Excel file is downloaded.
2. **Import.** The table rows are compared with the database. New rows (added to Excel by hand) are put into the database
   with the source `excel`.
3. **Writing the queue.** `pending` entries are appended to Excel in a single pass: backup → edit →
   verification → upload.

How "new" rows are determined: Excel rows have no identifiers, so identical operations
are matched **by count**. Two identical expenses (for example, two coffees in a day) remain two
entries and are not merged. If Excel has more rows than the database, the extra ones are imported.

### Deleting and editing rows in Excel (soft delete)

If a row was **deleted or changed** in Excel, the corresponding database entry is **marked as deleted**
(`deleted_at`) but not erased. Editing a row is "the old version is deleted" plus "a new one is added",
so in the database the old version is marked deleted and the new one appears as an active entry.

- Deleted entries do not appear in lists and categories, but stay in the database and can be restored.
- If a row **comes back** to Excel (an undo of the deletion, a rollback of the file from a backup), the entry is restored rather than
  created anew, so there will be no duplicates.
- Queued entries (`pending`) cannot be deleted: they are not in Excel yet.
- Identical expenses are interchangeable: if one of two identical rows was deleted, the newest of the two
  entries is marked deleted.
- Sorting rows in Excel changes nothing: matching is by content, not by row number.

**Protection against mass loss.** If too many entries disappear in one cycle (Excel replaced with an empty
file, a rollback to an old copy, a corrupted file), they are **not** marked deleted, and the synchronization result
contains the warning `MASS_DELETION_BLOCKED` (the icon in the UI turns yellow, the reason is in the tooltip). The threshold:

- fewer than 5 entries at a time are deleted without a check;
- no more than `SYNC_MAX_DELETE_PERCENT` percent (25 by default) of active entries;
- if Excel has no rows at all but the database has some, any number of deletions is blocked.

If the deletion is really intended (you deliberately deleted many rows), confirm it:

```bash
# requires login (see the "Signing in to the app" section) and an Origin header with the site address
curl -s -b cookies.txt -X POST http://127.0.0.1:3000/api/sync -H 'Origin: http://127.0.0.1:3000' \
  -H 'content-type: application/json' -d '{"applyDeletions": true}'
```

(`cookies.txt` holds the login cookies: see the login example below; with public access, use the site address instead of `127.0.0.1:3000`). The confirmation
applies once, to the next cycle and only to users with the editing right (others get `403`).

**Workbook safety checks.** The structure of the table is checked before anything is read or changed:

- the table must span `A:E`, have the expected headers and no totals row, otherwise the cycle stops with
  `TABLE_UNSUPPORTED` and the database is not touched;
- if a new row would land on cells that already hold data right below the table, nothing is uploaded
  (`TABLE_BLOCKED`), and the entries stay in the queue until the space is freed;
- while the table has rows that cannot be read (for example the cost became text), entries are **not** marked
  deleted (warning `UNREADABLE_ROWS`): fix the rows in the file and the deletions are applied.

### View deleted entries and restore them

In pgAdmin or `psql`:

```sql
-- deleted entries (newest first)
SELECT id, date, card, category, name, amount, deleted_at
FROM expenses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;

-- restore an entry and append it to Excel on the next synchronization
UPDATE expenses
SET deleted_at = NULL, deleted_reason = NULL, excel_status = 'pending'
WHERE id = '<entry id>';
```

After Excel is restored from an old copy, entries added after it will be marked deleted. Return them to the
file like this: first make sure from the list above that these are the entries you need (look at `deleted_at`), then run the
`UPDATE` above for them (you can use the condition `deleted_at > '<time>'` and `deleted_reason = 'excel'`).

Rows with invalid data (a date as text, a fractional or zero amount, empty fields) are skipped and
listed in `skippedRows` of the synchronization result.

Reliability:

- Only one cycle runs at a time. Requests that arrive during a cycle are merged into a single next one.
- If the file was changed during the write, the cycle is repeated automatically (once).
- Before uploading, entries are marked `writing`. If the upload response is lost, the next comparison against the
  Excel content determines whether the entry made it, and does not create a duplicate.
- If a backup could not be made, Excel is not changed and the entries stay in the queue.

## API

Prefix `/api`, JSON format.

| Method and path                   | Purpose                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                 | Liveness check, does not touch OneDrive or the database. Public (like `/api/ready` and `/api/auth/login`, `/refresh`, `/logout`)             |
| `GET /api/ready`                  | Readiness check: `SELECT 1` against the database, `503` if it does not answer. `deploy.sh` waits for it                                      |
| `POST /api/auth/login`            | Login: `{"username","password"}`, sets cookies, returns the user and their default card                                                      |
| `POST /api/auth/refresh`          | Refreshes the tokens using the refresh cookie (called by the app itself)                                                                     |
| `POST /api/auth/logout`           | Logout: ends the session, clears the cookies                                                                                                 |
| `GET /api/auth/me`                | Who is logged in                                                                                                                             |
| `GET /api/config`                 | Currency                                                                                                                                     |
| `GET /api/cards`                  | List of cards                                                                                                                                |
| `GET /api/rates`                  | Base currency, available currencies and rates to the dram (Central Bank of Armenia, with the last known rate as a fallback)                  |
| `GET /api/name-suggestions`       | Names by category, most frequent first (for hints in the form)                                                                               |
| `GET /api/categories`             | Categories: configuration + values from the database (including those imported from Excel)                                                   |
| `POST /api/expenses`              | Add an expense (the `Idempotency-Key` header is required)                                                                                    |
| `GET /api/sync/status`            | Queue, last synchronization result, time of the next run                                                                                     |
| `POST /api/sync`                  | Run synchronization now (if one is already running, joins it). The optional body `{"applyDeletions": true}` confirms a blocked mass deletion |
| `GET /api/preferences`            | UI settings of the current user (chart views, filter panel, etc.)                                                                            |
| `PUT /api/preferences`            | Change the settings (only the given keys; the allowed keys and values are predefined, anything else is `422`)                                |
| `PATCH /api/auth/profile`         | Personal account settings: name, default card, time zone (`null` restores the default value); the username cannot be changed                 |
| `GET /api/users`                  | Users and their rights (editors only)                                                                                                        |
| `PUT /api/users/:username/rights` | Grant or revoke the right to edit and delete: `{canEdit}`; editors only, the last editor cannot be stripped of the right                     |
| `POST /api/auth/password`         | Change your own password: `{currentPassword, newPassword}`; the user's other sessions are closed                                             |
| `PATCH /api/expenses/:id`         | Correct an entry (date, card, category, name, amount in drams); editors only                                                                 |
| `DELETE /api/expenses/:id`        | Delete an entry (softly, it can be restored); editors only                                                                                   |
| `POST /api/expenses/:id/restore`  | Restore a deleted entry; editors only                                                                                                        |

All routes other than those listed above require login (otherwise `401 UNAUTHENTICATED`), and state-changing requests (POST) also require the
`Origin` header with the site address (the browser adds it by itself). An example with a script:

```bash
SITE=http://127.0.0.1:3000
curl -s -c cookies.txt -X POST $SITE/api/auth/login -H "Origin: $SITE" -H 'content-type: application/json' \
  -d '{"username":"misha","password":"YOUR_PASSWORD"}'
curl -s -b cookies.txt -X POST $SITE/api/expenses -H "Origin: $SITE" -H 'content-type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"date":"2026-10-10","card":"Миша","category":"кафе","name":"Кофе","amount":1650}'
```

Success is `201` (on a repeat with the same key, `200` and the previous result):

```json
{
  "success": true,
  "data": {
    "id": "…",
    "date": "2026-10-10",
    "card": "Миша",
    "category": "кафе",
    "name": "Кофе",
    "amount": 1650,
    "excelStatus": "synced"
  },
  "message": "Расход успешно добавлен"
}
```

(The `message` text is the literal Russian string returned by the API: "Expense added successfully".)

`excelStatus`: `synced` means the expense is already in Excel; `queued` means it is saved in the database and waiting to be written to Excel; `disabled` means working with Excel is disabled.

**Another currency.** Add `"currency":"USD"` and an amount with decimals (`"amount":10.5`); the rate is taken from the reference data, or set your own:
`"rate":380.5` (drams per unit of currency). `amount` in the response is always in drams, and the original amount and rate are in `original`
(`{"amount":10.5,"currency":"USD","rate":380}`; `null` for an expense in drams). If there is no rate and none is given, the result is `422 RATE_UNAVAILABLE`.

**An empty currency means the base one.** If an entry has no `original_currency` (entered in drams or imported from Excel), its currency is considered the base one (`DEFAULT_CURRENCY`, AMD): this is how the currency filter, the `breakdown?by=currency` breakdown and the `currency` field in `GET /api/expenses` see it.

`GET /api/sync/status` and `POST /api/sync` return the state:

```json
{
  "success": true,
  "data": {
    "queued": 0,
    "running": false,
    "intervalMs": 300000,
    "nextRunAt": "2026-10-10T19:05:00.000Z",
    "serverTime": "2026-10-10T19:00:28.120Z",
    "lastResult": {
      "status": "ok",
      "imported": 3,
      "written": 1,
      "queued": 0,
      "deleted": 0,
      "restored": 0,
      "deletionsBlocked": 0,
      "skipped": 0,
      "finishedAt": "…"
    }
  }
}
```

`serverTime` is needed so that the timer in the UI follows the server's clock. Synchronization status (`lastResult.status`):
`ok`, `locked` (the file is open in Excel), `unavailable` (OneDrive is unavailable), `error`.

Errors: `{ "success": false, "error": { "code": "…", "message": "…" } }`

| Status | Code                                                                                 | When                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`                                                                        | Malformed JSON                                                                                                          |
| 401    | `UNAUTHENTICATED`                                                                    | Not logged in or the login expired (the app refreshes the login itself using the refresh token and repeats the request) |
| 401    | `INVALID_CREDENTIALS`                                                                | Wrong username or password (the same response for a wrong password and an unknown username)                             |
| 429    | `TOO_MANY_ATTEMPTS`                                                                  | Too many failed logins; the `Retry-After` header tells in how many seconds to retry                                     |
| 403    | `FORBIDDEN_ORIGIN`                                                                   | A state-changing request came from an address other than the site (CSRF protection)                                     |
| 400    | `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`                                | The `Idempotency-Key` header is missing or has a wrong format                                                           |
| 422    | `INVALID_DATE`, `INVALID_CARD`, `INVALID_CATEGORY`, `INVALID_NAME`, `INVALID_AMOUNT` | Validation error                                                                                                        |
| 422    | `IDEMPOTENCY_KEY_REUSED`                                                             | The key was already used for a different expense                                                                        |
| 503    | `DATABASE_UNAVAILABLE`                                                               | PostgreSQL is unavailable; the expense is not saved, you can retry                                                      |
| 500    | `INTERNAL_ERROR`                                                                     | Internal error                                                                                                          |

An unavailable Excel is **not** an error: the expense is saved, and the response contains `excelStatus: "queued"`.
Every response contains the `X-Request-Id` header: the same `requestId` appears in all lines of the request's log.

## Groups, cards and invitations (v2)

Every user belongs to exactly one **group**. An **owner** sees every card of the group and is the only one who edits and
deletes records; a **member** sees only the cards they were given (`view` or `edit` = may add records). A card that is not given
is hidden everywhere (form, list, charts, totals, suggestions). The cards, categories and the access are managed by the owner;
groups are created by the **application administrator** (`ADMIN_USERS`), who sees only the structure of groups, never their expenses.

New people join by a **one-time link** (valid 7 days, only its hash is stored): the owner creates it, the invited person
chooses their login, name and password on `/invite/<token>` and is signed in. The same kind of link resets a forgotten password.
Users listed in `AUTH_USERS` keep working as before and cannot be removed from the app.

All routes below need login (the owner or the administrator), except the invitation ones.

| Method and path                                                      | Purpose                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/group`                                                     | The owner's group: members, cards with access, categories, pending invitations                           |
| `PATCH /api/group`                                                   | Rename the group                                                                                         |
| `POST /api/group/cards`, `PATCH /api/group/cards/:id`                | Add, rename or archive a card (`409 NAME_TAKEN` for a duplicate name)                                    |
| `PUT /api/group/cards/:id/access`                                    | `{"access": {"<login>": "view" \| "edit"}}`: replaces the access of the members (not listed = no access) |
| `POST /api/group/categories`, `PATCH /api/group/categories/:id`      | Add, rename (records are renamed too) or archive a category                                              |
| `POST /api/group/invitations`                                        | `{"role": "member" \| "owner"}`: returns `{token, expiresAt}` once                                       |
| `DELETE /api/group/invitations/:id`                                  | Revoke a pending invitation                                                                              |
| `PUT /api/group/members/:login/role`                                 | Give or take the owner role (the last owner stays)                                                       |
| `POST /api/group/members/:login/reset-password`                      | A link for the member to set a new password                                                              |
| `DELETE /api/group/members/:login`                                   | Remove a member (not yourself, not users from `AUTH_USERS`); their records stay                          |
| `GET /api/admin/groups`, `POST /api/admin/groups`                    | Administrator: list groups, create a group (returns the first owner's link)                              |
| `PATCH /api/admin/groups/:id`                                        | `{"disabled": true \| false}`: a disabled group's members see nothing                                    |
| `POST /api/admin/groups/:id/owner-invitations`                       | A new link for an owner                                                                                  |
| `POST /api/admin/users/:login/reset-password`                        | A password reset link for any user                                                                       |
| `GET /api/invitations/:token`, `POST /api/invitations/:token/accept` | Public: what the link is for; create the account (or set the password) and sign in                       |

## Signing in to the app

The users `misha` and `nastya` (the list is `AUTH_USERS`) log in with a username and password. Passwords are taken from `.env` (`AUTH_PASSWORD_<USERNAME>`): on every
backend start they are hashed (**scrypt**, N=2^15, built into Node) and only the hash is stored in the database. If you change a password in `.env` and restart,
the hash is updated and all of that user's logins end. An unchanged password touches nothing.

**Default card.** A user has a card (`misha:Миша` → "Миша"). It is returned by `login` and `me`, and the expense form selects it by default.

**Tokens (24 hours and 7 days).**

| Token   | Cookie       | Lifetime                                                                      | Path        |
| ------- | ------------ | ----------------------------------------------------------------------------- | ----------- |
| access  | `et_access`  | 24 hours                                                                      | `/api`      |
| refresh | `et_refresh` | 7 days, extended on refresh (no longer than 30 days after the password entry) | `/api/auth` |

- Both tokens are random (256 bits) and stored in HttpOnly cookies with `SameSite=Lax` (`Secure` over HTTPS), unavailable to page scripts. Only the SHA-256 of
  the token is stored on the server (the `auth_sessions` table). Tokens do not appear in responses or logs.
- When the access token expires, the app gets a new one using the refresh token, and the password is not requested. Each refresh token is good **only once**
  (rotation). If the previous token is presented more than 15 seconds after a refresh, it looks like theft: the whole session is closed. Within 15 seconds
  (two tabs refreshing at the same time) it counts as an ordinary race.
- There is one session per device. "Log out" ends only that session.

**Protection.**

- **Password guessing:** 5 wrong attempts in 15 minutes for a "username + IP" pair (and 20 from one IP) result in `429` with `Retry-After`. For an unknown username the response
  time is the same as for a wrong password, and so is the response.
- **CSRF:** all state-changing requests (including login) are accepted only with an `Origin` (or `Referer`) of the site's own address; other sites are rejected (`403`).
  Behind a proxy the address is taken from `X-Forwarded-Host` (`TRUST_PROXY=true`); additional addresses can be allowed in `ALLOWED_ORIGINS`.
- **`Secure` cookies:** set when the request came over HTTPS (behind Caddy it is detected from `X-Forwarded-Proto`).
- Expense data and logs are tied to the user's username (`created_by`, the `userId` field in the log), idempotency keys to the user's identifier.
- Disabled users (removed from `AUTH_USERS`) cannot log in, and their sessions end.

## Duplicate protection (Idempotency-Key)

`POST /api/expenses` requires the `Idempotency-Key` header (a UUID). The key and the expense are saved in one
PostgreSQL transaction, so there is no "unknown" state: either both are saved or neither.

| Situation                                                            | Result                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| New key                                                              | Expense created, `201`                                 |
| Same key and same data                                               | `200`, the previous result (same `id`), no new expense |
| Concurrent requests with the same key                                | The expense is created once, the others get its result |
| Same key with different data                                         | `422 IDEMPOTENCY_KEY_REUSED`                           |
| The request did not arrive or the response was lost (`503`, network) | Retry with the same key: it is safe                    |

Keys older than `BACKUP_RETENTION_DAYS` days are deleted.

## rclone modes and speed

Every rclone run against OneDrive makes about six sequential HTTP requests, so
a single command takes 4-5 seconds. That is why by default the backend keeps one persistent
`rclone rcd` process (`RCLONE_MODE=daemon`), which reuses connections:

| Mode     | Downloading or uploading a file (measured, Armenia → OneDrive) |
| -------- | -------------------------------------------------------------- |
| `daemon` | 1-3 seconds                                                    |
| `cli`    | 5-9 seconds                                                    |

How the `daemon` mode works:

- the backend starts `rclone rcd` itself and terminates it on shutdown;
- the process listens only on `127.0.0.1` on a random port, the login and password are generated on every
  start and passed through environment variables (not visible in the process list);
- if the process died, the next request starts it again;
- if the backend is killed hard (`kill -9`), `rclone rcd` may keep running until a reboot;
  to find and stop it: `pkill -f "rclone rcd"`;
- if a request ended with a timeout, the operation inside rclone may still run to completion. The result
  of such an upload is considered "unknown", and the entries stay in the `writing` status until the comparison
  determines whether they reached Excel.

## Backups

Before every change to Excel, the downloaded file is saved to `BACKUP_DIR`:

```
backups/2026-10-10/expenses-20-15-32-a1b2c3.xlsx    # date and time follow APP_TIMEZONE
```

- a copy is made only when something is appended to Excel (one copy per cycle, not per expense);
- copies are accessible only to the owner (folders `0700`, files `0600`) and are not served by the web server;
- on startup and once a day, copies older than `BACKUP_RETENTION_DAYS` days are deleted;
- copies live on the same disk as the backend. For safety, periodically copy the `backups/`
  folder somewhere else. The expenses themselves are also in PostgreSQL; back it up separately
  (`pg_dump`).

### Restoring Excel from a backup

```bash
./scripts/restore-backup.sh --list                      # which backups exist
./scripts/restore-backup.sh backend/backups/2026-10-10/expenses-20-15-32-a1b2c3.xlsx
```

The script checks that the copy is a complete Excel workbook, asks for confirmation (`yes`), saves the current
version to `backups/before-restore/`, uploads the copy to OneDrive and verifies the hash. Close the
file in Excel before running it, otherwise OneDrive will refuse the write.

**Important: restoring and the database.** Entries added after the moment of the backup will stay in PostgreSQL but
disappear from Excel. The next synchronization will mark them deleted (soft delete; if too many entries
disappeared, the safeguard kicks in and they stay active, while the icon turns yellow). The data is not lost, and you can return
it to Excel, see "View deleted entries and restore them".

The file also has OneDrive version history (Excel or the web interface → "Version History").

## Logs

JSON logs to stdout. Each operation gets a line with a `requestId`, a result and a duration:

```json
{"requestId":"fa412ab2","operation":"expense.create","userId":"local","durationMs":3277,"result":"success","replayed":false,"excelStatus":"synced","msg":"Operation completed"}
{"operation":"sync","status":"ok","imported":0,"written":1,"queued":0,"deleted":0,"restored":0,"deletionsBlocked":0,"skipped":0,"msg":"Sync finished"}
```

Expense data (name, amount), passwords and tokens do not get into the log; the `Authorization`
and `Cookie` headers are hidden.

## Structure

```
src/
  app.ts, server.ts           Fastify assembly and startup
  config/env.ts               environment variables
  modules/expenses/           routes, validation schema, business logic
  modules/auth/               login: passwords (scrypt), tokens, sessions, route protection and CSRF, attempt limiting
  modules/sync/               synchronization cycle, reconciliation (reconcile), scheduler, routes
  storage/postgres/           expense repository (SQL)
  services/excel/             XLSX editing and reading
  services/onedrive/          rclone clients (daemon and CLI), error codes
  infrastructure/             PostgreSQL and migrations, backups, idempotency, locks
  errors/                     errors with HTTP statuses
tests/{unit,integration,helpers,fixtures}
```

Migrations are the files `src/infrastructure/database/migrations/*.sql`, applied on startup.

## Tests

```bash
npm test                         # without reaching OneDrive, without Docker
npm run typecheck
RUN_ONEDRIVE_TESTS=1 npm test    # + live tests with a real OneDrive (both rclone modes, about 1.5 minutes)
```

PostgreSQL tests run on PGlite, which is a real PostgreSQL compiled to WASM, so Docker is not
needed. The `pg` driver is tested separately over the network protocol (`tests/integration/postgres-driver.test.ts`).

The live tests work with a separate file `Документы/expenses-tracker-test.xlsx` and delete it at the end;
working files are not affected.

The integration tests need a copy of your Excel file: `tests/fixtures/expenses-dev.xlsx`.
The file contains your data and is excluded from Git, so after cloning download it yourself:

```bash
mkdir -p tests/fixtures
rclone copyto "onedrive:Документы/Расходы-dev.xlsx" tests/fixtures/expenses-dev.xlsx
```

## Why not ExcelJS for writing

When re-saving, ExcelJS loses charts and dynamic arrays from the file, so writing is done by
targeted XML editing (`src/services/excel/`): only the sheet and the table change, and the other parts of the workbook
stay untouched. ExcelJS is used only for reading and verifying the result.

## Editing and deleting entries

Editors (`EDITOR_USERS`) can correct and delete entries on the "Операции" ("Operations") tab. Changes are carried over to Excel right away.

- **Excel row snapshot.** Each entry stores in `excel_snapshot` what its row looks like in Excel right now. Reconciliation matches Excel rows
  precisely by the snapshot, so an edit in the app does not look like "the old one deleted plus a new one added" and does not create a duplicate.
- **What to do with Excel is derived from the state:** no snapshot and the entry is active means append; a snapshot that differs from the values means replace the row;
  the entry is deleted and a snapshot exists means remove the row. If the file is busy, the change waits in the queue and is applied by the next synchronization.
- **Entry state** (`excelState` in the operations list): `synced` (identical to Excel), `pending-add`, `pending-update`, `pending-remove` (waiting in the queue),
  `removed`, `missing` (deleted; the row is not in Excel).
- **Write safety.** A backup is made before uploading, the file is edited by cell values only (styles and the other parts of the workbook are not touched),
  then it is re-read and compared against the expected content of the whole table. On a mismatch the file is not uploaded (`VERIFICATION_FAILED`).
- **Deleting a row** shifts the values below it up, like "Delete table row"; if there are unreadable rows below, the row being deleted is only cleared.
- **The journal** `expense_changes`: who changed what and when (values before and after).
- An entry that is being written to Excel at that moment cannot be edited (`409 EXPENSE_BUSY`), and a deleted one cannot be edited (`409 EXPENSE_DELETED`).
- If a row was changed directly in Excel while the edit was waiting, the entry is marked deleted because of Excel, and the new row is imported as an entry from Excel.

## Passwords: .env and changing in the app

A user's password can be changed on the "Настройки" ("Settings") page. So that the password from `.env` does not overwrite the one chosen by the user on every start,
the database (`users.env_password_hash`) remembers the hash of the last applied password from `.env`:

- the value in `.env` did not change: the password the user set themselves stays;
- the value in `.env` was changed (including being set back to the previous one): the administrator resets the password, `.env` wins, and the user's logins are closed.

Changing a password verifies the current password and counts toward brute-force protection (5 wrong attempts in 15 minutes block both login and password change).
UI settings (`users.preferences`) are stored on the server, so the choice is the same on all of a user's devices.

## Personal account settings

The name, default card, time zone and editing right can be changed in the app (the username cannot). The values from the configuration (`AUTH_USERS`, `APP_TIMEZONE`, `EDITOR_USERS`)
remain **defaults** and are updated on every start, while a user's personal choice is stored separately (`custom_*`, `can_edit_override`) and overrides them.
If the personal choice is reset (`null`), the value from the configuration applies again.

- **Time zone** is personal: it determines "today" in the analysis (spend per day, charts by day) and in the expense form. `APP_TIMEZONE` sets the default zone.
- **Rights.** Only editors can change rights; the last editor cannot be stripped of the right (`409 LAST_EDITOR`).
