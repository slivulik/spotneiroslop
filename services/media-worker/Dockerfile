# Build context: services/ (the worker depends on the sonora-api package for models).
FROM python:3.13-slim AS build
RUN pip install --no-cache-dir "uv>=0.11,<0.12"
# Build the venv at the path it runs from: entry-point scripts hard-code their interpreter path.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY api/pyproject.toml api/uv.lock api/README.md ./api/
COPY api/src ./api/src
COPY media-worker/pyproject.toml media-worker/uv.lock media-worker/README.md ./media-worker/
COPY media-worker/src ./media-worker/src
WORKDIR /app/media-worker
# --no-editable: copy both packages into the venv so the runtime image needs no sources.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim AS runtime
# ffmpeg from Debian is built with libsoxr and chromaprint, both required by the pipeline.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system sonora && useradd --system --gid sonora --home /work sonora \
 && mkdir -p /work && chown sonora:sonora /work
COPY --from=build /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 SONORA_WORKDIR=/work
USER sonora
WORKDIR /work
CMD ["sonora-media-worker"]
