# Roadmap

Исходный промт пришёл обрезанным на разделе 5.3, поэтому раздел 19 (фазы) неизвестен. Ниже —
рабочий план, построенный по разделам 0–5.2; его нужно сверить с оригиналом, когда придёт
остаток промта.

## Фаза 1 — фундамент ✅

* Монорепо (pnpm workspaces + uv), CI, Makefile, `.env.example`.
* `packages/design-tokens`: JSON → CSS, Tailwind v4, TS, Kotlin; проверка контраста.
* `infra`: docker-compose (Postgres+pgvector, Redis, MinIO, ClickHouse, Meilisearch, API),
  схема событий ClickHouse с материализованными представлениями, Caddy.
* `services/api`: полная схема данных (34 таблицы, миграция 0001), auth (e-mail+пароль,
  Google, refresh-ротация с детектом повторов, подтверждение e-mail, сброс пароля), `/me`,
  устройства, настройки (JSON Merge Patch), онбординг, чтение каталога (треки, батч, релизы,
  артисты, топ-треки, релизы артиста, жанры, настроения), ETag, rate limit, единый формат ошибок.
* `packages/api-schema`: OpenAPI 3.1 + TS-клиент с авто-refresh.

## Фаза 2 — media-worker и админ-API загрузки

Пайплайн 5.1 целиком (ffprobe, проверка подделки lossless, теги, SHA-256 + Chromaprint,
EBU R128, лесенка качеств, HLS fMP4 с gapless-метаданными, waveform, палитра, обложки
AVIF/WebP/JPEG + blurhash, превью 30 с), Dramatiq, `upload_jobs`, `/admin/uploads` (tus),
`tools/uploader-cli`.

## Фаза 3 — стриминг и библиотека

`/tracks/{id}/stream|preview|download` с подписанными URL и бесшовным обновлением,
лимит офлайн-устройств; лайки/дизлайки/подписки, плейлисты (CRUD, reorder дробными индексами,
соавторы), `/me/library/*`, офлайн-синхронизация `/me/library/sync` с Idempotency-Key,
`/events/batch` → ClickHouse, история прослушиваний, тексты и Canvas.

## Фаза 4 — веб-клиент (PWA)

Next.js 15 + React 19: корневой плеер (hls.js/нативный HLS, Web Audio: кроссфейд, нормализация,
EQ, анализатор), state machine плеера, Media Session, горячие клавиши, Service Worker,
главная/поиск/библиотека/артист/альбом/плейлист, полноэкранный плеер с Canvas и пословными
текстами, WebGL-визуал волны.

## Фаза 5 — поиск

Meilisearch: индексация, опечатки, транслитерация, синонимы, поиск по текстам, suggest,
история поиска.

## Фаза 6 — рекомендации и «Моя волна»

`services/recs`: аудио-эмбеддинги, коллаборативные векторы, гибрид, сессионный вектор в Redis,
`/wave/sessions`, похожие треки, миксы, «Открытия недели», «Радар», A/B-эксперименты,
`/home` из серверных секций.

## Фаза 7 — Android

Kotlin 2 + Compose + Media3 (MediaLibraryService, свой AudioProcessor для EQ, SimpleCache,
DownloadManager с шифрованием), модули по разделу 2, Kotlin-клиент из OpenAPI, виджеты Glance,
AGSL-визуал волны, baseline profiles.

## Фаза 8 — синхронизация устройств, push, шеринг, админка UI

SSE/WebSocket-синхронизация плеера, FCM, `/share/*` с OG и story.png, `apps/admin`.

## Фаза 9 — оптимизация и нагрузка

`EXPLAIN ANALYZE` главных эндпоинтов, k6 (`tools/loadtest`), бэкапы, Grafana/Prometheus.

## Осознанно отложено из фазы 1

* `GET /artists/{id}/related` — требует эмбеддингов/коллаборативных данных (фаза 6).
* Письма отправляются через `BackgroundTasks`; перевод на Dramatiq с ретраями — в фазе 2,
  вместе с воркером.
* Локализация писем (сейчас русский) — вместе с i18n веб-клиента.
* Kotlin-клиент из OpenAPI — в фазе 7 (нужен Android SDK).
* Таблица `idempotency_keys` создана; middleware Idempotency-Key — в фазе 3.
