# Sonora

Музыкальный стриминг-сервис: веб (PWA), Android, бэкенд, рекомендации и «Моя волна», админка.
Главный экран — бесконечная персональная волна; плеер с Canvas и пословными текстами;
качество до Hi-Res Lossless.

> Статус: **фаза 1 — фундамент** (монорепо, дизайн-токены, инфраструктура, ядро API:
> схема данных, авторизация, профиль и настройки, чтение каталога, OpenAPI + TS-клиент).
> План остальных фаз — в [ROADMAP.md](ROADMAP.md).

## Быстрый старт (≈5 минут)

Нужны Docker, [uv](https://docs.astral.sh/uv/) и Node 22 + pnpm.

```bash
cp .env.example .env
# задайте SONORA_JWT_SECRET: python -c "import secrets; print(secrets.token_urlsafe(48))"

make up            # Postgres+pgvector, Redis, MinIO, ClickHouse, Meilisearch
make api-dev       # миграции + API на http://localhost:8000 (Swagger: /docs)
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

## Проверки

```bash
make check         # ruff, mypy --strict, pytest (+ миграции up/down/up), сверка OpenAPI, сборка и тесты TS-пакетов
```

Тестам API нужны Postgres с pgvector и Redis (по умолчанию `localhost`, см. `services/api/README.md`).

## Структура

```
apps/             web (Next.js), android (Kotlin/Compose), admin — следующие фазы
services/api      FastAPI: auth, профиль, каталог (готово), библиотека, стриминг, волна…
packages/
  design-tokens   tokens.json → CSS-переменные, Tailwind v4 theme, TS, Kotlin
  api-schema      openapi.json + типизированный TS-клиент
infra/            docker-compose, ClickHouse-схема, Caddy, init-скрипты
```

Документация: [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md) ·
[CHANGELOG.md](CHANGELOG.md) · [BUGS.md](BUGS.md)
