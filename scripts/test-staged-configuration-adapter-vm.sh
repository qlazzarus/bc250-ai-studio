#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
python3 - "$source_dir" <<'PY'
import hashlib
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

source = Path(sys.argv[1])
release = Path(tempfile.mkdtemp(prefix='bc250-config-adapter-', dir='/opt'))
fixture = Path(tempfile.mkdtemp(prefix='bc250-config-adapter-', dir='/etc'))
print('시험 설정 및 검사기 경로:', fixture, release, flush=True)
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
base = source / 'deploy/model-control'
prepare = load('prepare', base / 'prepare-secrets.py')
adapter = load('adapter', base / 'staged-configuration-adapter.py')
startup = load('startup', base / 'start-new-services.py')
prepare.DIRECTORY = fixture / 'credentials'
prepare.main()
shutil.copyfile(base / 'verify-staged-secrets.py', release / 'actual-verifier.py')
for name in ('backup-archive.sh', 'check-service-cgroup.py'):
    shutil.copyfile(base / name, release / name)
checker = release / 'verify-staged-secrets.py'
checker.write_text('import importlib.util\nfrom pathlib import Path\n'
    f's = importlib.util.spec_from_file_location("fixture_verifier", {str(release / "actual-verifier.py")!r})\n'
    'm = importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\n'
    f'm.DIRECTORY = Path({str(prepare.DIRECTORY)!r})\nm.main()\n')
digest = hashlib.sha256(checker.read_bytes()).hexdigest()
check = adapter.ConfigurationCheck(checker, digest)
if check() is not True:
    raise SystemExit('시험 설정 검사가 실패했습니다.')
print('고정 해시 검사기의 별도 시험 설정 검증 확인', flush=True)
calls = []
startup.command = lambda *args, **kwargs: calls.append(args)
runner = startup.NewServiceStart(release / 'backup-archive.sh',
    check_maintenance=lambda: True, check_release=lambda: True,
    check_local_idle=lambda: True, check_configuration=check, expected_client_user='vmtest')
env = prepare.DIRECTORY / 'worker.env'
env.write_text('MODEL_CONTROL_SWITCH_ENABLED=true\n')
try:
    runner.start()
except ValueError:
    pass
else:
    raise SystemExit('전환 활성 설정을 허용했습니다.')
if calls:
    raise SystemExit('설정 오류에도 서비스 명령을 실행했습니다.')
env.write_text('MODEL_CONTROL_SWITCH_ENABLED=false\n')
print('설정 오류 시 실제 기동 로직이 서비스 명령 전 중단 확인', flush=True)
checker.write_text(checker.read_text() + '\n# changed\n')
try:
    check()
except ValueError:
    print('시험 검사기 해시 변경 거절 확인', flush=True)
else:
    raise SystemExit('변경된 검사기를 허용했습니다.')
PY
