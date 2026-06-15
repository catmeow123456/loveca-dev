#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
CLIENT_ENV_FILE="${ROOT_DIR}/client/.env.local"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.dev.yml"
COMPOSE_PROJECT="${TEST_COMPOSE_PROJECT:-loveca}"
TMUX_SESSION="${TEST_TMUX_SESSION:-loveca-test}"
FRONTEND_PORT="${TEST_FRONTEND_PORT:-5173}"
RESET_DATA="${TEST_RESET_DATA:-1}"

cd "$ROOT_DIR"

log() {
  printf '[test-env] %s\n' "$*"
}

die() {
  printf '[test-env] ERROR: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

warn_env_file_completeness() {
  ROOT_ENV_FILE="$ENV_FILE" CLIENT_ENV_FILE="$CLIENT_ENV_FILE" node <<'NODE'
const fs = require('node:fs');

const files = [
  {
    label: '.env',
    path: process.env.ROOT_ENV_FILE,
    example: '.env.example',
    required: [
      'PORT',
      'NODE_ENV',
      'DATABASE_URL',
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'MINIO_ENDPOINT',
      'MINIO_PORT',
      'MINIO_ACCESS_KEY',
      'MINIO_SECRET_KEY',
      'MINIO_BUCKET',
      'MINIO_USE_SSL',
      'FRONTEND_URL',
    ],
  },
  {
    label: 'client/.env.local',
    path: process.env.CLIENT_ENV_FILE,
    example: 'client/.env.example',
    required: [],
    recommended: ['VITE_API_BASE_URL'],
  },
];

function parseEnvFile(path) {
  const values = new Map();
  const text = fs.readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const index = line.indexOf('=');
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function isPlaceholder(value) {
  return /^(your_|sk-your_|change_me|changeme|placeholder)/i.test(value);
}

const warnings = [];

for (const file of files) {
  if (!fs.existsSync(file.path)) {
    warnings.push(`${file.label} is missing; copy ${file.example} and fill required values manually`);
    if (file.label === '.env') {
      warnings.push(
        '.env missing means local MinIO defaults will be used; configure MinIO and preprocess card image/static resources before relying on image data'
      );
    }
    continue;
  }

  const values = parseEnvFile(file.path);
  const missing = file.required.filter((key) => !values.has(key));
  const empty = file.required.filter((key) => values.has(key) && values.get(key) === '');
  const recommendedMissing = (file.recommended || []).filter((key) => !values.has(key));
  const placeholders = file.required.filter((key) => {
    const value = values.get(key);
    return value && isPlaceholder(value);
  });

  if (missing.length > 0) {
    warnings.push(`${file.label} missing required keys: ${missing.join(', ')}`);
  }
  if (empty.length > 0) {
    warnings.push(`${file.label} has empty required values: ${empty.join(', ')}`);
  }
  if (recommendedMissing.length > 0) {
    warnings.push(`${file.label} missing recommended keys: ${recommendedMissing.join(', ')}`);
  }
  if (placeholders.length > 0) {
    warnings.push(`${file.label} still has placeholder values: ${placeholders.join(', ')}`);
  }

  if (
    file.label === '.env' &&
    (values.get('MINIO_ENDPOINT') || 'localhost') === 'localhost' &&
    (values.get('MINIO_PORT') || '9000') === '9000'
  ) {
    warnings.push(
      '.env uses default local MinIO endpoint localhost:9000; make sure MinIO is configured and card image/static resources have been preprocessed'
    );
  }
}

if (warnings.length > 0) {
  console.error('[test-env] environment file reminders:');
  for (const warning of warnings) {
    console.error(`[test-env] - ${warning}`);
  }
}
NODE
}

load_env_file() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  else
    log ".env not found; using local test defaults"
  fi

  export PORT="${PORT:-3007}"
  export NODE_ENV="${NODE_ENV:-development}"
  export DATABASE_URL="${DATABASE_URL:-postgres://loveca:loveca_dev@localhost:5432/loveca}"
  export JWT_SECRET="${JWT_SECRET:-loveca_test_jwt_secret_32_chars_min}"
  export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-loveca_test_refresh_secret_32_chars}"
  export MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
  export MINIO_PORT="${MINIO_PORT:-9000}"
  export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
  export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
  export MINIO_BUCKET="${MINIO_BUCKET:-loveca-cards}"
  export MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
  export FRONTEND_URL="${FRONTEND_URL:-http://localhost:${FRONTEND_PORT}}"
}

validate_env() {
  node <<'NODE'
const env = process.env;
const errors = [];
const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'FRONTEND_URL',
];

for (const key of required) {
  if (!env[key]) errors.push(`${key} is required`);
}

function isPlaceholder(value) {
  return /^(your_|sk-your_|change_me|changeme|placeholder)/i.test(value);
}

for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
  if (env[key] && env[key].length < 32) {
    errors.push(`${key} must be at least 32 characters`);
  }
  if (env[key] && isPlaceholder(env[key])) {
    errors.push(`${key} still looks like a placeholder`);
  }
}

const port = Number(env.PORT);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  errors.push('PORT must be an integer between 1 and 65535');
}
if (port !== 3007) {
  errors.push('PORT must be 3007 for this test script because client/vite.config.ts proxies /api there');
}

const minioPort = Number(env.MINIO_PORT);
if (env.MINIO_PORT && (!Number.isInteger(minioPort) || minioPort <= 0 || minioPort > 65535)) {
  errors.push('MINIO_PORT must be an integer between 1 and 65535');
}

if (env.NODE_ENV !== 'development') {
  errors.push('NODE_ENV must be development for the test server');
}

try {
  const db = new URL(env.DATABASE_URL);
  const host = db.hostname;
  const portText = db.port || '5432';
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) {
    errors.push('DATABASE_URL must use postgres:// or postgresql://');
  }
  if (!['localhost', '127.0.0.1'].includes(host)) {
    errors.push('DATABASE_URL must point to localhost/127.0.0.1, not a remote database');
  }
  if (portText !== '5432') errors.push('DATABASE_URL must use local port 5432');
  if (db.pathname !== '/loveca') errors.push('DATABASE_URL database name must be loveca');
  if (decodeURIComponent(db.username) !== 'loveca') {
    errors.push('DATABASE_URL username must be loveca for docker-compose.dev.yml');
  }
  if (decodeURIComponent(db.password) !== 'loveca_dev') {
    errors.push('DATABASE_URL password must be loveca_dev for docker-compose.dev.yml');
  }
} catch {
  errors.push('DATABASE_URL is not a valid URL');
}

try {
  const frontend = new URL(env.FRONTEND_URL);
  if (!['http:', 'https:'].includes(frontend.protocol)) {
    errors.push('FRONTEND_URL must be http(s)');
  }
} catch {
  errors.push('FRONTEND_URL is not a valid URL');
}

if (env.EMAIL_ENABLED === 'true') {
  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!env[key]) errors.push(`${key} is required when EMAIL_ENABLED=true`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
NODE
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :${port}" | grep -q .
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  die "cannot check ports: install ss, lsof, or nc"
}

check_ports_available() {
  local ports=("${PORT}" "$FRONTEND_PORT" 5432)
  if uses_local_minio; then
    ports+=(9000 9001)
  fi
  local busy=()
  for port in "${ports[@]}"; do
    if port_in_use "$port"; then
      busy+=("$port")
    fi
  done
  if ((${#busy[@]} > 0)); then
    die "ports already in use: ${busy[*]}"
  fi
}

stop_existing_environment() {
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    log "stopping existing tmux session: $TMUX_SESSION"
    tmux kill-session -t "$TMUX_SESSION"
  fi

  if [[ "$RESET_DATA" == "1" ]]; then
    log "stopping compose project and removing test volumes: $COMPOSE_PROJECT"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null
  else
    log "stopping compose project without removing volumes: $COMPOSE_PROJECT"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null
  fi
}

wait_until() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2
  local started_at
  started_at="$(date +%s)"

  while true; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      die "timed out waiting for: $label"
    fi
    sleep 1
  done
}

wait_for_compose_service() {
  local service="$1"
  local timeout_seconds="$2"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local status
    status="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps --status running --format json "$service" 2>/dev/null || true)"
    if [[ -n "$status" ]]; then
      if docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T "$service" sh -c 'exit 0' >/dev/null 2>&1; then
        return 0
      fi
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      die "timed out waiting for compose service: $service"
    fi
    sleep 1
  done
}

wait_for_postgres() {
  wait_for_compose_service postgres 60
  wait_until "Postgres health" 60 \
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" exec -T postgres pg_isready -U loveca -d loveca
}

wait_for_minio() {
  wait_for_compose_service minio 60
  wait_until "MinIO health" 60 curl -fsS "http://127.0.0.1:9000/minio/health/live"
}

uses_local_minio() {
  [[ "${MINIO_ENDPOINT}" == "localhost" || "${MINIO_ENDPOINT}" == "127.0.0.1" ]]
}

compose_services() {
  if uses_local_minio; then
    printf 'postgres minio minio-init'
  else
    printf 'postgres'
  fi
}

wait_for_remote_minio() {
  local scheme="http"
  if [[ "${MINIO_USE_SSL}" == "true" ]]; then
    scheme="https"
  fi
  wait_until "remote MinIO bucket" 30 \
    curl -fsS "${scheme}://${MINIO_ENDPOINT}:${MINIO_PORT}/${MINIO_BUCKET}/static/deck.png"
}

wait_for_api() {
  local api_url="http://127.0.0.1:${PORT}/api/health"
  local timeout_seconds=90
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -fsS "$api_url" >/dev/null 2>&1; then
      return 0
    fi

    if (( $(date +%s) - started_at >= timeout_seconds )); then
      log "API logs:"
      tmux capture-pane -pt "${TMUX_SESSION}:api" -S -80 || true
      die "timed out waiting for API health check: $api_url"
    fi
    sleep 2
  done
}

register_user() {
  local username="$1"
  local password="$2"
  local display_name="$3"
  local payload
  local response_file
  local status

  payload="$(node -e 'console.log(JSON.stringify({ username: process.argv[1], password: process.argv[2], displayName: process.argv[3] }))' "$username" "$password" "$display_name")"
  response_file="$(mktemp)"
  status="$(curl -sS -o "$response_file" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "http://127.0.0.1:${PORT}/api/auth/register")"

  if [[ "$status" == "201" ]]; then
    log "registered test user: $username"
  elif [[ "$status" == "409" ]]; then
    log "test user already exists: $username"
  else
    cat "$response_file" >&2
    rm -f "$response_file"
    die "failed to register test user $username, HTTP $status"
  fi
  rm -f "$response_file"
}

register_test_users() {
  local users="${TEST_USERS:-test_player_1:test_password_1:Test Player 1,test_player_2:test_password_2:Test Player 2}"
  local old_ifs="$IFS"
  IFS=','
  read -r -a entries <<< "$users"
  IFS="$old_ifs"

  for entry in "${entries[@]}"; do
    local username password display_name
    IFS=':' read -r username password display_name <<< "$entry"
    [[ -n "${username:-}" && -n "${password:-}" ]] || die "invalid TEST_USERS entry: $entry"
    register_user "$username" "$password" "${display_name:-$username}"
  done
}

seed_test_admin_decks() {
  if [[ "${TEST_SEED_ADMIN_DECKS:-1}" == "0" ]]; then
    log "skipping test admin deck seed"
    return
  fi

  log "seeding test admin user and recommended deck"
  node scripts/seed-test-env-admin-decks.mjs
}

initialize_card_data() {
  log "syncing card data from llocg_db"
  pnpm exec tsx src/scripts/sync-cards-llocg.ts

  log "normalizing card codes"
  pnpm exec tsx src/scripts/normalize-card-codes.ts

  log "normalizing group names"
  pnpm exec tsx src/scripts/normalize-group.ts

  log "validating card codes"
  pnpm exec tsx src/scripts/validate-card-codes.ts --source=db --errors-only

  log "validating group names"
  pnpm exec tsx src/scripts/validate-group.ts --source=db --errors-only
}

api_command() {
  printf 'cd %q && env PORT=%q NODE_ENV=%q DATABASE_URL=%q JWT_SECRET=%q JWT_REFRESH_SECRET=%q MINIO_ENDPOINT=%q MINIO_PORT=%q MINIO_ACCESS_KEY=%q MINIO_SECRET_KEY=%q MINIO_BUCKET=%q MINIO_USE_SSL=%q FRONTEND_URL=%q node --watch dist/server/index.js' \
    "$ROOT_DIR" \
    "$PORT" \
    "$NODE_ENV" \
    "$DATABASE_URL" \
    "$JWT_SECRET" \
    "$JWT_REFRESH_SECRET" \
    "$MINIO_ENDPOINT" \
    "$MINIO_PORT" \
    "$MINIO_ACCESS_KEY" \
    "$MINIO_SECRET_KEY" \
    "$MINIO_BUCKET" \
    "$MINIO_USE_SSL" \
    "$FRONTEND_URL"
}

start_tmux_environment() {
  log "starting dependencies in tmux session: $TMUX_SESSION"
  tmux new-session -d -s "$TMUX_SESSION" -n deps "cd '$ROOT_DIR' && docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' up $(compose_services)"

  log "waiting for Postgres"
  wait_for_postgres

  if uses_local_minio; then
    log "waiting for local MinIO"
    wait_for_minio
  else
    log "checking remote MinIO read access"
    wait_for_remote_minio
  fi

  log "running database migrations"
  pnpm db:migrate

  initialize_card_data

  log "building server once before watch mode"
  pnpm build:server

  tmux new-window -t "$TMUX_SESSION:" -n tsc-shared "cd '$ROOT_DIR' && pnpm dev:shared:build"
  tmux new-window -t "$TMUX_SESSION:" -n tsc-server "cd '$ROOT_DIR' && pnpm dev:server:build"
  tmux new-window -t "$TMUX_SESSION:" -n api "$(api_command)"
  tmux new-window -t "$TMUX_SESSION:" -n client "cd '$ROOT_DIR/client' && pnpm dev -- --host 0.0.0.0 --port '$FRONTEND_PORT'"
  tmux select-window -t "$TMUX_SESSION:client"
}

main() {
  need_cmd node
  need_cmd pnpm
  need_cmd docker
  need_cmd tmux
  need_cmd curl

  warn_env_file_completeness
  load_env_file
  validate_env

  docker info >/dev/null 2>&1 || die "docker daemon is not reachable"

  stop_existing_environment
  check_ports_available
  start_tmux_environment
  wait_for_api
  register_test_users
  seed_test_admin_decks

  log "ready"
  log "frontend: http://127.0.0.1:${FRONTEND_PORT}"
  log "api:      http://127.0.0.1:${PORT}/api/health"
  log "tmux:     tmux attach -t ${TMUX_SESSION}"
}

main "$@"
