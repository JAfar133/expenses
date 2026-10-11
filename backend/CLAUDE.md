# Backend (Fastify + TypeScript + PostgreSQL)

Общий контекст проекта: [../README.md](../README.md), как всё работает: [../docs/PIPELINE.md](../docs/PIPELINE.md),
настройки и API: [README.md](README.md).

## Команды

```bash
npm run dev         # tsx watch, http://127.0.0.1:3000 (нужен PostgreSQL: scripts/start-backend.sh поднимет его в Docker)
npm test            # Vitest на PGlite: Docker и OneDrive не нужны (живые OneDrive-тесты пропускаются)
npm run typecheck   # tsc
npm run build       # dist/ (миграции копируются вместе)
npm run format      # Prettier
```

Перед завершением работы: `typecheck`, `test`, `format`.

## Структура

- `src/modules/<имя>/` модули по задачам: `auth`, `expenses`, `sync`, `rates`, `analytics` (агрегаты и списки для страницы анализа считает SQL; значения только параметрами, сортировка по белому списку). В модуле routes, service, repository, types раздельно.
- `src/storage/` репозиторий расходов (PostgreSQL), `src/infrastructure/` база и миграции, резервные копии, идемпотентность.
- `src/services/` Excel (чтение через ExcelJS, запись точечной правкой XML) и OneDrive (rclone).
- `src/config/env.ts` все переменные окружения (zod). Новая настройка: туда, в оба `.env.example`, `docker-compose.yml` и README.
- Миграции: `src/infrastructure/database/migrations/NNNN_name.sql`, только вперёд, применённые не менять.

## Правила

- **PostgreSQL основное хранилище, Excel зеркало и необязателен** (`ONEDRIVE_FILE_PATH` пуст: `SyncService.enabled === false`).
  Любой код с Excel обязан работать при отключённом и при недоступном Excel и не должен падать.
- Расход пишется в БД вместе с ключом идемпотентности в одной транзакции, потом пробуется запись в Excel.
- Правка и удаление в приложении меняют только базу; Excel приводит в порядок синхронизация по **снимку строки** (`excel_snapshot`).
  Любой код, меняющий значения записи или статус удаления, должен сохранять эту связь (см. `reconcile.ts`, `excel/edit.ts`). Запись в Excel всегда проходит
  резервную копию и проверку результата перед загрузкой.
- Удаление записей из Excel это **мягкое удаление** (`deleted_at`), с защитой от массовой потери. Ничего не стираем физически.
- Все маршруты кроме `/api/auth/*` и `/api/health` требуют входа (хук в `auth.plugin.ts`); публичный маршрут помечается `config: { public: true }`.
- Настройки интерфейса пользователя: `modules/preferences` (список ключей и допустимых значений в `preferences.schema.ts`, он должен совпадать с `frontend/src/features/preferences/model/preferences.ts`).
- Аккаунт: имя, карта, часовой пояс и право правки имеют значения по умолчанию из `.env` и личный выбор поверх них (`custom_*`, `can_edit_override`); эффективные значения собирает `EFFECTIVE_USER_COLUMNS` в `auth.repository.ts`. Права проверять по `request.user.canEdit`, а не по списку из `.env`. «Сегодня» считать по `request.user.timezone`.
- Пароль из `.env` применяется только если значение в `.env` изменилось (`users.env_password_hash`); пароль, заданный пользователем, не перезаписывается.
- Пароли и токены не логировать и не отдавать в ответах; в БД только хеши. Пароли пользователей берутся из `AUTH_PASSWORD_<ЛОГИН>`.
- Ошибки для клиента: `AppError` с кодом и понятным русским сообщением, детали внутренних ошибок не раскрывать.
- Тексты для пользователя и комментарии на русском, идентификаторы на английском.
- Код чистый и структурированный: небольшие модули, одна задача на модуль, длинные выражения переносить (Prettier).
- Тесты: интеграционные поверх PGlite (`tests/helpers/create-test-app.ts`, `fake-onedrive.ts`), на каждое поведение отдельный тест.
- **Не запускать backend с реальным `backend/.env` ради проверки**: `dotenv` подтянет `ONEDRIVE_FILE_PATH` и сервер начнёт писать в настоящий Excel.
  Для проверок задавайте `ONEDRIVE_FILE_PATH=` (пусто) и отдельные `DATABASE_URL`, `PORT`, `BACKUP_DIR`.
