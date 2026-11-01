# Sonora

Музыкальный стриминг-сервис: веб (PWA), Android, бэкенд, рекомендации и «Моя волна», админка.
Главный экран — бесконечная персональная волна; плеер с Canvas и пословными текстами;
качество до Hi-Res Lossless.

> Статус: **сайт с полноценным управлением.** Готовы API (авторизация, каталог, стриминг, поиск),
> загрузка и обработка музыки (media-worker, CLI, загрузка прямо из браузера), веб-клиент в стиле
> liquid glass (главная из блоков, альбом, артист, плейлист, жанры, поиск, синхронные тексты,
> фон под обложку и в такт музыке) и админка `/admin`. План — в [ROADMAP.md](ROADMAP.md).

## Быстрый старт (≈5 минут)

Нужны Docker, [uv](https://docs.astral.sh/uv/) и Node 22 + pnpm.

```bash
cp .env.example .env
# задайте SONORA_JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(48))"

make up            # Postgres+pgvector, Redis, SeaweedFS (S3), ClickHouse, Meilisearch + бакеты
make api-dev       # миграции + API на http://localhost:8000 (Swagger: /docs)
make worker-dev    # media-worker (нужен ffmpeg)
pnpm install && pnpm -r run build
```

Или всё в контейнерах: `docker compose -f infra/docker-compose.yml --env-file .env up -d`.

Проверить, что всё живо:

```bash
curl localhost:8000/readyz
curl -X POST localhost:8000/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"long password","display_name":"Me","device":{"platform":"web","name":"curl"}}'
```

Письмо с подтверждением в dev-режиме печатается в лог API (`SONORA_EMAIL_BACKEND=console`).

## Деплой на VPS

Один сервер, Docker. Скрипт не трогает фаервол и другие сервисы (VPN и т.п.):

```bash
git clone https://github.com/slivulik/spotneiroslop.git /opt/sonora
cd /opt/sonora
sudo SONORA_DOMAIN=example.com ./infra/deploy/bootstrap.sh   # без домена: просто sudo ./infra/deploy/bootstrap.sh
```

* Ставит Docker, если его нет; при первом запуске создаёт `.env` (права 600) со случайными паролями.
* Если порт 443/80 уже занят (например, VPN), Caddy публикуется на 8443/8080.
* Без домена API доступно по `http://<IP>/`; с доменом — `https://api.<домен>` (нужна A-запись).
* Обновление: `git pull && sudo ./infra/deploy/bootstrap.sh` (миграции применяются автоматически).
* Хранилище — SeaweedFS (S3 API) за Caddy; ClickHouse и Meilisearch включаются профилем `full`
  в следующих фазах.

## Управление сайтом (`/admin`)

Войдите админом — в боковой панели появится щит. Разделы:

| Раздел | Что умеет |
|---|---|
| Обзор | слушают сейчас, прослушивания за 14 дней, пользователи, каталог, очередь обработки |
| Стриминг | кто что слушает в реальном времени; рубильники: регистрация, Lossless/Hi-Res, превью для гостей, потолок качества, баннер-объявление, режим обслуживания |
| Загрузка | перетащите папки с альбомами (FLAC/MP3 + обложка), прогресс, этапы обработки, перезапуск, публикация |
| Треки / Релизы / Артисты | поиск, правка метаданных, тексты (обычные и LRC, синхронизация «тапом» по пробелу), обложки и фото, удаление |
| Плейлисты | подборки редакции: обложка, описание, треки перетаскиванием |
| Жанры | цвет, обложка, описание, порядок |
| Главная | конструктор из блоков: баннеры, полки релизов, «сторис», треки, плейлисты, артисты, жанры; источник (новые/популярные/вручную), порядок перетаскиванием, живой предпросмотр |
| Пользователи | поиск, роли, блокировка с причиной, выход на всех устройствах, удаление |

## Загрузка музыки

Проще всего — в админке, раздел «Загрузка». Для больших архивов есть CLI:

```bash
# один раз на сервере: создать админа (спросит пароль)
docker compose -f infra/docker-compose.prod.yml --env-file .env exec api sonora-api create-admin --email you@example.com

# со своего компьютера: залить папку (FLAC/MP3, обложка cover.jpg рядом — по желанию)
cd tools/uploader-cli && uv sync
SONORA_API=http://<сервер> uv run sonora-upload ~/Music/Album --email you@example.com --publish --wait
```

Статус обработки, предупреждения (например, «FLAC, вероятно, сделан из MP3») и ошибки видны
в выводе `--wait` и в `GET /v1/admin/uploads/{id}`; упавшую задачу можно перезапустить с любого
этапа: `POST /v1/admin/jobs/{id}/retry`.

## Проверки

```bash
make check         # ruff, mypy --strict, pytest (+ миграции up/down/up), сверка OpenAPI, сборка и тесты TS-пакетов
```

Тестам API нужны Postgres с pgvector и Redis (по умолчанию `localhost`, см. `services/api/README.md`).

## Структура

```
apps/web          сайт (Next.js 16 + React 19 + Tailwind 4), плеер на hls.js
apps/             android (Kotlin/Compose), admin — следующие фазы
services/api      FastAPI: auth, профиль, каталог, админ-загрузки (готово); библиотека, стриминг, волна…
services/media-worker  конвейер обработки аудио (Dramatiq + ffmpeg)
tools/uploader-cli     массовая загрузка папок
packages/
  design-tokens   tokens.json → CSS-переменные, Tailwind v4 theme, TS, Kotlin
  api-schema      openapi.json + типизированный TS-клиент
infra/            docker-compose, ClickHouse-схема, Caddy, init-скрипты
```

Документация: [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md) ·
[CHANGELOG.md](CHANGELOG.md) · [BUGS.md](BUGS.md)
