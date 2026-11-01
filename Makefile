.PHONY: help up down api-dev api-check web-check check openapi

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

up: ## Start the local infrastructure (Postgres, Redis, MinIO, ClickHouse, Meilisearch)
	docker compose -f infra/docker-compose.yml --env-file .env up -d postgres redis minio minio-init clickhouse meilisearch

down: ## Stop the local infrastructure
	docker compose -f infra/docker-compose.yml --env-file .env down

api-dev: ## Run the API with auto-reload
	cd services/api && uv run alembic upgrade head && uv run uvicorn sonora_api.asgi:app --reload

api-check: ## Lint, type-check and test the API
	cd services/api && uv run ruff format --check . && uv run ruff check . && uv run mypy && \
		uv run python scripts/export_openapi.py --check && uv run pytest --cov=sonora_api

web-check: ## Build, type-check and test all JS/TS packages
	pnpm -r run build && pnpm -r run typecheck && pnpm -r run test

openapi: ## Regenerate the OpenAPI document and the TypeScript client
	cd services/api && uv run python scripts/export_openapi.py
	pnpm --filter @sonora/api-schema generate

check: api-check web-check ## Everything CI runs
