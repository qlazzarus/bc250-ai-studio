#!/bin/sh
# Start an isolated fake backend (+ optional Vite) for prompt-composer browser checks.
#
# Everything is fake and disposable: the data directory is a fresh temp dir, the
# registry is the four-model fixture, and no GPU path is touched. The client key is
# random per run unless STUDIO_API_KEY is supplied, and it is never written to disk.
#
#   BACKEND_PORT=4201 sh scripts/prompt-composer-browser/serve.sh
#     backend only; verify.sh starts Vite itself (default)
#   BACKEND_PORT=4201 WEB_PORT=4206 sh scripts/prompt-composer-browser/serve.sh
#     backend + Vite, prints the app URL
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pc-gap4-data.XXXXXX")
BACKEND_PORT=${BACKEND_PORT:-4201}
WEB_PORT=${WEB_PORT:-0}
API_KEY=${STUDIO_API_KEY:-test-client-key-0123456789abc}
ADMIN_KEY=${STUDIO_ADMIN_KEY:-test-admin-key-0123456789abc}

cd "$ROOT"
STUDIO_DATA_DIR="$DATA_DIR" STUDIO_ENGINE=fake STUDIO_POLICY=image_priority \
STUDIO_REGISTRY_PATH="$ROOT/scripts/prompt-composer-browser/models.fixture.yaml" \
STUDIO_API_KEY="$API_KEY" STUDIO_ADMIN_KEY="$ADMIN_KEY" \
  "$ROOT/.venv/bin/uvicorn" app.main:create_app --factory \
  --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir backend &
BACKEND_PID=$!

ready=0
for _ in $(seq 1 20); do
  if curl -s -m 2 -H "Authorization: Bearer $API_KEY" \
    "http://127.0.0.1:$BACKEND_PORT/api/v1/models" | grep -q 'fake-'; then ready=1; break; fi
  sleep 1
done
if [ "$ready" = 0 ]; then
  echo "backend did not answer on port $BACKEND_PORT (already in use?)" >&2
  kill "$BACKEND_PID" 2>/dev/null || true
  rm -rf "$DATA_DIR"
  exit 1
fi

cd "$ROOT/frontend"
WEB_PID=""
if [ "$WEB_PORT" != 0 ]; then
  VITE_STUDIO_API_KEY="$API_KEY" VITE_STUDIO_TARGET="http://127.0.0.1:$BACKEND_PORT" \
    npm exec vite -- --port "$WEB_PORT" --strictPort &
  WEB_PID=$!
fi

trap 'kill $BACKEND_PID $WEB_PID 2>/dev/null || true; rm -rf "$DATA_DIR"' EXIT INT TERM

echo "data_dir=$DATA_DIR"
echo "backend=http://127.0.0.1:$BACKEND_PORT"
if [ "$WEB_PORT" != 0 ]; then
  echo "app=http://localhost:$WEB_PORT/"
  echo "BACKEND_PORT=$BACKEND_PORT WEB_PORT=$WEB_PORT sh scripts/prompt-composer-browser/verify.sh"
else
  echo "BACKEND_PORT=$BACKEND_PORT WEB_PORT=4206 sh scripts/prompt-composer-browser/verify.sh"
fi
wait
