# Expenses Tracker

A web app for tracking shared expenses. Entries are added through a form and stored in
**PostgreSQL**, while the existing Excel file on a personal OneDrive is kept as a mirror: the app writes
to both stores, queues an entry if Excel is unavailable, and every few minutes (or on a button press)
pulls rows that were added to Excel by hand into the database. **Excel is optional**: if no file path is
set, the app works with the database only.

The detailed deployment, pipeline and planning guides live in `docs/` and are written in Russian.

| Folder / file                  | What is inside                                           |
| ------------------------------ | -------------------------------------------------------- |
| [`backend/`](backend)          | Fastify API, PostgreSQL, Excel synchronization, OneDrive |
| [`frontend/`](frontend)        | React expense form and sync panel (PWA)                  |
| `docker-compose.yml`, `infra/` | PostgreSQL, pgAdmin, backend and web (Caddy) in Docker   |
| `scripts/`                     | Scripts for starting the app and restoring from a backup |

## Status

> v2 (branch `v2`): groups, cards in different currencies, an Excel report instead of the sync (the sync is deprecated and can be switched off). The spec is in [docs/V2_SPEC.md](docs/V2_SPEC.md) (in Russian).

MVP v0.1, work in progress. Done: writing to PostgreSQL and Excel, a queue for when Excel is open, synchronization
on a timer and on a button, OneDrive via rclone, the form, duplicate protection, backups, Docker Compose.
Login with a username and password (users Misha and Nastya, a session valid for a day and refreshed for up to a week) is also done. History of operations (with editing and deleting) and analytics are done as well.

A short overview of how it all works (login, recording an expense, synchronization, deployment): [docs/PIPELINE.md](docs/PIPELINE.md) (in Russian).

## Quick start for development (Mac)

You need Node.js 22+, Docker Desktop and a configured rclone with an `onedrive` remote (see [backend/README.md](backend/README.md)).

```bash
./scripts/start-all.sh        # PostgreSQL + backend + frontend, stop with Ctrl+C
```

Open http://127.0.0.1:5173. The frontend proxies `/api` to the backend (`http://127.0.0.1:3000`) on its own.

**Login.** The app opens with a login form: the username is `misha` or `nastya`. On first run the script creates development passwords itself, shows them
and saves them to `backend/.env` (`AUTH_PASSWORD_MISHA`, `AUTH_PASSWORD_NASTYA`); you can replace them with your own (at least 8 characters) and restart the backend.
After login, the form selects the user's card by default.

If needed, the script installs dependencies, creates `backend/.env` from `.env.example`, starts
PostgreSQL in Docker (port **5433**, so it does not clash with your other databases on 5432), and checks that rclone sees
the file in OneDrive and that the ports are free. Backend and frontend logs go to one terminal with prefixes.

| Script                      | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `scripts/start-all.sh`      | Starts PostgreSQL, backend and frontend                |
| `scripts/start-backend.sh`  | PostgreSQL and backend only                            |
| `scripts/start-frontend.sh` | Frontend only                                          |
| `scripts/restore-backup.sh` | Restores Excel from a backup (`--list` shows the list) |
| `scripts/deploy.sh`         | On the server: updates the code and restarts the app   |

To open the app from a phone on the same Wi-Fi network, pass `--host`:
`./scripts/start-all.sh --host`, then open `http://<your-Mac-IP>:5173`.

If the script does not run ("permission denied"): `chmod +x scripts/*.sh`.

## Running in Docker Compose

Brings everything up at once: PostgreSQL, pgAdmin, backend and web (Caddy serves the UI and proxies `/api`).

> A full step-by-step server guide (preparation, rclone, `.env`, access without a domain, moving to a domain, backups,
> maintenance, troubleshooting): **[docs/DEPLOY.md](docs/DEPLOY.md)** (in Russian). A short version follows.

```bash
cp .env.example .env                 # set the database, pgAdmin and user passwords (openssl rand -base64 18) and the Excel path
mkdir -p secrets && chmod 700 secrets
cp ~/.config/rclone/rclone.conf secrets/rclone.conf && chmod 644 secrets/rclone.conf
#   without Excel: touch secrets/rclone.conf (an empty file) and do not set ONEDRIVE_FILE_PATH in .env
docker compose up -d --build
```

| Service    | Address                        | Notes                                                                                                                                                                                       |
| ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App        | http://127.0.0.1:8080          | Port `HTTP_PORT`                                                                                                                                                                            |
| pgAdmin    | http://127.0.0.1:5051          | Login: `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`. On first open, enter the database password (`POSTGRES_PASSWORD`). The "Expenses Tracker" connection is already configured. Port `PGADMIN_PORT` |
| PostgreSQL | 127.0.0.1:5433                 | Port `POSTGRES_PORT`, not exposed externally                                                                                                                                                |
| backend    | inside the Docker network only | Not published on a separate port                                                                                                                                                            |

Things worth knowing:

- All ports listen on `127.0.0.1` only (`WEB_BIND=0.0.0.0` only together with the public mode below).
  The app requires a login (see `AUTH_USERS`), but set strong passwords before exposing it. pgAdmin gives full access to the database: change its password in `.env`.
- The rclone configuration is copied into the `backend-data` volume on first start: OneDrive tokens are refreshed
  inside the volume. To supply a new `rclone.conf`, delete `rclone/rclone.conf` in that volume.
- Data lives in volumes: `pgdata` (the database), `backend-data` (rclone and backups), `pgadmin-data`.
  `docker compose down` keeps them, `docker compose down -v` **deletes them along with the database**.
- Containers restart on their own (`restart: unless-stopped`), including after a server reboot.
- Only the database and pgAdmin for development: `docker compose up -d --wait postgres pgadmin`.
- HTTPS: set a domain in `SITE_ADDRESS` (for example, `expenses.example.com`), and Caddy obtains a certificate itself.
  This needs ports 80/443 open and DNS, and strong passwords in `AUTH_USERS`.
- If a port is taken by another project, set a different one in `.env` (`HTTP_PORT`, `PGADMIN_PORT`, `POSTGRES_PORT`).

## Public access without a domain

By default all ports listen on `127.0.0.1` only. If you need to open the app to the internet, include `docker-compose.public.yml`: it opens
ports 80/443 and enables HTTPS. The site is protected by **the login in the app itself** (users' username and password); there is no separate Caddy password on the site.
PostgreSQL stays reachable only on the server's localhost, and pgAdmin is opened at a separate address through the same Caddy under a Caddy password.

You do not need a domain: use a free address built from the server IP with dashes, for example `1-2-3-4.nip.io` (or `1.2.3.4.sslip.io`). Caddy obtains a
Let's Encrypt certificate for it by itself; for that, ports 80 and 443 must be open in the provider's firewall and not used by other services.

```bash
# 1. Caddy password hash for pgAdmin (the password is typed at the prompt and does not stay in the command history); long and random: openssl rand -base64 18
docker run --rm -it expenses-tracker-web caddy hash-password

# 2. In .env (the hash MUST be in single quotes, it contains $ characters):
#    AUTH_PASSWORD_MISHA=...  AUTH_PASSWORD_NASTYA=...                  # app login passwords, at least 8 characters
#    SITE_ADDRESS=1-2-3-4.nip.io
#    PGADMIN_ADDRESS=pgadmin.1-2-3-4.nip.io
#    PGADMIN_BASIC_AUTH_USER=admin
#    PGADMIN_BASIC_AUTH_HASH='$2a$14$...'
#    COMPOSE_FILE=docker-compose.yml:docker-compose.public.yml     # so a plain `docker compose up -d` picks up both files

# 3. Start
docker compose up -d
docker compose logs web | grep -iE "certificate|obtained|error"
```

Login: you enter the password once, and then the app stays open: the access token is valid for 24 hours and refreshes itself using the refresh token for up to 7 days
(no longer than 30 days after the password was entered). Details about tokens, brute-force protection and changing a password: [backend/README.md](backend/README.md#signing-in-to-the-app),
[docs/DEPLOY.md](docs/DEPLOY.md#51-пользователи-и-пароли) (in Russian).

pgAdmin: HTTPS, the Caddy password (Basic Auth), then login to pgAdmin itself. To view entries, it is better to connect as a read-only database user: see
[docs/DEPLOY.md](docs/DEPLOY.md#87-pgadmin-из-интернета-чтобы-смотреть-записи) (in Russian). If you need plain HTTP without a certificate, set `SITE_ADDRESS=:80`,
but then the password is sent over the network in clear text at login.

## What synchronization does

Details and a diagram are in [backend/README.md](backend/README.md#how-storage-works).

- An expense is saved to PostgreSQL and immediately tried in Excel. If the file is open in Excel (on any
  device), the expense waits in the queue and is appended on its own once the file is free.
- Every 5 minutes and on the "Синхронизировать" ("Sync") button, new rows from Excel are brought into the database. Identical
  expenses are not merged.
- Deleting and editing rows in Excel are carried over to the database as a **soft delete**: the entry is marked as deleted but not erased, and
  it can be restored. If too many entries disappear at once (for example, Excel was replaced with an empty file), the deletion is not applied,
  and the sync icon shows a warning.

## Tests

```bash
cd backend  && npm test
cd frontend && npm test
```

## MVP limitations

- OneDrive access is needed to write to Excel; while it is unavailable, expenses accumulate in the queue.
- Users are defined by a list in the settings (Misha and Nastya), there is no registration. Passwords are stored in `.env` in clear text, only hashes are in the database.
- There is no offline mode.
