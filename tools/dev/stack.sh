#!/usr/bin/env bash
# Private development stacks, one per "slot", so several people (or agents) can run and test the
# whole product side by side without touching each other's database, queue or ports.
#
#   tools/dev/stack.sh up <slot>        start API + worker + web + edge proxy for the checkout you are in
#   tools/dev/stack.sh api <slot>       restart API + worker (after backend changes; runs migrations)
#   tools/dev/stack.sh web <slot>       rebuild and restart the site (after frontend changes)
#   tools/dev/stack.sh down <slot>      stop the slot's processes
#   tools/dev/stack.sh reset <slot>     drop the slot's database and re-create it from the seed
#   tools/dev/stack.sh env <slot>       print `export …` lines (also the per-slot TEST databases)
#   tools/dev/stack.sh snapshot <slot>  save the slot's database as the seed for new slots
#   tools/dev/stack.sh status           what is running
#
# Slot N listens on: site+API (edge) http://127.0.0.1:$((8080+N)), API $((8200+N)), web $((3200+N)).
# Shared by all slots: PostgreSQL (native service), Redis on 6390 (256 databases), SeaweedFS S3 on 9000.
# Run it from the root of the checkout (or worktree) whose code the slot should serve.
set -euo pipefail

CMD="${1:-status}"
SLOT="${2:-0}"
[[ "$SLOT" =~ ^[0-9]+$ ]] && ((SLOT <= 60)) || { echo "slot must be 0..60" >&2; exit 2; }

ROOT="$(git rev-parse --show-toplevel)"
STATE="${SONORA_DEV_STATE:-$HOME/.sonora-dev}"
RUN="$STATE/slot-$SLOT"
BASE_ENV="$STATE/base.env"
REDIS_PORT=6390
EDGE_PORT=$((8080 + SLOT))
API_PORT=$((8200 + SLOT))
WEB_PORT=$((3200 + SLOT))
DB="sonora_dev_$SLOT"
PGURL="postgresql://postgres:postgres@127.0.0.1:5432"
export PGPASSWORD=postgres
mkdir -p "$RUN"

psqlc() { psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -Atqc "$1" "${2:-postgres}"; }
db_exists() { [[ "$(psqlc "select 1 from pg_database where datname='$1'")" == 1 ]]; }

base_env() {
  if [[ ! -f "$BASE_ENV" ]]; then
    mkdir -p "$STATE"
    {
      echo "export SONORA_ENV=dev"
      echo "export SONORA_LOG_JSON=true"
      echo "export SONORA_JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
      echo "export SONORA_S3_ENDPOINT_URL=http://127.0.0.1:9000"
      echo "export SONORA_WORKER_PROCESSES=1"
    } >"$BASE_ENV"
  fi
  cat "$BASE_ENV"
}

slot_env() {
  base_env
  cat <<EOF
export SONORA_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/$DB
export SONORA_REDIS_URL=redis://127.0.0.1:$REDIS_PORT/$((SLOT * 4))
export SONORA_QUEUE_URL=redis://127.0.0.1:$REDIS_PORT/$((SLOT * 4 + 1))
export SONORA_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sonora_test_$SLOT
export SONORA_TEST_REDIS_URL=redis://127.0.0.1:$REDIS_PORT/$((SLOT * 4 + 2))
export SONORA_WORKER_TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/sonora_worker_test_$SLOT
export SONORA_S3_PUBLIC_ENDPOINT_URL=http://127.0.0.1:$EDGE_PORT
export SONORA_MEDIA_BASE_URL=http://127.0.0.1:$EDGE_PORT/sonora-public
export SONORA_WEB_BASE_URL=http://127.0.0.1:$EDGE_PORT
export SONORA_CORS_ORIGINS=http://127.0.0.1:$EDGE_PORT
export SONORA_WORKDIR=$RUN/work
export SONORA_API_INTERNAL_URL=http://127.0.0.1:$API_PORT
export SONORA_DEV_BASE=http://127.0.0.1:$EDGE_PORT
export UV_SYSTEM_CERTS=1
unset UV_NATIVE_TLS
EOF
}

shared_up() {
  service postgresql start >/dev/null 2>&1 || true
  redis-cli -p $REDIS_PORT ping >/dev/null 2>&1 ||
    redis-server --port $REDIS_PORT --databases 256 --save "" --appendonly no --daemonize yes >/dev/null
  pgrep -x dockerd >/dev/null || { (setsid dockerd >"$STATE/dockerd.log" 2>&1 &); sleep 6; }
  if ! docker ps --format '{{.Names}}' | grep -qx sonora-s3; then
    docker rm -f sonora-s3 e2e-s3 >/dev/null 2>&1 || true
    mkdir -p "$STATE/s3-conf" "${SONORA_DEV_S3_DATA:=$STATE/s3-data}"
    [[ -f "$STATE/s3-conf/s3.json" ]] || cat >"$STATE/s3-conf/s3.json" <<'JSON'
{"identities": [
  {"name": "sonora", "credentials": [{"accessKey": "sonora", "secretKey": "sonora-secret"}],
   "actions": ["Admin", "Read", "Write", "List", "Tagging"]},
  {"name": "anonymous", "actions": ["Read:sonora-public"]}]}
JSON
    docker run -d --name sonora-s3 --network host -v "$STATE/s3-conf:/etc/seaweedfs:ro" -v "$SONORA_DEV_S3_DATA:/data" \
      chrislusf/seaweedfs:latest server -dir=/data -ip=127.0.0.1 -master.port=19333 -volume.port=18080 \
      -filer.port=18888 -s3 -s3.port=9000 -s3.config=/etc/seaweedfs/s3.json >/dev/null
    for _ in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:9000/status && break; sleep 1; done
  fi
}

stop_one() { # name
  local f="$RUN/$1.pid"
  [[ -f "$f" ]] || return 0
  local pid; pid="$(cat "$f")"
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  rm -f "$f"
}

start_one() { # name, command…  (own process group, so `down` can stop the whole tree)
  local name="$1"; shift
  stop_one "$name"
  setsid "$@" >"$RUN/$name.log" 2>&1 &
  echo $! >"$RUN/$name.pid"
}

ensure_db() {
  if ! db_exists "$DB"; then
    if db_exists sonora_seed; then psqlc "create database $DB template sonora_seed"; else psqlc "create database $DB"; fi
  fi
  for t in "sonora_test_$SLOT" "sonora_worker_test_$SLOT"; do db_exists "$t" || psqlc "create database $t"; done
}

api_up() {
  eval "$(slot_env)"
  ensure_db
  (cd "$ROOT/services/api" && uv run -q alembic upgrade head >"$RUN/migrate.log" 2>&1 && uv run -q sonora-api init-storage >>"$RUN/migrate.log" 2>&1) ||
    { echo "migrations failed, see $RUN/migrate.log" >&2; tail -20 "$RUN/migrate.log" >&2; exit 1; }
  (cd "$ROOT/services/api" && start_one api uv run -q uvicorn sonora_api.asgi:app --port "$API_PORT" --proxy-headers --forwarded-allow-ips='*')
  (cd "$ROOT/services/media-worker" && start_one worker uv run -q sonora-media-worker)
  for _ in $(seq 1 40); do curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/readyz" && return 0; sleep 1; done
  echo "API did not become ready, see $RUN/api.log" >&2; tail -20 "$RUN/api.log" >&2; exit 1
}

web_up() {
  eval "$(slot_env)"
  (cd "$ROOT" && pnpm --filter @sonora/web... build >"$RUN/web-build.log" 2>&1) ||
    { echo "web build failed, see $RUN/web-build.log" >&2; tail -30 "$RUN/web-build.log" >&2; exit 1; }
  local app="$ROOT/apps/web"
  mkdir -p "$app/.next/standalone/apps/web/.next"
  rm -rf "$app/.next/standalone/apps/web/.next/static" "$app/.next/standalone/apps/web/public"
  cp -r "$app/.next/static" "$app/.next/standalone/apps/web/.next/"
  cp -r "$app/public" "$app/.next/standalone/apps/web/"
  (cd "$app/.next/standalone" && PORT=$WEB_PORT HOSTNAME=127.0.0.1 start_one web node apps/web/server.js)
  for _ in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/login" && return 0; sleep 1; done
  echo "web did not start, see $RUN/web.log" >&2; exit 1
}

edge_up() {
  docker rm -f "sonora-edge-$SLOT" >/dev/null 2>&1 || true
  docker run -d --name "sonora-edge-$SLOT" --network host -v "$ROOT/infra/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -e SONORA_API_ADDRESS=":$EDGE_PORT" -e ACME_EMAIL=dev@sonora.invalid -e SONORA_S3_UPSTREAM=127.0.0.1:9000 \
    -e SONORA_API_UPSTREAM="127.0.0.1:$API_PORT" -e SONORA_WEB_UPSTREAM="127.0.0.1:$WEB_PORT" \
    -e CADDY_ADMIN="127.0.0.1:$((2100 + SLOT))" caddy:2.10-alpine caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
}

case "$CMD" in
  env) slot_env ;;
  up)
    shared_up; api_up
    [[ "${3:-}" == "--no-web" ]] || web_up
    edge_up
    echo "slot $SLOT: http://127.0.0.1:$EDGE_PORT  (api $API_PORT, web $WEB_PORT, db $DB)" ;;
  api) shared_up; api_up; echo "slot $SLOT api restarted" ;;
  web) web_up; echo "slot $SLOT web rebuilt" ;;
  down)
    for p in api worker web; do stop_one "$p"; done
    docker rm -f "sonora-edge-$SLOT" >/dev/null 2>&1 || true ;;
  reset)
    for p in api worker; do stop_one "$p"; done
    psqlc "drop database if exists $DB with (force)"
    ensure_db; echo "slot $SLOT database re-created" ;;
  snapshot)
    for p in api worker; do stop_one "$p"; done
    psqlc "drop database if exists sonora_seed with (force)"
    psqlc "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB'" >/dev/null
    psqlc "create database sonora_seed template $DB"
    echo "seed saved from slot $SLOT (restart it with: stack.sh api $SLOT)" ;;
  status)
    for d in "$STATE"/slot-*; do
      [[ -d "$d" ]] || continue
      n="${d##*-}"; line="slot $n:"
      for p in api worker web; do
        if [[ -f "$d/$p.pid" ]] && kill -0 "$(cat "$d/$p.pid")" 2>/dev/null; then line+=" $p=up"; else line+=" $p=-"; fi
      done
      echo "$line  http://127.0.0.1:$((8080 + n))"
    done ;;
  *) sed -n 2,16p "$0"; exit 2 ;;
esac
