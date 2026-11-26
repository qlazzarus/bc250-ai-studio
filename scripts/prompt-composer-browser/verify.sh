#!/bin/sh
# Run the GAP04 suite: start the fake backend and Vite, execute the CDP harness, clean up.
#
# Everything is disposable: a fresh temp data dir, the four-model fake fixture, and a
# throwaway browser profile. Nothing points at production and no real key is used.
#
#   BACKEND_PORT=4201 WEB_PORT=4206 sh scripts/prompt-composer-browser/verify.sh
#
# `serve.sh` on another port can be reused instead by setting APP_URL, in which case
# this script skips starting its own servers.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BACKEND_PORT=${BACKEND_PORT:-4201}
WEB_PORT=${WEB_PORT:-4206}
API_KEY=${STUDIO_API_KEY:-test-client-key-0123456789abc}
OUT=${OUT:-docs/evidence/prompt-composer-gap04}
DATA_DIR=""

cd "$ROOT"
if [ -z "${APP_URL:-}" ]; then
  DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pc-gap4-data.XXXXXX")
  # Keep operation fixtures cancellable through the browser's polling and held-request checks.
  STUDIO_DATA_DIR="$DATA_DIR" STUDIO_ENGINE=fake STUDIO_POLICY=image_priority STUDIO_FAKE_DELAY="${STUDIO_FAKE_DELAY:-8}" \
  STUDIO_REGISTRY_PATH="$ROOT/scripts/prompt-composer-browser/models.fixture.yaml" \
  STUDIO_API_KEY="$API_KEY" STUDIO_ADMIN_KEY="${STUDIO_ADMIN_KEY:-test-admin-key-0123456789abc}" \
    "$ROOT/.venv/bin/uvicorn" app.main:create_app --factory \
    --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir backend \
    > "${TMPDIR:-/tmp}/pc-gap4-backend-$BACKEND_PORT.log" 2>&1 &
  BACKEND_PID=$!
  trap 'kill $BACKEND_PID $WEB_PID 2>/dev/null || true; [ -n "$DATA_DIR" ] && rm -rf "$DATA_DIR"' EXIT INT TERM

  ready=0
  for _ in $(seq 1 25); do
    if curl -s -m 2 -H "Authorization: Bearer $API_KEY" \
      "http://127.0.0.1:$BACKEND_PORT/api/v1/models" | grep -q 'fake-'; then ready=1; break; fi
    sleep 1
  done
  if [ "$ready" = 0 ]; then
    echo "backend did not serve the fake fixture on port $BACKEND_PORT" >&2
    exit 1
  fi

  cd "$ROOT/frontend"
  VITE_STUDIO_API_KEY="$API_KEY" VITE_STUDIO_TARGET="http://127.0.0.1:$BACKEND_PORT" \
    npm exec vite -- --port "$WEB_PORT" --strictPort \
    > "${TMPDIR:-/tmp}/pc-gap4-vite-$WEB_PORT.log" 2>&1 &
  WEB_PID=$!
  trap 'kill $BACKEND_PID $WEB_PID 2>/dev/null || true; [ -n "$DATA_DIR" ] && rm -rf "$DATA_DIR"' EXIT INT TERM

  for _ in $(seq 1 30); do
    if curl -s -m 2 -o /dev/null "http://localhost:$WEB_PORT/"; then break; fi
    sleep 1
  done
  APP_URL="http://localhost:$WEB_PORT/"
fi

cd "$ROOT"
APP_URL="$APP_URL" CDP_PORT=${CDP_PORT:-9410} \
SHOT_DIR="$OUT" RESULT_FILE="$OUT/results.json" \
  node scripts/prompt-composer-browser/run.mjs
