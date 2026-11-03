#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing \
  && ( $# == 1 || ( $# == 2 && $2 == failure-only ) ) ]] || exit 1
source_dir=$1
mode=${2:-full}
cache_source=/home/vmtest/bc250-test-source/uv-cache
if [[ $mode == full ]]; then
  [[ -d $cache_source && ! -L $cache_source ]] || { echo '시험 의존성 캐시가 없습니다.' >&2; exit 1; }
fi
release=$(mktemp -d /opt/bc250-model-code-source.XXXXXXXX)
cache=$(mktemp -d /var/cache/bc250-model-code-cache.XXXXXXXX)
trap 'echo "시험 중단. 시험 소스와 캐시를 보존합니다: $release $cache" >&2' ERR
chmod 0755 "$release"
mkdir -p "$release/deploy/model-control"
cp -a --no-preserve=ownership "$source_dir/backend" "$release/backend"
install -o root -g root -m 0644 "$source_dir/pyproject.toml" "$source_dir/uv.lock" "$release/"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/install-model-code.py" \
  "$source_dir/deploy/model-control/install-studio-release.py" "$release/deploy/model-control/"
chmod -R a+rX,go-w "$release"
if [[ $mode == full ]]; then cp -a --no-preserve=ownership "$cache_source/." "$cache/"; fi
chmod -R go-w "$cache"
restorecon -RF "$release" "$cache"
python3 - "$release" "$cache" "$mode" <<'PY'
import importlib.util
import secrets
import string
import subprocess
import sys
import tempfile
from pathlib import Path

release, cache = map(Path, sys.argv[1:3])
mode = sys.argv[3]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('model_installer', release / 'deploy/model-control/install-model-code.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def candidate():
    return Path('/opt/bc250-model-code-fixture.' + ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(8)))
target = candidate()
print('시험 모델 코드 경로:', target, flush=True)
try:
    module.install(release, target, cache, check_ready=lambda: False, offline=True)
except ValueError as exc:
    if '설치 준비 상태를 확인하지 못했습니다' not in str(exc):
        raise
else:
    raise SystemExit('준비 검사 실패가 거절되지 않았습니다.')
if target.exists():
    raise SystemExit('준비 검사 실패 전에 시험 대상이 생성됐습니다.')
if mode == 'full':
    module.install(release, target, cache, check_ready=lambda: True, offline=True)
    print('시험 모델 제어 패키지의 비편집 설치와 가상환경 내 import 확인', flush=True)
    subprocess.run(['/usr/sbin/runuser', '-u', 'ai-studio', '--', str(target / '.venv/bin/python'),
                    '-I', '-c', 'import app.gate, app.services.model_management_server'], check=True)
    print('시험 서비스 계정의 설치 패키지 접근 확인', flush=True)
else:
    target.mkdir(mode=0o755)
    (target / 'existing.marker').write_text('preserve')
failure_cache = Path(tempfile.mkdtemp(prefix='bc250-model-failure-cache-', dir='/var/cache'))
print('실패 주입용 빈 캐시:', failure_cache, flush=True)
try:
    module.install(release, target, failure_cache, check_ready=lambda: True, offline=True)
except ValueError as exc:
    if '기존 모델 제어 설치가 있습니다' not in str(exc):
        raise
else:
    raise SystemExit('기존 시험 대상 재사용을 허용했습니다.')
print('설치 전 준비 검사 실패 및 기존 시험 대상 덮어쓰기 거절 확인', flush=True)
failed = candidate()
original_run = module.subprocess.run
def fail_uv(args, **kwargs):
    if args[0] == '/usr/bin/uv':
        raise subprocess.CalledProcessError(1, args)
    return original_run(args, **kwargs)
module.subprocess.run = fail_uv
try:
    module.install(release, failed, failure_cache, check_ready=lambda: True, offline=True)
except subprocess.CalledProcessError:
    pass
else:
    raise SystemExit('가상환경 설치 실패를 감지하지 못했습니다.')
finally:
    module.subprocess.run = original_run
existing = target / ('.venv/bin/python' if mode == 'full' else 'existing.marker')
if not (failed / 'backend/app/main.py').is_file() or not existing.is_file():
    raise SystemExit('실패한 시험 후보 또는 기존 성공 후보가 보존되지 않았습니다.')
print('시험 가상환경 설치 실패 시 부분 후보와 기존 성공 후보 보존 확인', flush=True)
print(f'실패 주입 시험 대상 보관: {failed}', flush=True)
print(f'시험 대상 보관: {target}', flush=True)
PY
echo "시험 소스와 캐시 보관: $release $cache"
