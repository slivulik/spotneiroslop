# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — SemVer.

## [Unreleased]

### Added — сайт
- API: HLS-стриминг с подписанными на 5 минут ссылками сегментов, превью для гостей, новые релизы.
- `apps/web`: Next.js 16 + React 19 + Tailwind 4 на дизайн-токенах; сессия через httpOnly-cookie;
  плеер с машиной состояний, очередью, shuffle/repeat, выбором качества, нормализацией громкости,
  Media Session и горячими клавишами; полноэкранный плеер с живым фоном из палитры обложки.
- Caddy — единая точка входа (API, S3, сайт); Docker-образ сайта; сервис `web` в прод-compose.

### Added — фаза 2
- Админ-загрузки: подписанные S3-ссылки, подтверждение с проверкой размера, очередь Dramatiq,
  статус/логи/предупреждения задачи, перезапуск с любого этапа, публикация/эмбарго релиза.
- `services/media-worker`: проверка целостности (MD5 FLAC), детект lossy-источника, теги
  FLAC/ID3 (feat., версии, LRC/SYLT/USLT), дубликаты по SHA-256 и Chromaprint, EBU R128 и gain,
  лесенка качеств без апскейла, HLS fMP4 с исправленным edit list, waveform, обложки
  AVIF/WebP/JPEG + blurhash + палитра с контрастом WCAG, превью 30 с, album gain.
- `tools/uploader-cli` (`sonora-upload`), `sonora-api create-admin`, `sonora-api init-storage`.
- SeaweedFS (S3) в docker-compose и на VPS, маршрутизация бакетов через Caddy, сервис воркера.

### Changed
- Обложки в отдельном публичном бакете `sonora-public`; `SONORA_MEDIA_BASE_URL` указывает на него.
- Все ORM-модели используют `eager_defaults` (серверные значения возвращаются через RETURNING).

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
