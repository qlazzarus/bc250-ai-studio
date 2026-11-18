#!/bin/sh
# EVAL-UX01 browser arm: fake backend + Vite + CDP. Same shape as
# scripts/prompt-composer-browser/verify.sh, but only measures the click path.
#
#   sh scripts/eval-ux01/browser.sh
#
# Disposable: fresh temp data directory, fake fixture, throwaway browser profile.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
BACKEND_PORT=${BACKEND_PORT:-4211}
WEB_PORT=${WEB_PORT:-4216}
API_KEY=${STUDIO_API_KEY:-test-client-key-0123456789abc}
OUT=${OUT:-docs/evidence/prompt-composer-eval-ux01}
DATA_DIR=""

cd "$ROOT"
if [ -z "${APP_URL:-}" ]; then
  DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pc-eval-data.XXXXXX")
  STUDIO_DATA_DIR="$DATA_DIR" STUDIO_ENGINE=fake STUDIO_POLICY=image_priority \
  STUDIO_REGISTRY_PATH="$ROOT/scripts/prompt-composer-browser/models.fixture.yaml" \
  STUDIO_API_KEY="$API_KEY" STUDIO_ADMIN_KEY="${STUDIO_ADMIN_KEY:-test-admin-key-0123456789abc}" \
    "$ROOT/.venv/bin/uvicorn" app.main:create_app --factory \
    --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir backend \
    > "${TMPDIR:-/tmp}/pc-eval-backend-$BACKEND_PORT.log" 2>&1 &
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
    > "${TMPDIR:-/tmp}/pc-eval-vite-$WEB_PORT.log" 2>&1 &
  WEB_PID=$!
  trap 'kill $BACKEND_PID $WEB_PID 2>/dev/null || true; [ -n "$DATA_DIR" ] && rm -rf "$DATA_DIR"' EXIT INT TERM

  for _ in $(seq 1 30); do
    if curl -s -m 2 -o /dev/null "http://localhost:$WEB_PORT/"; then break; fi
    sleep 1
  done
  APP_URL="http://localhost:$WEB_PORT/"
fi

cd "$ROOT"
APP_URL="$APP_URL" CDP_PORT=${CDP_PORT:-9421} OUT_DIR="$OUT" \
  node --experimental-strip-types scripts/eval-ux01/browser.mjs