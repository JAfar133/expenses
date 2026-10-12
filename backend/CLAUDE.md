# Backend (Fastify + TypeScript + PostgreSQL)

Project context: [../README.md](../README.md), how everything works: [../docs/PIPELINE.md](../docs/PIPELINE.md) (in Russian),
settings and API: [README.md](README.md).

## Commands

```bash
npm run dev         # tsx watch, http://127.0.0.1:3000 (needs PostgreSQL: scripts/start-backend.sh starts it in Docker)
npm test            # Vitest on PGlite: Docker and OneDrive are not needed (live OneDrive tests are skipped)
npm run typecheck   # tsc
npm run build       # dist/ (migrations are copied along)
npm run format      # Prettier
```

Before finishing work: `typecheck`, `test`, `format`.

## Structure

- `src/modules/<name>/` modules by task: `auth`, `groups` (groups, cards, access scope), `expenses`, `sync`, `rates`, `analytics` (aggregates and lists for the analytics page are computed by SQL; values only as parameters, sorting from an allowlist). Inside a module, routes, service, repository and types are separate.
- `src/storage/` the expense repository (PostgreSQL), `src/infrastructure/` the database and migrations, backups, idempotency.
- `src/services/` Excel (reading via ExcelJS, writing by targeted XML editing) and OneDrive (rclone).
- `src/config/env.ts` all environment variables (zod). A new setting goes there, in both `.env.example` files, `docker-compose.yml` and the README.
- Migrations: `src/infrastructure/database/migrations/NNNN_name.sql`, forward-only, do not change applied ones.

## Rules

- **The Excel sync is deprecated (v2) and frozen**: do not add features to it (`modules/sync`, `services/excel*`, `services/onedrive*`); it only serves the first group, can be switched off by the administrator (`SyncSwitch`) and the Excel _report_ (`modules/reports`) is the way to get data into Excel.
- **PostgreSQL is the primary store, Excel is a mirror and is optional** (`ONEDRIVE_FILE_PATH` is empty: `SyncService.enabled === false`).
  Any code that deals with Excel must work when Excel is disabled and when it is unavailable, and must not crash.
- An expense is written to the DB together with the idempotency key in one transaction, then a write to Excel is attempted.
- Editing and deleting in the app change only the database; synchronization brings Excel into line using the **row snapshot** (`excel_snapshot`).
  Any code that changes an entry's values or deletion status must preserve this link (see `reconcile.ts`, `excel/edit.ts`). A write to Excel always goes through
  a backup and a verification of the result before the upload.
- Deleting entries from Excel is a **soft delete** (`deleted_at`), with protection against mass loss. We never erase anything physically.
- All routes except `/api/auth/*` and `/api/health` require login (a hook in `auth.plugin.ts`); a public route is marked with `config: { public: true }`.
- A user's UI settings: `modules/preferences` (the list of keys and allowed values is in `preferences.schema.ts`, and it must match `frontend/src/features/preferences/model/preferences.ts`).
- **Groups (v2).** Every user belongs to one group (`memberships`); an owner sees all cards of the group and edits/deletes records,
  a member sees only cards with a `card_access` row and adds records to cards with level `edit`. **Every query that reads or writes
  expenses on behalf of a user must be limited by `ExpenseScope`** (`modules/groups/scope.ts`, built from `request.user` with `scopeOf`,
  never from request data); a record of another group looks like a missing one (404). Cards are a table (`cards`): the name shown
  in the UI comes from there (`card_id`); the text column `expenses.card` is legacy and is kept for Excel. Inside a transaction pass the
  transaction executor to repository helpers (PGlite has a single connection: a query outside the transaction would wait forever).
  `canEdit` means "owner"; the settings page toggles the role in `memberships`. `ensureDefaultGroup` (start-up) fills the model for an
  installation that predates groups (and adds the categories used by existing records to the group's list); transitional DB triggers fill `group_id`/`card_id` and
  add an unknown category to the list on writes. The categories table is the single list: the API rejects a category that is not in it.
- Account: the name, card, time zone and editing right have defaults from `.env` and a personal choice on top of them (`custom_*`; the editing right is the owner role in the group, `memberships.role`); the effective values are assembled by `EFFECTIVE_USER_COLUMNS` in `auth.repository.ts`. Check rights by `request.user.canEdit`, not by the list from `.env`. Compute "today" by `request.user.timezone`.
- The password from `.env` is applied only if the value in `.env` changed (`users.env_password_hash`); a password set by the user is not overwritten.
- Do not log passwords and tokens or return them in responses; only hashes in the DB. Users' passwords are taken from `AUTH_PASSWORD_<USERNAME>`.
- Errors for the client: `AppError` with a code and a clear Russian message; do not reveal the details of internal errors.
- User-facing texts and comments are in Russian, identifiers are in English.
- The code is clean and structured: small modules, one task per module, wrap long expressions (Prettier).
- Tests: integration tests on top of PGlite (`tests/helpers/create-test-app.ts`, `fake-onedrive.ts`), a separate test for each behavior.
- **Do not run the backend with the real `backend/.env` just to check something**: `dotenv` will pick up `ONEDRIVE_FILE_PATH` and the server will start writing to the real Excel.
  For checks, set `ONEDRIVE_FILE_PATH=` (empty) and separate `DATABASE_URL`, `PORT`, `BACKUP_DIR`.
