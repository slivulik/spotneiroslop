FROM python:3.13-slim AS build
RUN pip install --no-cache-dir "uv>=0.11,<0.12"
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

FROM python:3.13-slim AS runtime
RUN groupadd --system sonora && useradd --system --gid sonora --home /app sonora
WORKDIR /app
COPY --from=build --chown=sonora:sonora /app/.venv /app/.venv
COPY --from=build --chown=sonora:sonora /app/src /app/src
COPY --chown=sonora:sonora alembic.ini ./
COPY --chown=sonora:sonora migrations ./migrations
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER sonora
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status == 200 else 1)"
# Workers: ~2×CPU for async I/O-bound work; override with WEB_CONCURRENCY.
CMD ["sh", "-c", "exec gunicorn sonora_api.asgi:app -k uvicorn_worker.UvicornWorker -w ${WEB_CONCURRENCY:-4} -b 0.0.0.0:8000 --forwarded-allow-ips='*' --graceful-timeout 30 --keep-alive 5"]
