#!/usr/bin/env bash
# Simulated failed migration: legacy gate, archived files, owned gate, rollback.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || {
  echo 'SELinux가 켜진 시험 VM의 root에서만 실행할 수 있습니다.' >&2; exit 1;
}
[[ $# == 1 && -f $1/deploy/model-control/migrate-legacy-gate.py \
  && -f $1/deploy/model-control/backup-archive.sh \
  && -f $1/deploy/model-control/verify-backup.py \
  && -f $1/deploy/model-control/restore-backup-to-stage.sh ]] || exit 1
source_dir=$1
original=/var/tmp/bc250-backup-archive-test.jHO1rD8O
[[ -f $original/source/etc/bc250-ai-studio.env && -f $original/Caddyfile.original ]] || exit 1
unit=bc250-migration-rollback-fixture.service
unit_path=/run/systemd/system/$unit
[[ ! -e $unit_path && ! -e /etc/systemd/system/$unit ]] || exit 1
[[ -z $(ss -H -ltn 'sport = :18882') ]] || { echo '시험 포트가 사용 중입니다.' >&2; exit 1; }
fixture=$(mktemp -d /var/tmp/bc250-migration-rollback.XXXXXXXX)
trap 'echo "시험 중단. 시험 서비스와 기록을 보존합니다: $fixture" >&2' ERR
cat > "$unit_path" <<EOF
[Service]
EnvironmentFile=$fixture/gate.env
ExecStart=/opt/bc250-model-control/.venv/bin/python -I -m uvicorn app.gate:create_gate_app --factory --host 127.0.0.1 --port 18882 --workers 1 --no-access-log
KillMode=control-group
EOF
systemctl daemon-reload
python3 - "$source_dir" "$original" "$fixture" "$unit" <<'PY'
import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path

source, original, fixture = map(Path, sys.argv[1:4])
unit = sys.argv[4]
spec = importlib.util.spec_from_file_location('migration', source / 'deploy/model-control/migrate-legacy-gate.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
migration.URL = 'http://127.0.0.1:18882/control'
old_key = 'vm-legacy-only-key-0123456789abcdef'
new_key = 'vm-owned-admin-key-0123456789abcdef'
studio_key = 'vm-owned-studio-key-0123456789abcde'
switch_key = 'vm-owned-switch-key-0123456789abcde'
env = fixture / 'gate.env'

def systemctl(*args):
    subprocess.run(['systemctl', *args], check=True, timeout=90)

def ready(key):
    for _ in range(36):
        try:
            return migration.request(key, 'GET')
        except OSError:
            time.sleep(5)
    raise SystemExit('시험 gate 시작 시간 초과')

def gate_config(owned_path=None):
    lines = ['GATE_API_KEY=' + (new_key if owned_path else old_key)]
    if owned_path:
        lines += ['GATE_OWNED_CONTROL=true', 'GATE_STATE_PATH=' + str(owned_path),
                  'GATE_STUDIO_KEY=' + studio_key, 'GATE_SWITCH_KEY=' + switch_key]
    env.write_text('\n'.join(lines) + '\n')
    env.chmod(0o600)

for originally_paused in (False, True):
    case = fixture / ('paused' if originally_paused else 'open')
    case.mkdir(mode=0o700)
    subprocess.run(['cp', '-a', str(original / 'source'), str(case / 'live')], check=True)
    caddy = case / 'Caddyfile.original'
    subprocess.run(['cp', '-a', str(original / 'Caddyfile.original'), str(caddy)], check=True)
    live = case / 'live'
    snapshot = live / 'var/lib/bc250-model-control/legacy-pause.json'
    snapshot.unlink()
    gate_config()
    systemctl('start', unit)
    ready(old_key)
    migration.request(old_key, 'PUT', {'paused': originally_paused})
    assert migration.capture(old_key, snapshot)['paused'] is True
    systemctl('stop', unit)
    backup = Path(subprocess.check_output(
        ['mktemp', '-d', '/var/backups/bc250-migration-fixture.XXXXXXXX'], text=True).strip())
    subprocess.run(['bash', '-c', 'source "$1"; bc250_backup_archive "$2" "$3" "$4"',
                    'fixture', str(source / 'deploy/model-control/backup-archive.sh'),
                    str(live), str(backup), str(caddy)], check=True)
    owned_dir = case / 'owned-gate'
    migration.create_state(snapshot, owned_dir)
    gate_config(owned_dir / 'holds.json')
    systemctl('start', unit)
    state = ready(new_key)
    expected = {'startup', 'legacy'} if originally_paused else {'startup'}
    assert state['paused'] and set(state['holds']) == expected
    print('새 시험 gate 시작 보류와 기존 pause 이전 확인:', originally_paused, flush=True)
    (live / 'opt/bc250-ai-studio/backend/main.py').write_text('failed migration\n')
    (live / 'opt/ai-studio-data/data.db').write_text('changed data\n')
    systemctl('stop', unit)
    output = subprocess.check_output(
        ['bash', str(source / 'deploy/model-control/restore-backup-to-stage.sh'), str(backup)], text=True)
    stage = next(Path(line.split(': ', 1)[1]) for line in output.splitlines()
                 if line.startswith('복원 확인 경로: '))
    for relative in ('opt/bc250-ai-studio', 'opt/ai-studio-data'):
        path = live / relative
        path.rename(case / ('changed-' + path.name))
        subprocess.run(['cp', '-a', str(stage / 'files' / relative), str(path.parent)], check=True)
    for relative in ('opt/bc250-ai-studio/backend/main.py', 'opt/ai-studio-data/data.db'):
        assert (live / relative).read_bytes() == (original / 'source' / relative).read_bytes()
    restored_snapshot = stage / 'files/var/lib/bc250-model-control/legacy-pause.json'
    assert json.loads(restored_snapshot.read_text())['paused_before_maintenance'] is originally_paused
    gate_config()
    systemctl('start', unit)
    ready(old_key)
    assert migration.restore_pause(old_key, restored_snapshot)['paused'] is originally_paused
    systemctl('stop', unit)
    print('시험 코드·데이터 복원과 이전 gate pause 복원 확인:', originally_paused, flush=True)
    print('시험 백업 보관:', backup, flush=True)
PY
rm -- "$unit_path"
systemctl daemon-reload
echo "시험 서비스 정리 완료. 시험 기록 보관: $fixture"
