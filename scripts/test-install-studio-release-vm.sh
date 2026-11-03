#!/usr/bin/env bash
# Install only to disposable VM paths with the existing offline dependency cache.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ ( $# == 1 || ( $# == 2 && ( $2 == failure-only || $2 == config-mismatch-only ) ) ) && -f $1/deploy/model-control/install-studio-release.py \
  && -f $1/frontend/dist/index.html && -f $1/config/models.yaml ]] || exit 1
mode=${2:-full}
cache_source=/home/vmtest/bc250-test-source/uv-cache
if [[ $mode == full ]]; then
  [[ -d $cache_source && ! -L $cache_source ]] || { echo '시험 의존성 캐시가 없습니다.' >&2; exit 1; }
fi
fixture=$(mktemp -d /var/backups/bc250-studio-install-test.XXXXXXXX)
release=$(mktemp -d /opt/bc250-studio-release-source.XXXXXXXX)
cache=$(mktemp -d /var/cache/bc250-studio-install-cache.XXXXXXXX)
chmod 0755 "$release"
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture $release $cache" >&2' ERR
mkdir -p "$release/frontend" "$release/config" "$release/deploy/model-control"
cp -R --no-preserve=ownership "$1/backend" "$release/backend"
cp -R --no-preserve=ownership "$1/frontend/dist" "$release/frontend/dist"
install -o root -g root -m 0644 "$1/config/models.yaml" "$release/config/models.yaml"
install -o root -g root -m 0644 "$1/pyproject.toml" "$1/uv.lock" "$release/"
for name in install-studio-release.py restore-legacy-files.py; do
  install -o root -g root -m 0644 "$1/deploy/model-control/$name" "$release/deploy/model-control/$name"
done
if [[ $mode == full ]]; then cp -a --no-preserve=ownership "$cache_source/." "$cache/"; fi
chmod -R a+rX,go-w "$release"
chmod -R go-w "$cache"
restorecon -RF "$release" "$cache"
python3 - "$fixture" "$release" "$cache" "$mode" <<'PY'
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

fixture, release, cache = map(Path, sys.argv[1:4])
mode = sys.argv[4]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
installer = load('studio_install', release / 'deploy/model-control/install-studio-release.py')
compare = load('restore_compare', release / 'deploy/model-control/restore-legacy-files.py')._same

def setup(name):
    print('시험 단계:', name, flush=True)
    app = Path(tempfile.mkdtemp(prefix='bc250-studio-fixture-', dir='/opt'))
    print('시험 Studio 경로:', app, flush=True)
    saved = Path(tempfile.mkdtemp(prefix='bc250-studio-saved-', dir='/opt'))
    print('시험 이전 파일 보존 경로:', saved, flush=True)
    for path in (app / 'backend', app / 'config', app / 'frontend/dist', app / '.venv'):
        path.mkdir(parents=True, mode=0o700)
    app.chmod(0o755)
    (app / 'config').chmod(0o755)
    (app / 'frontend').chmod(0o755)
    (app / 'backend/old.py').write_text('old backend')
    (app / 'config/models.yaml').write_bytes((release / 'config/models.yaml').read_bytes())
    (app / 'config/server-only.txt').write_text('preserve config')
    (app / 'frontend/dist/index.html').write_text('old frontend')
    (app / 'frontend/server-only.txt').write_text('preserve frontend')
    (app / '.venv/old.marker').write_text('old venv')
    (app / 'pyproject.toml').write_text('old project')
    (app / 'uv.lock').write_text('old lock')
    return app, saved

if mode == 'config-mismatch-only':
    app, saved = setup('config-mismatch')
    (app / 'config/models.yaml').write_text('different fixture configuration')
    try:
        installer.install(release, app, saved, cache, check_ready=lambda: True, compare=compare, offline=True)
    except ValueError as exc:
        if '모델 설정이 릴리스와 다릅니다' not in str(exc):
            raise
    else:
        raise SystemExit('서로 다른 시험 모델 설정이 허용됐습니다.')
    assert not any(saved.iterdir())
    assert (app / 'backend/old.py').read_text() == 'old backend'
    assert (app / 'config/models.yaml').read_text() == 'different fixture configuration'
    print('서로 다른 시험 Studio 모델 설정을 설치 전 거절하고 원본 보존 확인', flush=True)
    raise SystemExit(0)

if mode == 'full':
    app, saved = setup('success')
    installer.install(release, app, saved, cache, check_ready=lambda: True, compare=compare, offline=True)
    assert (app / 'config/server-only.txt').read_text() == 'preserve config'
    assert (app / 'frontend/server-only.txt').read_text() == 'preserve frontend'
    assert (saved / 'previous/backend/old.py').read_text() == 'old backend'
    assert (saved / 'previous/.venv/old.marker').read_text() == 'old venv'
    assert (app / 'config/models.yaml').read_bytes() == (release / 'config/models.yaml').read_bytes()
    subprocess.run(['/usr/sbin/runuser', '-u', 'ai-studio', '--', str(app / '.venv/bin/python'),
                    '-I', '-c', 'from pathlib import Path; import app; from app.core.config import ROOT; '
                    'assert (ROOT / "config/models.yaml").is_file(); '
                    'assert (ROOT / "frontend/dist/index.html").is_file()'], check=True)
    print('시험 Studio 최종 경로의 소스·가상환경 및 서버 전용 파일 보존 확인', flush=True)
    print('시험 Studio 계정의 신규 패키지와 설정 경로 접근 확인', flush=True)

app, saved = setup('uv-failure')
failure_cache = Path(tempfile.mkdtemp(prefix='bc250-studio-failure-cache-', dir='/var/cache'))
print('시험 실패 주입용 빈 캐시:', failure_cache, flush=True)
original_run = installer.subprocess.run
def fail_uv(args, **kwargs):
    if args[0] == '/usr/bin/uv':
        raise subprocess.CalledProcessError(1, args)
    return original_run(args, **kwargs)
installer.subprocess.run = fail_uv
try:
    installer.install(release, app, saved, failure_cache, check_ready=lambda: True, compare=compare, offline=True)
except subprocess.CalledProcessError:
    pass
else:
    raise SystemExit('시험 가상환경 설치 실패를 감지하지 못했습니다.')
finally:
    installer.subprocess.run = original_run
assert (saved / 'previous/backend/old.py').read_text() == 'old backend'
assert (saved / 'previous/.venv/old.marker').read_text() == 'old venv'
assert (app / 'backend/app/main.py').is_file()
print('시험 가상환경 설치 실패 시 기존 코드·가상환경과 새 후보 보존 확인', flush=True)
PY
echo "시험 파일 보관: $fixture $release $cache"
