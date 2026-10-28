#!/bin/sh
set -eu
: "${STUDIO_API_KEY:?Set a client API key (at least 24 characters)}"
: "${STUDIO_ADMIN_KEY:?Set a separate admin API key (at least 24 characters)}"
exec uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8090 --workers 1
