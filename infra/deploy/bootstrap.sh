#!/usr/bin/env bash
# Install or update Sonora on a single VPS. Safe to re-run (idempotent).
#
#   git clone https://github.com/slivulik/spotneiroslop.git /opt/sonora
#   cd /opt/sonora && sudo ./infra/deploy/bootstrap.sh
#
# Never touches the firewall or other services (e.g. a VPN on the same host): it only
# installs Docker if missing, writes .env on first run and starts the compose stack.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/docker-compose.prod.yml" --env-file "$ROOT/.env")

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo $0)"

# --- Docker -------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin is missing"

# --- .env (first run only) ----------------------------------------------------
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }
public_ip() { curl -fsS4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}'; }

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -Hltn "sport = :$1" | grep -q .
  else
    # Minimal images may lack iproute2: probe the port directly.
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

first_free_port() {
  local port
  for port in "$@"; do
    port_busy "$port" || { echo "$port"; return 0; }
  done
  return 1
}

if [[ ! -f "$ROOT/.env" ]]; then
  log "Creating $ROOT/.env with random secrets"
  domain="${SONORA_DOMAIN:-}"
  http_port="${CADDY_HTTP_PORT:-80}"
  https_port="${CADDY_HTTPS_PORT:-443}"
  if port_busy "$https_port"; then
    https_port="$(first_free_port 8443 9443 10443 11443 12443)" || die "no free port for HTTPS"
    warn "port 443 is already used (VPN?) — Caddy will publish HTTPS on $https_port instead"
  fi
  if port_busy "$http_port"; then
    http_port="$(first_free_port 8080 8081 8088 9080 10080)" || die "no free port for HTTP"
    warn "port 80 is already used — Caddy will publish HTTP on $http_port instead"
  fi
  ip="$(public_ip)"
  if [[ -n "$domain" ]]; then
    address="api.$domain"
    web_url="https://$domain"
    media_url="https://media.$domain"
  else
    # No domain yet: plain HTTP on the server IP.
    address=":80"
    web_url="http://$ip"
    media_url="http://$ip/media"
  fi
  umask 077
  cat >"$ROOT/.env" <<ENV
SONORA_ENV=prod
SONORA_LOG_LEVEL=INFO
SONORA_JWT_SECRET=$(rand 64)
SONORA_WEB_BASE_URL=$web_url
SONORA_MEDIA_BASE_URL=$media_url
SONORA_CORS_ORIGINS=$web_url
SONORA_GOOGLE_CLIENT_IDS=
SONORA_EMAIL_BACKEND=console

POSTGRES_USER=sonora
POSTGRES_PASSWORD=$(rand 32)
POSTGRES_DB=sonora
CLICKHOUSE_USER=sonora
CLICKHOUSE_PASSWORD=$(rand 32)
MEILI_MASTER_KEY=$(rand 40)
S3_ACCESS_KEY=sonora
S3_SECRET_KEY=$(rand 40)

SONORA_API_ADDRESS=$address
ACME_EMAIL=${ACME_EMAIL:-admin@${domain:-example.com}}
CADDY_HTTP_PORT=$http_port
CADDY_HTTPS_PORT=$https_port
WEB_CONCURRENCY=2
ENV
else
  log "Keeping existing $ROOT/.env"
fi

# --- Keys added by later releases (existing installs keep their secrets) --------------
ensure_env() {
  grep -q "^$1=" "$ROOT/.env" || { echo "$1=$2" >>"$ROOT/.env"; log "added $1 to .env"; }
}
# shellcheck disable=SC1091
source "$ROOT/.env"
if [[ "$SONORA_API_ADDRESS" == :* ]]; then
  public_url="http://$(public_ip)"
  [[ "$CADDY_HTTP_PORT" == "80" ]] || public_url="$public_url:$CADDY_HTTP_PORT"
else
  public_url="https://$SONORA_API_ADDRESS"
  [[ "$CADDY_HTTPS_PORT" == "443" ]] || public_url="$public_url:$CADDY_HTTPS_PORT"
fi
ensure_env SONORA_PUBLIC_URL "$public_url"
ensure_env WORKER_PROCESSES 1

# --- Start ----------------------------------------------------------------------
if [[ "${SONORA_SKIP_BUILD:-0}" == "1" ]]; then
  log "Skipping build (SONORA_SKIP_BUILD=1): using existing sonora-api:latest"
  up_flags=(--no-build)
else
  log "Building images (API, media worker, web)"
  "${COMPOSE[@]}" build api-migrate media-worker web
  up_flags=()
fi
log "Starting stack"
"${COMPOSE[@]}" up -d --remove-orphans "${up_flags[@]}"
# The Caddyfile is a bind-mounted file: `git pull` replaces it with a new inode that a running
# container never sees, and compose doesn't recreate Caddy for it. Restart to load the new routes.
"${COMPOSE[@]}" restart caddy

log "Waiting for the API to become ready"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api python -c \
    "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2).status == 200 else 1)" \
    >/dev/null 2>&1; then
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    log "Sonora API is up"
    echo "    ${SONORA_PUBLIC_URL}/healthz"
    [[ "$SONORA_API_ADDRESS" == :* ]] || echo "    (DNS A-record for ${SONORA_API_ADDRESS} must point to this server)"
    echo
    echo "    Create the admin account (asks for a password):"
    echo "    docker compose -f infra/docker-compose.prod.yml --env-file .env exec api sonora-api create-admin --email you@example.com"
    exit 0
  fi
  sleep 2
done
"${COMPOSE[@]}" logs --tail 80 api api-migrate caddy
die "API did not become ready in 120 s (logs above)"
