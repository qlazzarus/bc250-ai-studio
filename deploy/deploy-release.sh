#!/usr/bin/env bash
# Fast Studio release deployer for a single-operator BC-250 host.
# Install as root-owned /usr/local/sbin/bc250-ai-studio-deploy; see docs/ACTIONS_DEPLOYMENT.md.
#
# This host serves only this Studio and the LLM client and is operated by one
# person, so a release replaces backend and frontend together in one
# stop/start cycle instead of refusing backend changes. The checks that remain
# are the ones that avoid an unrecoverable outage: an unresolved model switch is
# rejected, and code, configuration and database are copied before replacement.
set -Eeuo pipefail

app=/opt/bc250-ai-studio
data=/opt/ai-studio-data
service=bc250-ai-studio.service

[[ $(id -u) -eq 0 && -n ${SUDO_USER:-} ]] || { echo 'Run via sudo as the deploy user.' >&2; exit 1; }
home_dir=$(getent passwd "$SUDO_USER" | cut -d: -f6)
archive="$home_dir/bc250-ai-studio-release.tar.gz"
[[ -f "$archive" && ! -L "$archive" && -d "$app" && -d "$data" && -f /etc/bc250-ai-studio.env ]]
command -v uv >/dev/null

stage=$(mktemp -d /opt/bc250-ai-studio-stage.XXXXXXXX)
backup=''
finish() {
    local status=$?
    rm -rf -- "$stage"
    if (( status != 0 )); then
        echo "Deployment failed (exit $status); backup: ${backup:-not created}." >&2
    fi
}
trap finish EXIT

# Copy first so later changes to the uploaded file cannot affect extraction.
install -m 0600 -- "$archive" "$stage/release.tar.gz"
tar -xzf "$stage/release.tar.gz" -C "$stage"
[[ -f "$stage/pyproject.toml" && -f "$stage/uv.lock" && -f "$stage/backend/app/main.py" \
    && -f "$stage/frontend/dist/index.html" && -f "$stage/config/models.yaml" ]]

# Never replace code over a model switch that did not reach a terminal state;
# that state belongs to the worker and cannot be rebuilt from this release.
journal=/var/lib/bc250-model-control/switch.json
if [[ -f "$journal" ]]; then
    python3 - "$journal" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    if json.load(stream) != {}:
        raise SystemExit('Model switch journal is not clear; inspect state before deploying.')
PY
fi

backup=$(mktemp -d /var/backups/bc250-ai-studio.XXXXXXXX)
chmod 0700 "$backup"
# Studio shutdown waits for the current image boundary; TimeoutStopSec applies.
systemctl stop "$service"

cp -a -- /etc/bc250-ai-studio.env "$backup/studio.env"
cp -a -- "$app/pyproject.toml" "$app/uv.lock" "$backup/"
cp -a -- "$app/config" "$backup/config"
cp -a -- "$app/backend" "$backup/backend"
cp -a -- "$app/frontend/dist" "$backup/dist"
# Consistent copy of the live database. Generated image assets are append-only
# user content and are deliberately not re-copied on every release.
python3 - "$data/database/studio.sqlite3" "$backup/studio.sqlite3" <<'PY'
import sqlite3, sys
source, target = sys.argv[1:3]
with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
PY
echo "Backup: $backup"

# A gate that imports this checkout shares the virtualenv; never resync under it.
gate_runtime=$(systemctl show bc250-llm-gate.service -p ExecStart -p WorkingDirectory || true)
shared_gate_runtime=false
if [[ "$gate_runtime" == *"$app"* ]]; then
    shared_gate_runtime=true
fi

# Dependencies only change when the lock or project file changed; skipping the
# sync is what keeps a code-only release to a few seconds.
sync_needed=false
cmp -s "$backup/pyproject.toml" "$stage/pyproject.toml" || sync_needed=true
cmp -s "$backup/uv.lock" "$stage/uv.lock" || sync_needed=true

for item in backend config/models.yaml frontend/dist pyproject.toml uv.lock; do
    rm -rf -- "$app/$item"
    mkdir -p -- "$(dirname "$app/$item")"
    cp -a -- "$stage/$item" "$app/$item"
done
if command -v restorecon >/dev/null 2>&1; then
    restorecon -RF "$app/backend" "$app/frontend/dist" >/dev/null 2>&1 || true
fi

if [[ "$sync_needed" == true ]]; then
    if [[ "$shared_gate_runtime" == true ]]; then
        echo 'Dependencies changed while a gate shares this virtualenv; restart the gate after the deployment.' >&2
    else
        cd "$app"
        UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy uv sync --locked --no-dev --python /usr/bin/python3
        chmod -R a+rX "$app/.venv"
    fi
fi

systemctl start "$service"
for attempt in {1..30}; do
    if systemctl is-active --quiet "$service" && [[ $(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8090/api/v1/system/health || true) == 401 ]]; then
        systemctl is-active --quiet bc250-llm-gate.service || echo 'Gate is not active: bc250-llm-gate.service' >&2
        echo "Deployment completed; Studio is active and authentication responds. Backup: $backup"
        exit 0
    fi
    sleep 1
done
echo "Health check failed. Restore code and database from $backup if needed." >&2
exit 1