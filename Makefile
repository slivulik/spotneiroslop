.PHONY: help up down api-dev worker-dev api-check worker-check uploader-check web-check check openapi

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

up: ## Start the local infrastructure (Postgres, Redis, SeaweedFS S3, ClickHouse, Meilisearch)
	docker compose -f infra/docker-compose.yml --env-file .env up -d postgres redis s3 clickhouse meilisearch
	cd services/api && uv run sonora-api init-storage

down: ## Stop the local infrastructure
	docker compose -f infra/docker-compose.yml --env-file .env down

api-dev: ## Run the API with auto-reload
	cd services/api && uv run alembic upgrade head && uv run uvicorn sonora_api.asgi:app --reload

worker-dev: ## Run the media worker (needs ffmpeg)
	cd services/media-worker && uv run sonora-media-worker

api-check: ## Lint, type-check and test the API
	cd services/api && uv run ruff format --check . && uv run ruff check . && uv run mypy && \
		uv run python scripts/export_openapi.py --check && uv run pytest --cov=sonora_api

worker-check: ## Lint, type-check and test the media worker
	cd services/media-worker && uv run ruff format --check . && uv run ruff check . && uv run mypy && \
		uv run pytest --cov=sonora_media

uploader-check: ## Lint, type-check and test the uploader CLI
	cd tools/uploader-cli && uv run ruff check . && uv run mypy && uv run pytest

web-check: ## Build, type-check and test all JS/TS packages
	pnpm -r run build && pnpm -r run typecheck && pnpm -r run test

openapi: ## Regenerate the OpenAPI document and the TypeScript client
	cd services/api && uv run python scripts/export_openapi.py
	pnpm --filter @sonora/api-schema generate

check: api-check worker-check uploader-check web-check ## Everything CI runs
