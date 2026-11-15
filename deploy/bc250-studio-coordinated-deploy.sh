#!/usr/bin/env bash
# One-release maintenance deployment. Requires root-owned installation.
# Pinned to the reviewed release; never accepts command-line arguments.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 0 && -n ${SUDO_USER:-} ]] || { echo 'Run via sudo with no arguments.' >&2; exit 1; }
app=/opt/bc250-ai-studio
data=/opt/ai-studio-data
archive=/home/yeppyshiba/bc250-ai-studio-release.tar.gz
expected=9a603d22c51429296f4e914de51c87188132d694921ee6bc372ed7b5f05d52c7
stage=$(mktemp -d /opt/bc250-p4-stage.XXXXXXXX)
backup=''
trap 'result=$?; if (( result != 0 )); then echo "Deployment stopped. Stage: $stage; backup: ${backup:-not-created}. Inspect service and journal state before recovery." >&2; fi' EXIT
[[ -d "$app" && -d "$data" && -f "$archive" && ! -L "$archive" ]]
for service in bc250-ai-studio.service bc250-model-worker.service bc250-model-worker.socket bc250-llm-gate.service; do
  systemctl is-active --quiet "$service" || { echo "Service not active: $service" >&2; exit 1; }
done
install -m 0600 -- "$archive" "$stage/release.tar.gz"
[[ $(sha256sum "$stage/release.tar.gz" | cut -d ' ' -f1) == "$expected" ]] || { echo 'Release hash mismatch; do not deploy.' >&2; exit 1; }
# Validate every tar entry before extraction; disallow links and path escapes.
python3 - "$stage/release.tar.gz" "$stage" <<'PY'
import pathlib, sys, tarfile
archive, root = sys.argv[1:]
seen = set()
size = 0
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    for m in members:
        name = m.name.removeprefix('./')
        p = pathlib.PurePosixPath(name)
        if not name or p.is_absolute() or '..' in p.parts or name in seen:
            raise SystemExit('Invalid or duplicate archive path')
        seen.add(name)
        if not (m.isdir() or m.isfile()) or m.size > 32 * 1024 * 1024:
            raise SystemExit('Unsupported archive entry')
        size += m.size
        if size > 256 * 1024 * 1024:
            raise SystemExit('Archive is too large')
    tar.extractall(root, members=members, filter='data')
PY
for item in pyproject.toml uv.lock config/models.yaml; do
  cmp -s "$app/$item" "$stage/$item" || { echo "Unexpected changed configuration: $item" >&2; exit 1; }
done
[[ -f "$stage/backend/app/main.py" && -f "$stage/frontend/dist/index.html" ]]
# Limit live application changes to the three reviewed P4 files. Test files may differ.
python3 - "$app/backend" "$stage/backend" <<'PY'
import hashlib, pathlib, sys
old, new = map(pathlib.Path, sys.argv[1:])
allowed = {'app/api/routes.py', 'app/models/schemas.py', 'app/services/registry.py'}
def files(root):
    result = {}
    for p in root.rglob('*'):
        rel = p.relative_to(root)
        if rel.parts[0] == 'tests' or '__pycache__' in rel.parts or p.suffix == '.pyc':
            continue
        if p.is_symlink():
            raise SystemExit('Symlink in backend is not supported')
        if p.is_file():
            result[rel.as_posix()] = hashlib.sha256(p.read_bytes()).digest()
    return result
a, b = files(old), files(new)
changed = {key for key in a.keys() | b.keys() if a.get(key) != b.get(key)}
if not changed or not changed <= allowed:
    raise SystemExit('Unexpected backend change; use a separately reviewed release')
PY
# Stop new model-control socket connections, then wait for the worker to finish.
echo 'Stopping model-control socket and worker; requests may be unavailable.'
systemctl stop bc250-model-worker.socket
systemctl stop bc250-model-worker.service
systemctl is-active --quiet bc250-model-worker.socket && { echo 'Socket did not stop' >&2; exit 1; }
systemctl is-active --quiet bc250-model-worker.service && { echo 'Worker did not stop' >&2; exit 1; }
# Worker is stopped: do not deploy over an interrupted or unresolved switch.
python3 - <<'PY'
import json, sqlite3
from pathlib import Path
if json.loads(Path('/var/lib/bc250-model-control/switch.json').read_text()) != {}:
    raise SystemExit('Switch journal is not clear; preserve state and inspect')
path = '/var/lib/bc250-model-control/operations.sqlite3'
with sqlite3.connect('file:' + path + '?mode=ro', uri=True) as db:
    row = db.execute("SELECT 1 FROM switch_operations WHERE state IS NULL OR state NOT IN "
                     "('succeeded','failed','failed_rolled_back') LIMIT 1").fetchone()
    if row:
        raise SystemExit('Unresolved model switch; preserve state and inspect')
PY
echo 'Stopping Studio at the next image boundary.'
systemctl stop bc250-ai-studio.service
systemctl is-active --quiet bc250-ai-studio.service && { echo 'Studio did not stop' >&2; exit 1; }
# A graceful stop can still leave a persisted recovery problem; refuse replacement.
python3 - <<'PYCHECK'
import json, sqlite3
path = '/opt/ai-studio-data/database/studio.sqlite3'
with sqlite3.connect('file:' + path + '?mode=ro', uri=True) as db:
    for key, value in db.execute("SELECT key, value FROM system_state WHERE key IN ('transition', 'recovery')"):
        if json.loads(value):
            raise SystemExit(f'Studio {key} is not clear; preserve state and inspect')
    if db.execute("SELECT 1 FROM jobs WHERE status IN ('running', 'waiting_for_gpu') LIMIT 1").fetchone():
        raise SystemExit('Studio has an unresolved active job')
PYCHECK
# Cooperating GPU users must be idle before backup and replacement.
exec 9<>/run/bc250-gpu/gpu.lock
flock -n 9 || { echo 'GPU lock is busy; services remain stopped.' >&2; exit 1; }
backup=$(mktemp -d /var/backups/bc250-p4-studio.XXXXXXXX)
cp -a -- "$app/backend" "$backup/backend"
cp -a -- "$app/frontend/dist" "$backup/dist"
cp -a -- "$data" "$backup/data"
cp -a -- /etc/bc250-ai-studio.env "$backup/studio.env"
echo "Backup: $backup"
# Replace only packaged Studio backend and static frontend; keep the venv and config.
rm -rf -- "$app/backend" "$app/frontend/dist"
cp -a -- "$stage/backend" "$app/backend"
cp -a -- "$stage/frontend/dist" "$app/frontend/dist"
restorecon -RF "$app/backend" "$app/frontend/dist"
flock -u 9
exec 9>&-
systemctl start bc250-ai-studio.service
for i in {1..30}; do
  if systemctl is-active --quiet bc250-ai-studio.service && [[ $(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8090/api/v1/system/health) == 401 ]]; then break; fi
  sleep 1
done
systemctl is-active --quiet bc250-ai-studio.service
[[ $(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8090/api/v1/system/health) == 401 ]] || { echo 'Studio authentication health check failed' >&2; exit 1; }
# This check requires no access to credentials. Authenticated capability and
# end-to-end job verification must be performed through the Studio UI afterwards.
grep -q '"prompt_composition": {"schema_versions": \[1\]}' "$app/backend/app/api/routes.py" || { echo 'P4 capability source not found' >&2; exit 1; }
systemctl start bc250-model-worker.socket
systemctl start bc250-model-worker.service
systemctl is-active --quiet bc250-model-worker.socket
systemctl is-active --quiet bc250-model-worker.service
systemctl is-active --quiet bc250-llm-gate.service
echo "Studio started with P4 source. Authenticate in Studio to verify capability and a test job. Backup: $backup"
rm -rf -- "$stage"
