#!/usr/bin/env bash
# Install as root-owned /usr/local/sbin/bc250-ai-studio-deploy; see docs/ACTIONS_DEPLOYMENT.md.
set -Eeuo pipefail

app=/opt/bc250-ai-studio
data=/opt/ai-studio-data
service=bc250-ai-studio.service
[[ $(id -u) -eq 0 && -n ${SUDO_USER:-} ]] || { echo 'Run via sudo as the deploy user.' >&2; exit 1; }
home_dir=$(getent passwd "$SUDO_USER" | cut -d: -f6)
archive="$home_dir/bc250-ai-studio-release.tar.gz"
[[ -f "$archive" && ! -L "$archive" && -d "$app" && -d "$data" && -f /etc/bc250-ai-studio.env ]]
command -v uv >/dev/null
# Model control and Studio share GPU state. A static-only release does not
# stop Studio or touch that state; full releases still require coordination.
model_control=false
for path in /opt/bc250-model-control /etc/bc250-model-control \
    /var/lib/bc250-model-control /var/lib/bc250-llm-gate /run/bc250-gpu \
    /etc/systemd/system/bc250-model-worker.socket \
    /etc/systemd/system/bc250-model-worker.service \
    /etc/systemd/system/bc250-model-api.service \
    /etc/systemd/system/bc250-ai-studio.service.d/studio.conf \
    /etc/systemd/system/bc250-llm-gate.service.d/gate.conf; do
    if [[ -e "$path" || -L "$path" ]]; then model_control=true; fi
done
systemctl is-active --quiet "$service"
stage=$(mktemp -d /opt/bc250-ai-studio-stage.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
# Copy first so changes to the uploaded file cannot affect extraction.
install -m 0600 "$archive" "$stage/release.tar.gz"
tar -xzf "$stage/release.tar.gz" -C "$stage"
[[ -f "$stage/pyproject.toml" && -f "$stage/uv.lock" && -f "$stage/backend/app/main.py" && -f "$stage/frontend/dist/index.html" && -f "$stage/config/models.yaml" ]]

if [[ "$model_control" == true ]]; then
    # Do not silently drop backend or configuration changes from a release.
    # Python caches are generated locally and are not part of the release.
    for item in pyproject.toml uv.lock config/models.yaml; do
        cmp -s "$app/$item" "$stage/$item" || {
            echo "Model-control is active and $item changed; coordinated backend deployment required." >&2; exit 1;
        }
    done
    if ! diff -qr --exclude=__pycache__ --exclude='*.pyc' "$app/backend" "$stage/backend" >/dev/null; then
        echo 'Model-control is active and backend changed; coordinated backend deployment required.' >&2
        exit 1
    fi
    # Keep a rollback copy; only the static web assets are replaced.
    backup=$(mktemp -d /var/backups/bc250-ai-studio-frontend.XXXXXXXX)
    chmod 0700 "$backup"
    cp -a "$app/frontend/dist" "$backup/dist"
    new_dist=$(mktemp -d "$app/frontend/.dist.XXXXXXXX")
    cp -a "$stage/frontend/dist/." "$new_dist/"
    old_dist="$app/frontend/.previous-dist.$$"
    [[ ! -e "$old_dist" ]]
    mv "$app/frontend/dist" "$old_dist"
    if ! mv "$new_dist" "$app/frontend/dist"; then
        mv "$old_dist" "$app/frontend/dist"
        exit 1
    fi
    rm -rf "$old_dist"
    echo "Frontend deployment completed; backup: $backup"
    exit 0
fi

# A separately running gate may still use this checkout and virtualenv. Never
# silently replace its implementation/dependencies during a Studio-only release.
# This covers the current gate's local import closure, including package init.
gate_runtime=$(systemctl show bc250-llm-gate.service -p ExecStart -p WorkingDirectory)
shared_gate_runtime=false
if [[ "$gate_runtime" == *"$app"* ]]; then
    shared_gate_runtime=true
    for item in pyproject.toml uv.lock backend/app/__init__.py \
        backend/app/gate.py backend/app/core/__init__.py \
        backend/app/core/config.py backend/app/core/files.py; do
        if ! cmp -s "$app/$item" "$stage/$item"; then
            echo "Shared gate runtime would change: $item; Studio-only deployment refused before stop." >&2
            echo 'Review a compatible gate update or separate its runtime before deploying this release.' >&2
            exit 1
        fi
    done
    # Do not let uv replace packages or entry points underneath the running gate.
    # The lock and project files match, and the existing runtime must import the
    # dependencies required by the Studio and gate release before we stop Studio.
    "$app/.venv/bin/python" -c 'import alembic, fastapi, httpx, PIL, pydantic_settings, sqlalchemy, uvicorn, yaml'
fi

# systemd shutdown waits for the current image boundary and GPU/LLM recovery.
# A batch can be marked interrupted; TimeoutStopSec in the installed unit still applies.
systemctl stop "$service"
backup=$(mktemp -d /var/backups/bc250-ai-studio.XXXXXXXX)
chmod 0700 "$backup"
cp -a /etc/bc250-ai-studio.env "$backup/"
cp -a "$app" "$backup/source"
cp -a "$data" "$backup/data"
echo "Backup: $backup"

# Preserve server-only files and settings; replace only packaged application files.
for item in backend config/models.yaml frontend/dist pyproject.toml uv.lock; do
    rm -rf "$app/$item"
    mkdir -p "$(dirname "$app/$item")"
    cp -a "$stage/$item" "$app/$item"
done
cd "$app"
if [[ "$shared_gate_runtime" != true ]]; then
    UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy uv sync --locked --no-dev --python /usr/bin/python3
fi
chmod -R a+rX "$app/.venv"
systemctl start "$service"
for attempt in {1..30}; do
    if systemctl is-active --quiet "$service" && [[ $(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8090/api/v1/system/health || true) == 401 ]]; then
        echo 'Deployment completed; service is active and authentication responds.'
        exit 0
    fi
    sleep 1
done
echo "Health check failed. Inspect $service and restore compatible code and data from $backup if needed." >&2
exit 1
