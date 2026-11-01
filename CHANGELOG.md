# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — SemVer.

## [Unreleased]

### Added — фаза 1
- Монорепозиторий (pnpm workspaces, uv), CI на GitHub Actions, Makefile.
- `@sonora/design-tokens`: генерация CSS-переменных, Tailwind v4 theme, TS и Kotlin из `tokens.json`
  с валидацией и проверкой контраста WCAG.
- `services/api`: схема данных из 34 таблиц (pgvector, HNSW, частичные индексы), миграция 0001.
- Авторизация: регистрация, вход, Google, ротация refresh-токенов с детектом повторного
  использования, выход, подтверждение e-mail, сброс пароля; привязка сессий к устройствам.
- `/v1/me`, устройства с удалённым выходом, настройки (JSON Merge Patch), онбординг.
- Каталог: трек, батч треков, релиз, артист, топ-треки, релизы артиста (keyset-пагинация),
  жанры, настроения; ETag/304 и Cache-Control.
- GCRA rate limiting в Redis, единый формат ошибок, request id, структурированные логи.
- `@sonora/api-schema`: OpenAPI 3.1 и TS-клиент с общим refresh при `token_expired`.
- Деплой на один VPS: `docker-compose.prod.yml` (наружу только Caddy, настраиваемые порты для
  соседства с VPN) и идемпотентный `infra/deploy/bootstrap.sh`.
- Инфраструктура: docker-compose, схема событий ClickHouse и материализованные представления, Caddyfile.
