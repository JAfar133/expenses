# Frontend (React 19 + Vite + Tailwind 4)

Общий контекст проекта: [../README.md](../README.md), как всё работает: [../docs/PIPELINE.md](../docs/PIPELINE.md),
подробности: [README.md](README.md).

## Команды

```bash
npm run dev         # Vite, http://127.0.0.1:5173, /api проксируется на backend (127.0.0.1:3000)
npm test            # Vitest + Testing Library (fetch мокается, backend не нужен)
npm run typecheck   # tsc
npm run build       # tsc + vite build
npm run format      # Prettier
```

Перед завершением работы: `typecheck`, `test`, `format`.

## Структура

- `src/features/<имя>/` по функциям: `auth`, `expenses`, `sync`, `analytics` (страница анализа: графики на Recharts, цвета и палитра в `index.css`). Внутри `api/`, `hooks/`, `components/`, `schemas/`.
- Настройки пользователя (виды графиков и т.п.) хранятся на сервере: `features/preferences` (описание в `model/preferences.ts`, хук `usePreference`). Страница настроек `features/settings` собрана из блоков.
- `src/pages/` страницы, `src/app/` корень приложения, маршруты (React Router) и общая рамка `AppShell`. Страница анализа грузится лениво.
- `src/shared/` общее: `api/http.ts` (запросы), `ui/` (Button, Field, Notice), `utils/`.
- Данные с сервера через TanStack Query, формы через React Hook Form + zod.

## Правила

- Все запросы к API идут через `apiRequest` из `shared/api/http.ts`: он сам обновляет вход по refresh-токену при 401
  (один повтор) и сообщает о потере сессии. `fetch` напрямую не использовать.
- Токены лежат в HttpOnly-куках, в JS и `localStorage` их нет. В `localStorage` только удобства (например, последняя категория пользователя).
- Карта по умолчанию всегда карта вошедшего пользователя (`user.card`), последняя выбранная карта не запоминается.
- Excel на сервере необязателен: если `GET /api/sync/status` вернул `enabled: false`, значок синхронизации не показывается.
- Работает на телефоне (PWA): поля не меньше 16px, крупные элементы управления, учитывать светлую и тёмную темы.
- Тексты интерфейса на русском, идентификаторы на английском.
- Код чистый и структурированный: небольшие компоненты, одна задача на модуль, длинные выражения переносить (Prettier).
- Тесты рядом по смыслу в `tests/`; мокайте `fetch`, обращайтесь к элементам по роли и доступному имени.
