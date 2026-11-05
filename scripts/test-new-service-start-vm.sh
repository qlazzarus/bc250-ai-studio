#!/usr/bin/env bash
# Called only by the isolated VM service fixture after its temporary drop-ins exist.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 3 && -f $1/deploy/model-control/start-new-services.py \
  && -x $2/.venv/bin/python && -d $3 ]] || exit 1
source_dir=$1
worker=$2
entry=$3
unit=/run/systemd/system/bc250-llm-client.service
[[ ! -e $unit && ! -L $unit && ! -e /etc/systemd/system/bc250-llm-client.service ]] || {
  echo '시험 Client unit이 이미 존재합니다.' >&2; exit 1;
}
for port in 8080 8081 8090 8091; do
  [[ -z $(ss -H -ltn "sport = :$port") ]] || { echo "시험 포트 사용 중: $port" >&2; exit 1; }
done
evidence=$(mktemp -d /var/backups/bc250-startup-phases.XXXXXXXX)
trap 'echo "시험 중단. 시험 서비스·보류와 기록을 보존합니다: $evidence $entry" >&2' ERR
for path in /var/lib/bc250-model-control/switch.json \
  /var/lib/bc250-model-control/operations.sqlite3 \
  /var/lib/bc250-model-control/operations.sqlite3-wal \
  /var/lib/bc250-model-control/operations.sqlite3-shm \
  /var/lib/bc250-llm-gate/holds.json; do
  if [[ -e $path ]]; then
    [[ -f $path && ! -L $path ]] || exit 1
    cp -a -- "$path" "$evidence/"
  fi
done
install -o root -g root -m 0644 "$source_dir/deploy/model-control/start-new-services.py" "$entry/"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/backup-archive.sh" "$entry/"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/check-service-cgroup.py" "$entry/"
install -o root -g root -m 0644 "$source_dir/systemd/bc250-gpu-lock.conf" "$entry/"
cat > "$unit" <<'EOF'
[Unit]
Description=Disposable client process for staged startup test
[Service]
Type=simple
User=vmtest
Group=vmtest
EnvironmentFile=/etc/bc250-model-control/client-gate.env
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
restorecon -RF "$entry"
restorecon -F "$unit"
systemctl daemon-reload
python3 - "$entry" "$worker" "$evidence" "$source_dir" <<'PY'
import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
from pathlib import Path

entry, worker, evidence, source = map(Path, sys.argv[1:])
if json.loads((evidence / 'switch.json').read_text()) != {}:
    raise SystemExit('시험 journal이 비어 있지 않습니다.')
before = set(json.loads((evidence / 'holds.json').read_text())['holds'])
dbfile = evidence / 'operations.sqlite3'
if dbfile.exists():
    with sqlite3.connect(dbfile.as_uri() + '?mode=ro', uri=True) as db:
        pending = db.execute("SELECT COUNT(*) FROM switch_operations WHERE state IN "
                             "('queued','waiting_for_gpu','pausing','draining','switching',"
                             "'verifying','rolling_back','recovery_required')").fetchone()[0]
    if pending:
        raise SystemExit('시험 작업 DB에 미완료 작업이 있습니다.')
spec = importlib.util.spec_from_file_location('startup', entry / 'start-new-services.py')
startup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(startup)
startup.PYTHON = worker / '.venv/bin/python'
startup.TMPFILES = entry / 'bc250-gpu-lock.conf'
startup.ENABLE_LINKS = (entry / 'fixture-enable-socket', entry / 'fixture-enable-api')
original_command = startup.command
simulated = []
commands = []
def fixture_command(args, **kwargs):
    commands.append(args)
    if len(args) > 1 and args[0] == '/usr/bin/systemctl' and args[1] in ('enable', 'is-enabled'):
        simulated.append(args[1])
        return
    if len(args) > 3 and args[2:4] == ['-m', 'app.services.gate_admin']:
        subprocess.run([str(startup.PYTHON), '-I', str(source / 'scripts/trace-startup-confirm-vm.py')],
                       check=True, timeout=kwargs.get('timeout', 60))
        return
    return original_command(args, **kwargs)
startup.command = fixture_command
def load(name, path):
    module_spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module
prepare = load('prepare_secrets', source / 'deploy/model-control/prepare-secrets.py')
verify = load('verify_secrets', source / 'deploy/model-control/verify-staged-secrets.py')
config_evidence = Path(tempfile.mkdtemp(prefix='bc250-start-config-', dir='/etc'))
prepare.DIRECTORY = verify.DIRECTORY = config_evidence / 'credentials'
prepare.main()
def check_configuration():
    verify.main()
    return True
runner = startup.NewServiceStart(entry / 'backup-archive.sh', check_maintenance=lambda: True,
    check_release=lambda: True, check_local_idle=lambda: True, check_running=lambda: True,
    check_configuration=check_configuration, expected_client_user='vmtest')
worker_env = verify.DIRECTORY / 'worker.env'
worker_env.write_text('MODEL_CONTROL_SWITCH_ENABLED=true\n')
try:
    runner.start()
except ValueError:
    pass
else:
    raise SystemExit('전환 활성 설정으로 서비스 시작을 허용했습니다.')
finally:
    worker_env.write_text('MODEL_CONTROL_SWITCH_ENABLED=false\n')
if commands or subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', 'bc250-llm-gate.service']).returncode == 0:
    raise SystemExit('설정 거절 전에 시험 gate가 시작됐습니다.')
print('전환 활성 설정은 시험 서비스 시작 전에 거절 확인', flush=True)
subprocess.run(['/usr/bin/systemctl', 'start', 'llama-server.service'], check=True, timeout=90)
runner.start()
try:
    runner.finish()
except subprocess.CalledProcessError as error:
    expected = [str(startup.PYTHON), '-I', '-m', 'app.services.client_gate_check',
                '--expected-user', 'vmtest']
    if error.cmd != expected:
        raise SystemExit('Client 검사 이전의 다른 명령이 실패했습니다.') from None
else:
    raise SystemExit('Client 수동 재시작 전 검증을 잘못 허용했습니다.')
holds = json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds']
if 'startup' not in holds or simulated:
    raise SystemExit('Client 확인 실패 후 startup 보류 또는 enable 순서가 다릅니다.')
print('시험 Client 시작 전 검증 거절과 startup 보류 확인', flush=True)
subprocess.run(['/usr/bin/systemctl', 'start', 'bc250-llm-client.service'], check=True, timeout=90)
for attempt in range(60):
    try:
        startup.api_ready()
        break
    except (OSError, urllib.error.HTTPError, startup.StartupError):
        time.sleep(2)
else:
    raise SystemExit('시험 관리 API 준비 시간 초과')
runner.finish()
if simulated.count('enable') != 1 or simulated.count('is-enabled') != 2:
    raise SystemExit('시험 enable 호출 순서가 올바르지 않습니다.')
after = set(json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds'])
if 'startup' in after or not (before - {'startup'}).issubset(after):
    raise SystemExit('시험 startup 해제 또는 기존 보류 보존 확인 실패')
print('시험 Client 수동 시작 후 인증·전환 비활성·startup 해제 및 기존 보류 확인', flush=True)
print('유지보수·로컬 유휴 검사와 서비스 enable은 시험에서 모의했습니다.', flush=True)
PY
systemctl stop bc250-model-api.service bc250-model-worker.socket bc250-model-worker.service \
  bc250-llm-client.service bc250-ai-studio.service bc250-llm-gate.service llama-server.service
# Re-establish the VM's startup hold; keep prior legacy/admin holds intact.
systemctl start bc250-llm-gate.service
python3 - <<'PY'
import json
import time
from pathlib import Path

for _ in range(60):
    try:
        if 'startup' in json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds']:
            break
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(1)
else:
    raise SystemExit('시험 gate의 startup 보류 생성 시간 초과')
PY
systemctl stop bc250-llm-gate.service
python3 - "$evidence/holds.json" <<'PY'
import json
import sys
from pathlib import Path
old = set(json.loads(Path(sys.argv[1]).read_text())['holds'])
new = set(json.loads(Path('/var/lib/bc250-llm-gate/holds.json').read_text())['holds'])
if not old.issubset(new) or 'startup' not in new:
    raise SystemExit('시험 전 gate 보류 복원을 확인하지 못했습니다.')
print('시험 전 gate 보류와 startup 보류 유지 확인', flush=True)
PY
rm -- "$unit"
systemctl daemon-reload
echo "신규 서비스 기동 단계 시험 완료; 상태 기록 보관: $evidence"
