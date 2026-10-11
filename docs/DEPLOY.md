# Развёртывание на сервере (Linux, Docker Compose)

Пошаговый гайд: от чистого сервера до работающего приложения, затем доступ из интернета без домена
и переход на нормальный домен, когда он появится. Здесь только общие значения (`SERVER_IP`, `user`,
`example.com`): репозиторий публичный, свои адреса и пароли в него не записывайте.

- [1. Что запускается и где что лежит](#1-что-запускается-и-где-что-лежит)
- [2. Подготовка сервера](#2-подготовка-сервера)
- [3. Код](#3-код)
- [4. Доступ к OneDrive (rclone)](#4-доступ-к-onedrive-rclone)
- [5. Настройки (`.env`)](#5-настройки-env)
- [6. Первый запуск и проверка](#6-первый-запуск-и-проверка)
- [7. Как открыть приложение](#7-как-открыть-приложение)
- [8. Публичный доступ без домена](#8-публичный-доступ-без-домена)
- [9. Когда появится нормальный домен](#9-когда-появится-нормальный-домен)
- [10. Обслуживание](#10-обслуживание)
- [11. Если что-то не работает](#11-если-что-то-не-работает)
- [12. Безопасность: чек-лист](#12-безопасность-чек-лист)
- [13. Шпаргалка команд](#13-шпаргалка-команд)

> **Важно.** В самом приложении пока нет авторизации (Миша и Настя как отдельные пользователи).
> Поэтому наружу приложение выставляется только под паролем от Caddy (раздел 8), а без него
> доступно лишь на самом сервере (раздел 7). Открывать порты «как есть» нельзя: любой человек смог бы
> добавлять расходы в вашу базу и Excel.

## 1. Что запускается и где что лежит

Четыре контейнера, описанные в `docker-compose.yml`:

| Сервис     | Что это                                              | Доступ                                              |
| ---------- | ---------------------------------------------------- | --------------------------------------------------- |
| `web`      | Caddy: раздаёт интерфейс, проксирует `/api`, HTTPS   | `127.0.0.1:8080` (или 80/443 при публичном доступе) |
| `backend`  | Fastify API, синхронизация, rclone                   | только внутри сети Docker                           |
| `postgres` | PostgreSQL 17, основное хранилище расходов           | `127.0.0.1:5433` (только на сервере)                |
| `pgadmin`  | Веб-интерфейс к базе                                 | `127.0.0.1:5051` (только на сервере)                |

Как работают данные: расход пишется в PostgreSQL, затем в Excel на OneDrive. Если Excel открыт и
заблокирован, запись ждёт в очереди. Подробности: [backend/README.md](../backend/README.md#как-работает-хранение).

### Пути на сервере

| Путь                                    | Что это                                                          | В Git |
| --------------------------------------- | ---------------------------------------------------------------- | ----- |
| `~/projects/expenses` (любая папка)     | Репозиторий. Все команды `docker compose` выполняются здесь      | да    |
| `.env`                                  | Настройки и пароли. Права `600`                                  | нет   |
| `secrets/rclone.conf`                   | Токен доступа к OneDrive. Папка `700`, файл `644`                | нет   |
| `docker-compose.yml`                    | Основной compose-файл                                            | да    |
| `docker-compose.public.yml`             | Дополнение для публичного доступа (HTTPS и пароль)               | да    |
| `infra/Caddyfile`                       | Конфигурация Caddy для локального доступа                        | да    |
| `infra/Caddyfile.public`                | Конфигурация Caddy для публичного доступа                        | да    |
| `infra/pgadmin/servers.json`            | Готовое подключение pgAdmin к базе                               | да    |

### Тома Docker (данные)

Имена начинаются с имени проекта `expenses-tracker`. Физически они лежат в `/var/lib/docker/volumes/<имя>/_data`
(доступ только у root), обращайтесь к ним через Docker.

| Том                              | Содержимое                                                                  |
| -------------------------------- | --------------------------------------------------------------------------- |
| `expenses-tracker_pgdata`        | База PostgreSQL (все расходы)                                               |
| `expenses-tracker_backend-data`  | `/data/rclone/rclone.conf` (рабочая копия с обновляемым токеном) и `/data/backups/` (резервные копии Excel) |
| `expenses-tracker_pgadmin-data`  | Настройки pgAdmin                                                           |
| `expenses-tracker_caddy-data`    | Сертификаты HTTPS                                                           |
| `expenses-tracker_caddy-config`  | Автосохранённая конфигурация Caddy                                          |

Контейнеры называются `expenses-tracker-<сервис>-1` (например, `expenses-tracker-backend-1`).

`docker compose down` тома сохраняет. `docker compose down -v` **удаляет их вместе с базой**.

## 2. Подготовка сервера

Проверено на Debian 13; должно подойти и Debian 12, Ubuntu 22.04/24.04. Нужны 1–2 ГБ памяти и несколько ГБ диска для образов.

```bash
cat /etc/os-release | head -3
free -h && df -h /
```

### 2.1. Docker, compose и buildx

Проверьте, что уже установлено:

```bash
docker --version
docker compose version        # нужна версия 2.x
docker buildx version         # нужна версия 0.17 или новее
```

**Docker не установлен (чистый сервер).** Официальный скрипт:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

> **Не запускайте этот скрипт на сервере, где Docker уже работает** (например, с другими контейнерами,
> VPN и т. п.). Он заменяет установленный Docker и перезапускает демон, а вместе с ним могут
> остановиться ваши контейнеры. В таком случае ставьте только недостающие плагины ниже.

**Docker есть, но нет `compose` или `buildx`.** Плагины ставятся в домашнюю папку и демон не трогают:

```bash
mkdir -p ~/.docker/cli-plugins

# compose
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose

# buildx (версия берётся из GitHub; для arm64 замените amd64 на arm64)
VER=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep -oP '"tag_name": "\K[^"]+')
curl -SL "https://github.com/docker/buildx/releases/download/${VER}/buildx-${VER}.linux-amd64" \
  -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx

docker compose version && docker buildx version
```

Вместо этого можно поставить пакеты дистрибутива (`sudo apt install docker-compose-v2 docker-buildx`), но
версии в них иногда старше требуемых. Если `docker compose up --build` пишет `compose build requires buildx
0.17.0 or later`, нужен именно buildx новее.

### 2.2. Права на Docker

```bash
sudo usermod -aG docker $USER
exit            # зайдите по SSH заново
docker ps       # должно работать без sudo
```

Не запускайте наши команды через `sudo`: файлы, созданные от root (например, `secrets/rclone.conf`),
контейнер потом не сможет прочитать.

### 2.3. Русские буквы в терминале (если видите `^a`, `^}` вместо кириллицы)

Это локаль сервера без UTF-8, а не повреждённый файл. Быстро, на текущую сессию:

```bash
export LANG=C.UTF-8 LC_ALL=C.UTF-8
```

Постоянно (Debian): `sudo apt install locales && sudo dpkg-reconfigure locales`, отметьте `en_US.UTF-8`
и сделайте её системной. Ubuntu: `sudo locale-gen en_US.UTF-8 && sudo update-locale LANG=en_US.UTF-8`.
Перезайдите по SSH. В локали без UTF-8 не сохраняйте файлы в `nano`.

### 2.4. Порты

Занятость портов, которые мы будем использовать:

```bash
ss -ltn | grep -E ':(80|443|8080|5051|5433)\b' || echo "порты свободны"
```

Если порт занят другим проектом, задайте другой в `.env` (`HTTP_PORT`, `PGADMIN_PORT`, `POSTGRES_PORT`).

## 3. Код

Репозиторий публичный, поэтому ключ на сервере не нужен:

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://github.com/JAfar133/expenses.git expenses
cd expenses
```

Если когда-нибудь репозиторий станет приватным, создайте на сервере deploy-ключ:
`ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""`, добавьте `~/.ssh/id_ed25519.pub` в GitHub
(Settings → Deploy keys, только чтение) и клонируйте по `git@github.com:JAfar133/expenses.git`.

## 4. Доступ к OneDrive (rclone)

Контейнер `backend` ходит в OneDrive через rclone. Ему нужен файл `secrets/rclone.conf` с токеном.
Сервер лучше авторизовать отдельно, а не копировать конфиг с другого компьютера: у каждого устройства
должен быть свой токен.

### 4.1. Создать конфигурацию на сервере

rclone на сервер ставить не нужно: запускаем его из Docker.

```bash
mkdir -p secrets && chmod 700 secrets
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD/secrets:/config/rclone" rclone/rclone config
```

В диалоге:
- `n` (новый remote), имя **`onedrive`**, тип `onedrive`;
- `client_id` и `client_secret` пустые, регион `1` (global), advanced config `n`;
- «Use web browser to automatically authenticate?» → **`n`**. rclone покажет команду `rclone authorize "onedrive"`.

**На компьютере с браузером и rclone** (например, Mac) выполните эту команду, войдите в Microsoft и
скопируйте выданную строку с токеном (от `{` до `}`). Вставьте её на сервере в запрос `config_token>`.

Дальше: `config_type` → `1` (OneDrive Personal or Business), выберите свой диск, `y`, `q`.

> Токен даёт доступ ко всему вашему OneDrive. Не пересылайте его, не коммитьте.

### 4.2. Права и проверка

```bash
chmod 644 secrets/rclone.conf       # контейнер (пользователь node) должен прочитать файл
docker run --rm -v "$PWD/secrets:/config/rclone" rclone/rclone lsl "onedrive:Документы/Расходы-dev.xlsx"
```

Должна вывестись строка с размером и датой файла. Ошибка авторизации значит, что токен вставлен неверно:
повторите 4.1.

Как это работает потом: при первом старте контейнер копирует `secrets/rclone.conf` в том
`backend-data` (`/data/rclone/rclone.conf`): rclone сам обновляет в нём токен, и обновлённая копия
переживает перезапуски. Чтобы подставить новый файл, см. раздел 10.7.

## 5. Настройки (`.env`)

```bash
cp .env.example .env
chmod 600 .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
nano .env
```

**Пароль базы задайте до первого запуска.** При первом старте он записывается в саму базу, и потом правка `.env`
его не меняет: сменить позже можно по инструкции из раздела 10.5.

| Переменная              | Что это                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`     | Пароль базы. Случайный, только буквы и цифры (подставляется в URL)                        |
| `PGADMIN_EMAIL`, `PGADMIN_PASSWORD` | Вход в pgAdmin. Пароль замените на свой                                       |
| `ONEDRIVE_FILE_PATH`    | Путь к Excel в OneDrive. **Сначала тестовый файл**, например `Документы/Расходы-dev.xlsx`  |
| `ONEDRIVE_REMOTE`       | Имя remote в rclone (по умолчанию `onedrive`)                                             |
| `APP_TIMEZONE`, `DEFAULT_CURRENCY`, `CARDS`, `CATEGORIES` | Часовой пояс, валюта, карты и категории (необязательно)   |
| `SYNC_INTERVAL_MINUTES`, `SYNC_RETRY_SECONDS` | Как часто синхронизировать (5 мин) и повторять при занятом файле (60 с) |
| `SYNC_MAX_DELETE_PERCENT` | Защита от массовой потери: какую долю записей можно пометить удалёнными за один цикл (25%) |
| `BACKUP_RETENTION_DAYS` | Сколько дней хранить резервные копии Excel (30)                                           |
| `HTTP_PORT`, `HTTPS_PORT`, `PGADMIN_PORT`, `POSTGRES_PORT` | Порты на сервере (8080, 8443, 5051, 5433)              |
| `WEB_BIND`              | Адрес, на котором слушает web. Оставьте `127.0.0.1`                                       |
| `SITE_ADDRESS`, `BASIC_AUTH_USER`, `BASIC_AUTH_HASH`, `COMPOSE_FILE` | Публичный доступ (раздел 8)                  |

Файл `.env` может содержать русские комментарии. Редактируйте его без `sudo`: иначе владельцем станет root
(исправить: `sudo chown $USER:$USER .env`).

## 6. Первый запуск и проверка

```bash
docker compose up -d --build        # первая сборка занимает несколько минут
docker compose ps                   # postgres и backend: healthy, web и pgadmin: Up
docker compose logs --tail 40 backend
```

В логе backend ищите:
- `Database migrations applied`: база создана;
- `rclone rcd started`: rclone запущен;
- `Sync finished` со `status":"ok"` и `imported` больше нуля: Excel прочитан, строки попали в базу.

Если `status` не `ok`, смотрите раздел 11. Если сборка прерывается из-за обрыва SSH, запускайте её в `tmux`
или `nohup docker compose up -d --build > build.log 2>&1 &`.

Проверка на самом сервере:

```bash
curl -s http://127.0.0.1:8080/api/health          # {"status":"ok"}
curl -s http://127.0.0.1:8080/api/sync/status | head -c 300
```

## 7. Как открыть приложение

Порты слушают только `127.0.0.1` сервера, поэтому с вашего компьютера нужен SSH-туннель:

```bash
ssh -N -L 8080:127.0.0.1:8080 -L 5051:127.0.0.1:5051 user@SERVER_IP
```

Пока команда работает, откройте на своём компьютере:
- приложение: http://127.0.0.1:8080
- pgAdmin: http://127.0.0.1:5051 (вход `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`; при подключении к серверу
  «Expenses Tracker» введите `POSTGRES_PASSWORD`).

Если порт 8080 на вашем компьютере занят, замените левую цифру: `-L 18080:127.0.0.1:8080`.

Для доступа с телефона без туннеля нужен публичный доступ (раздел 8) или VPN вроде Tailscale.

## 8. Публичный доступ без домена

Приложение можно открыть из интернета с HTTPS и паролем, не имея домена. Для этого есть
`docker-compose.public.yml`: он публикует порты 80/443 и закрывает весь сайт, включая `/api`,
логином и паролем (Basic Auth в Caddy). pgAdmin и PostgreSQL остаются доступны только на сервере.

**Без домена HTTPS даёт бесплатный адрес из IP сервера:** `1-2-3-4.nip.io` для IP `1.2.3.4` (можно и
`1.2.3.4.sslip.io`). Он всегда указывает на этот IP, а Caddy получает для него настоящий сертификат
Let's Encrypt.

### 8.1. Подготовка

1. Откройте входящие порты **80 и 443** в файрволе провайдера (панель хостинга) и в `ufw`, если он включён.
   Порт 80 нужен для выпуска сертификата, 443 для самого сайта.
2. Убедитесь, что они не заняты: `ss -ltn | grep -E ':(80|443)\b' || echo свободны`.

### 8.2. Пароль для входа

Хеш пароля создаётся интерактивно, пароль в команде не передаётся и в историю не попадает. Запустите в
обычном терминале (нужен TTY):

```bash
docker run --rm -it expenses-tracker-web caddy hash-password
# или с вашего компьютера:
ssh -t user@SERVER_IP 'docker run --rm -it expenses-tracker-web caddy hash-password'
```

Введите пароль и повторите его. Пароль должен быть **длинным и случайным**, например из
`openssl rand -base64 18`; сохраните его в менеджер паролей. Результат: строка вида `$2a$14$...`.
Образ `expenses-tracker-web` появляется после первого `docker compose up --build`.

### 8.3. `.env` и запуск

Допишите в `.env`:

```
SITE_ADDRESS=1-2-3-4.nip.io
BASIC_AUTH_USER=misha
BASIC_AUTH_HASH='$2a$14$...'
COMPOSE_FILE=docker-compose.yml:docker-compose.public.yml
```

**Хеш обязательно в одинарных кавычках:** в нём есть символы `$`. Строка `COMPOSE_FILE` нужна, чтобы обычный
`docker compose up -d` подключал оба файла.

```bash
docker compose config --quiet && echo "конфигурация OK"
docker compose up -d                        # пересоздастся только web
docker compose logs web | grep -iE "certificate obtained|error"
```

Через несколько секунд в логе должно появиться `certificate obtained successfully`.

### 8.4. Проверка

```bash
curl -sI https://1-2-3-4.nip.io/ | head -1                      # HTTP/2 401 (без пароля)
curl -sI -u misha:ВАШ_ПАРОЛЬ https://1-2-3-4.nip.io/ | head -1   # HTTP/2 200
curl -sI http://1-2-3-4.nip.io/ | head -1                       # 308: редирект на HTTPS
```

Откройте https://1-2-3-4.nip.io в браузере: он попросит логин и пароль. Манифест и иконки приложения
отдаются без пароля (иначе на iPhone не установится значок), всё остальное закрыто.

### 8.5. Сменить пароль

1. Создайте новый хеш (8.2).
2. В `.env` замените строку `BASIC_AUTH_HASH`, не меняя остальные (хеш в одинарных кавычках).
3. `docker compose up -d`. Старый пароль перестаёт работать сразу. Если браузер помнит старый, закройте вкладку.

### 8.6. Ограничения этого режима

- Один общий пароль, без ограничения числа попыток: пароль должен быть длинным и случайным.
- Раздельных пользователей (Миша, Настя) пока нет: они появятся вместе с авторизацией в самом приложении.
- Если выбрать простой HTTP (`SITE_ADDRESS=:80`), пароль уходит по сети открытым текстом. Это хуже, используйте
  только временно.
- `ufw` не защищает порты, опубликованные Docker: Docker сам правит iptables. Поэтому наружу публикуются
  только `web` (80/443); остальное привязано к `127.0.0.1`.

## 9. Когда появится нормальный домен

Домен даёт красивый адрес, а на iPhone позволяет установить приложение на главный экран (PWA) с нормальным
сертификатом. Переезд делается правкой одной переменной, данные не затрагиваются.

### 9.1. DNS

1. У регистратора домена (или в DNS-хостинге) создайте **A-запись**: `expenses.example.com` → `SERVER_IP`.
   Если у сервера есть IPv6 и вы им пользуетесь, добавьте и AAAA-запись. TTL поставьте небольшой (300 с).
2. Дождитесь, пока имя начнёт разрешаться, и проверьте с нескольких серверов:

```bash
dig +short expenses.example.com @1.1.1.1
dig +short expenses.example.com @8.8.8.8      # оба должны вернуть SERVER_IP
```

**Не запускайте следующий шаг, пока DNS не отвечает.** Если сертификат не получается (имя ещё не указывает
на сервер), Caddy повторяет попытки, а Let's Encrypt ограничивает число неудачных проверок в час.

> Бесплатные поддомены (например, на duckdns.org) работают так же: создайте имя и укажите IP сервера.
> Если домен проксируется через CDN (оранжевое облако Cloudflare), для первого выпуска сертификата лучше
> выключить проксирование (режим «только DNS»).

### 9.2. Переключить сайт на домен

В `.env` на сервере:

```
SITE_ADDRESS=expenses.example.com
```

Для плавного перехода можно временно оставить оба адреса через запятую; Caddy обслужит оба и получит
сертификаты для каждого:

```
SITE_ADDRESS=expenses.example.com, 1-2-3-4.nip.io
```

> Эту запись (адреса через запятую) я не проверял на сервере. Перед запуском проверьте конфигурацию:
> `docker compose run --rm --no-deps web caddy validate --config /etc/caddy/Caddyfile`. Если проверка не
> проходит, используйте один адрес.

Затем:

```bash
docker compose up -d                        # пересоздаётся только web
docker compose logs web | grep -iE "certificate obtained|error"
curl -sI https://expenses.example.com/ | head -1       # HTTP/2 401 без пароля
```

Откройте https://expenses.example.com в браузере, войдите и проверьте, что форма и значок синхронизации работают.

### 9.3. После переезда

- Старый адрес `nip.io` перестаёт обслуживаться, когда вы уберёте его из `SITE_ADDRESS`. Выпущенный для него
  сертификат остаётся в томе `caddy-data` и никому не мешает.
- **iPhone:** удалите значок, установленный со старого адреса, откройте новый адрес в Safari и добавьте на
  главный экран заново («Поделиться» → «На экран Домой»). Иконка, название и пароль берутся с нового адреса.
  Сохраните пароль в связке ключей Safari.
- Сохранённые пароли и закладки в браузере привязаны к адресу: обновите их.
- Откатиться можно так же: верните прежний `SITE_ADDRESS` и сделайте `docker compose up -d`.
- Если сменится IP сервера, достаточно изменить A-запись домена: сертификат привязан к имени, а не к IP.

### 9.4. Что улучшить, когда домен заработал

- **HSTS.** Сейчас в `infra/Caddyfile.public` стоит `Strict-Transport-Security "max-age=604800"` (неделя). Когда убедитесь, что
  HTTPS работает стабильно, увеличьте срок до года (`31536000`): браузеры будут обращаться к сайту только по HTTPS.
  Не делайте этого заранее: при проблемах с сертификатом сайт будет недоступен весь срок.
- **Авторизация в приложении.** Когда в приложении появится собственный вход (Миша и Настя), пароль Caddy можно
  будет убрать. Это потребует нового варианта `docker-compose.public.yml` без `basic_auth`; пока пользуйтесь текущим.
- **По IP сайт не откроется.** Caddy обслуживает только адреса из `SITE_ADDRESS`, а для голого IP у него нет
  сертификата: пользуйтесь доменом.

## 10. Обслуживание

### 10.1. Обновление приложения

```bash
cd ~/projects/expenses
git pull
docker compose up -d --build
docker compose ps
```

Данные в томах сохраняются. Миграции базы применяются при старте backend автоматически.

### 10.2. Логи и состояние

```bash
docker compose ps
docker compose logs --tail 100 backend
docker compose logs -f web
docker compose logs backend | grep -iE "sync (finished|cycle failed)"
docker stats --no-stream
```

### 10.3. Резервная копия базы

```bash
mkdir -p ~/backups
docker compose exec -T postgres pg_dump -U expenses --clean --if-exists expenses | gzip > ~/backups/expenses-$(date +%F).sql.gz
```

Ежедневно в 03:00 с удалением копий старше 14 дней (`crontab -e`; в crontab символ `%` экранируется):

```
0 3 * * * cd ~/projects/expenses && docker compose exec -T postgres pg_dump -U expenses --clean --if-exists expenses | gzip > ~/backups/expenses-$(date +\%F).sql.gz && find ~/backups -name 'expenses-*.sql.gz' -mtime +14 -delete
```

Копии храните не только на этом же сервере: периодически забирайте их на другой компьютер (`scp`/`rsync`).

**Восстановление базы:**

```bash
docker compose stop backend
gunzip -c ~/backups/expenses-2026-10-10.sql.gz | docker compose exec -T postgres psql -U expenses -d expenses
docker compose start backend
```

После восстановления первая синхронизация сверит Excel с базой.

### 10.4. Резервные копии Excel

Перед каждым изменением Excel приложение сохраняет копию скачанного файла в `/data/backups` в томе
`backend-data` (`YYYY-MM-DD/expenses-ЧЧ-ММ-СС-xxxxxx.xlsx`), хранятся `BACKUP_RETENTION_DAYS` дней.

```bash
docker compose cp backend:/data/backups ./excel-backups      # скопировать на хост
find ./excel-backups -name '*.xlsx' | sort | tail
```

**Вернуть Excel из копии** (закройте файл в Excel везде: пока он открыт, OneDrive не принимает запись):

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD/secrets:/config/rclone" -v "$PWD/excel-backups:/backups:ro" \
  rclone/rclone copyto /backups/2026-10-10/expenses-20-15-32-a1b2c3.xlsx "onedrive:Документы/Расходы-dev.xlsx"
```

Сначала лучше скачать текущий файл как ещё одну копию. Записи, добавленные после момента копии, останутся в базе
и следующая синхронизация пометит их **удалёнными** (мягкое удаление, из базы они не пропадают). Если пропало много записей
сразу, сработает защита: они останутся активными, а значок станет жёлтым. Вернуть такие записи в Excel можно через SQL
(раздел «Удалённые записи» ниже).

> Скрипт `scripts/restore-backup.sh` рассчитан на запуск с обычным rclone (например, на Mac) и читает `backend/.env`.
> На сервере используйте команду выше. Команды 10.3 и 10.4 на реальном сервере не проверялись: попробуйте
> сначала на тестовом файле.

### 10.4a. Удалённые записи (мягкое удаление)

Строка, удалённая или изменённая в Excel, при синхронизации помечается в базе удалённой (`deleted_at`), но не стирается.
Вернувшаяся в Excel строка восстанавливает запись. Подробности и защиту от массовых потерь описывает
[backend/README.md](../backend/README.md#удаление-и-правка-строк-в-excel-мягкое-удаление). Посмотреть и вернуть записи
можно в pgAdmin или `psql`:

```bash
docker compose exec postgres psql -U expenses -d expenses -c \
  "SELECT date, card, category, name, amount, deleted_at FROM expenses WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC;"
```

Если защита заблокировала удаление (значок жёлтый: «пропало N записей сразу»), проверьте Excel. Если удаление
намеренное, подтвердите его (при публичном доступе добавьте `-u логин:пароль` и свой адрес):

```bash
curl -X POST http://127.0.0.1:8080/api/sync -H 'content-type: application/json' -d '{"applyDeletions": true}'
```

### 10.5. Сменить пароль PostgreSQL

Пароль базы при первом создании тома записывается в сам Postgres, поэтому правка `.env` пароль не меняет.
Порядок такой: сначала поменять в базе, потом в `.env`.

```bash
NEWPASS=$(openssl rand -hex 24)
docker compose exec -T postgres psql -U expenses -d expenses -c "ALTER USER expenses PASSWORD '$NEWPASS';"
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEWPASS/" .env
docker compose up -d                  # пересоздадутся postgres и backend
docker compose logs --tail 20 backend
```

В pgAdmin при следующем подключении введите новый пароль. Эту процедуру на реальном сервере я не проверял.

### 10.6. Перейти с тестового файла Excel на рабочий

1. Сделайте вручную копию рабочего Excel в OneDrive (запасной вариант).
2. Если вы тестировали на dev-файле и тестовые записи не нужны, начните с чистой базы: `docker compose down -v`.
   Это удалит **всё**, включая базу, резервные копии Excel и сохранённый токен rclone в томе (токен потом
   восстановится из `secrets/rclone.conf`).
3. В `.env` задайте `ONEDRIVE_FILE_PATH=Документы/Расходы.xlsx` и выполните `docker compose up -d`.
4. Первая синхронизация подтянет все строки рабочего файла в базу. Проверьте число в логе (`imported`).

### 10.7. Токен OneDrive устарел или нужен новый `rclone.conf`

Признаки: значок синхронизации красный, в логе `AUTH_FAILED` или `invalid_grant`.

```bash
docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD/secrets:/config/rclone" rclone/rclone config   # переавторизация, раздел 4.1
chmod 644 secrets/rclone.conf
docker compose exec backend rm /data/rclone/rclone.conf       # удалить рабочую копию в томе
docker compose restart backend                                 # скопируется новая из secrets/
```

### 10.8. Освободить место

```bash
docker image prune -f              # неиспользуемые образы
docker system df                   # сколько занимают образы и тома
```

Тома не удаляйте: `docker volume prune` и `down -v` стирают данные.

### 10.9. Остановить или удалить

```bash
docker compose down                # остановить, данные сохраняются
docker compose down -v             # остановить и УДАЛИТЬ данные (база, копии, сертификаты)
```

## 11. Если что-то не работает

| Симптом | Причина и решение |
| --- | --- |
| `docker: 'compose' is not a docker command` | Нет плагина compose: раздел 2.1 |
| `permission denied ... docker.sock` | Пользователь не в группе `docker`: раздел 2.2 |
| `compose build requires buildx 0.17.0 or later` | Нет buildx нужной версии: раздел 2.1 |
| `docker compose up` ругается на переменную | Не задана обязательная переменная в `.env` (`POSTGRES_PASSWORD`, `PGADMIN_PASSWORD`, `ONEDRIVE_FILE_PATH`; для публичного доступа `SITE_ADDRESS`, `BASIC_AUTH_USER`, `BASIC_AUTH_HASH`) |
| `^a`, `^}` вместо русских букв | Локаль без UTF-8: раздел 2.3 |
| Порт занят | Другой проект: задайте другой порт в `.env` (раздел 2.4) |
| backend: «Не найден rclone.conf» | Нет `secrets/rclone.conf` или нет прав на чтение: `chmod 644`. Если в томе уже старая копия: раздел 10.7 |
| В логе `Sync finished` и `status":"error"` | Смотрите `errorCode`: `AUTH_FAILED` токен (10.7), `FILE_NOT_FOUND` неверный `ONEDRIVE_FILE_PATH`, остальное в `docker compose logs backend` |
| Значок синхронизации жёлтый | Файл открыт в Excel или OneDrive недоступен. Закройте Excel, очередь допишется сама (раз в минуту) |
| Значок красный | Ошибка синхронизации или потеряна связь с backend: причина в подсказке значка (наведите курсор) и в логе. После неудачного нажатия значок краснеет на 8 секунд и возвращается к норме сам |
| Сайт открывается по IP/туннелю, но не по `nip.io` | Возможно, DNS вашей сети: проверьте `dig +short 1-2-3-4.nip.io @1.1.1.1`. Если публичный DNS отвечает верно, а ваш нет, смените DNS на `1.1.1.1`/`8.8.8.8` или перейдите на `sslip.io` или свой домен |
| Нет сертификата (`certificate obtained` не появляется) | Закрыты порты 80/443 у провайдера, имя не указывает на сервер, или превышен лимит Let's Encrypt. Проверьте порты (8.1) и DNS, смотрите `docker compose logs web` |
| 401 при верном пароле | Хеш в `.env` без одинарных кавычек или обрезан. Создайте заново (8.2), проверьте, что строка целая |
| После смены пароля сайт просит старый | Браузер помнит старые данные: закройте вкладку и откройте заново |
| Не открывается pgAdmin | Он слушает только `127.0.0.1:5051` на сервере: нужен SSH-туннель (раздел 7). Первый запуск pgAdmin занимает около минуты |
| Нужно «начать с нуля» | `docker compose down -v` и запуск заново (удаляет все данные) |

## 12. Безопасность: чек-лист

- [ ] `.env` не открыт для других пользователей: `chmod 600 .env`.
- [ ] `POSTGRES_PASSWORD` случайный и не равен значению по умолчанию из `.env.example` (10.5).
- [ ] `PGADMIN_PASSWORD` свой, не `admin`.
- [ ] `secrets/rclone.conf` не в Git и не пересылается: токен даёт доступ ко всему OneDrive.
- [ ] Наружу открыты только 80/443 и только под паролем; `WEB_BIND` остаётся `127.0.0.1`.
- [ ] Пароль входа на сайт длинный и случайный, лежит в менеджере паролей.
- [ ] Резервные копии базы и Excel регулярно копируются с сервера.
- [ ] Репозиторий на GitHub публичный: в нём не должно быть паролей, токенов и ваших данных.
      Кроме примеров из `.env.example` (`expenses`, `admin`), которые нужно заменять на сервере.
- [ ] Docker и система обновляются (`sudo apt update && sudo apt upgrade`). Не запускайте на сервере с чужими
      контейнерами скрипты, заменяющие Docker.

## 13. Шпаргалка команд

Все команды выполняются в папке проекта на сервере (`~/projects/expenses`).

```bash
docker compose ps                                    # состояние
docker compose logs -f backend                       # логи backend
docker compose up -d                                 # применить изменения .env
git pull && docker compose up -d --build             # обновить приложение
docker compose restart backend                       # перезапустить backend
docker compose down                                  # остановить (данные сохраняются)

curl -s http://127.0.0.1:8080/api/health             # живой ли backend
curl -s http://127.0.0.1:8080/api/sync/status        # состояние синхронизации

docker compose exec -T postgres pg_dump -U expenses --clean --if-exists expenses | gzip > ~/backups/expenses-$(date +%F).sql.gz
docker compose exec postgres psql -U expenses -d expenses -c 'select count(*) from expenses;'

ssh -N -L 8080:127.0.0.1:8080 -L 5051:127.0.0.1:5051 user@SERVER_IP    # туннель (с вашего компьютера)
```

## Что проверено

Раздел 2 (Debian 13 с чужими контейнерами Docker), 3, 4, 5, 6, 7 и 8 (публичный доступ через `nip.io`, выпуск сертификата
Let's Encrypt, проверка 401 без пароля, смена пароля) выполнены на реальном сервере. Ещё не проверялись на реальном сервере:
раздел 9 (переезд на свой домен), 10.3 (cron и восстановление базы), 10.4 (возврат Excel командой rclone),
10.5 (смена пароля PostgreSQL) и 10.6.
