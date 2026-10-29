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
systemctl is-active --quiet "$service"
stage=$(mktemp -d /opt/bc250-ai-studio-stage.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
# Copy first so changes to the uploaded file cannot affect extraction.
install -m 0600 "$archive" "$stage/release.tar.gz"
tar -xzf "$stage/release.tar.gz" -C "$stage"
[[ -f "$stage/pyproject.toml" && -f "$stage/uv.lock" && -f "$stage/backend/app/main.py" && -f "$stage/frontend/dist/index.html" && -f "$stage/config/models.yaml" ]]

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
UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy uv sync --locked --no-dev --python /usr/bin/python3
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
