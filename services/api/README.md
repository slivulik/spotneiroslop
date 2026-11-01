# sonora-api

Core HTTP API of Sonora: accounts and sessions, user settings, catalogue read endpoints.
FastAPI (async) · SQLAlchemy 2 + asyncpg · Alembic · PostgreSQL 16 + pgvector · Redis.

## Run locally

```bash
# from the repo root: start Postgres, Redis, SeaweedFS (S3), ClickHouse, Meilisearch
docker compose -f infra/docker-compose.yml up -d postgres redis

cd services/api
cp ../../.env.example .env          # then set SONORA_JWT_SECRET
uv sync
uv run alembic upgrade head
uv run uvicorn sonora_api.asgi:app --reload
```

Swagger UI: http://localhost:8000/docs (disabled when `SONORA_ENV=prod`).

## Checks

```bash
uv run ruff format --check . && uv run ruff check .
uv run mypy                       # strict
uv run pytest --cov=sonora_api    # needs Postgres (with pgvector) and Redis
uv run python scripts/export_openapi.py --check
```

Tests run against a real database (`SONORA_TEST_DATABASE_URL`, default
`postgresql+asyncpg://postgres:postgres@localhost:5432/sonora_test`) and Redis DB 15
(`SONORA_TEST_REDIS_URL`). The schema is built through the Alembic migrations — upgrade,
downgrade and upgrade again — on every run, so a broken migration fails the suite.

## Layout

```
src/sonora_api/
  core/        config, logging, ids (UUIDv7), errors + handlers, security (Argon2id, JWT),
               rate limiting (GCRA in Redis), ETag caching, cursor pagination, middleware
  models/      SQLAlchemy models — the whole data model (34 tables)
  schemas/     Pydantic request/response models (the public contract)
  services/    business logic (auth sessions, users/settings, catalogue, media URLs, e-mail)
  routers/     thin HTTP layer
migrations/    Alembic
scripts/       export_openapi.py → packages/api-schema/openapi.json
```

## Conventions

* Errors: `{"error": {"code", "message", "details", "request_id"}}`; clients switch on `code`.
* Every `/v1` route is rate limited per user (or per IP for guests); credential endpoints have
  a stricter per-IP budget.
* Catalogue responses carry a strong `ETag` and `Cache-Control` (`public` for guests, `private`
  when personalised) and answer `304` to `If-None-Match`.
* Lists use opaque keyset cursors (`next_cursor`), never offsets.
* Relationships are `lazy="raise"`: every query states what it loads, so N+1 can't sneak in.
* After changing a route or schema, regenerate the contract:
  `uv run python scripts/export_openapi.py && pnpm --filter @sonora/api-schema generate`.
