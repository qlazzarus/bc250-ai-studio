#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# -ge 1 && $# -le 2 ]] || exit 1
source_dir=$1
mode=${2:-mock}
[[ $mode == mock || $mode == real-studio || $mode == real-both ]] || exit 1
if [[ $mode == real-studio || $mode == real-both ]]; then
  [[ -f $source_dir/frontend/dist/index.html && -f $source_dir/config/models.yaml \
    && -d /home/vmtest/bc250-test-source/uv-cache ]] || {
    echo '시험 소스 또는 VM 의존성 캐시가 없습니다.' >&2; exit 1;
  }
fi
previous=/var/backups/bc250-linked-migration.JHY3HtWd
snapshot=$previous/live/var/lib/bc250-model-control/legacy-pause.json
[[ -d $previous/backup && -f $snapshot && ! -L $snapshot ]] || {
  echo '기존 가짜 백업 또는 pause 기록이 없습니다.' >&2; exit 1;
}
for unit in bc250-ai-studio.service bc250-llm-gate.service; do
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && -z $(systemctl show "$unit" -p Job --value) ]] || exit 1
done
client=/run/systemd/system/bc250-llm-client.service
[[ ! -e $client && ! -L $client && ! -e /etc/systemd/system/bc250-llm-client.service \
  && ! -L /etc/systemd/system/bc250-llm-client.service \
  && $(systemctl show bc250-llm-client.service -p LoadState --value) == not-found ]] || exit 1
release=$(mktemp -d /opt/bc250-initial-release.XXXXXXXX)
live=$(mktemp -d /var/lib/bc250-initial-live.XXXXXXXX)
state=$(mktemp -d /var/lib/bc250-initial-gate.XXXXXXXX)
displaced=$(mktemp -d /opt/bc250-initial-displaced.XXXXXXXX)
cache=$(mktemp -d /var/cache/bc250-initial-cache.XXXXXXXX)
model_cache=$(mktemp -d /var/cache/bc250-initial-model-cache.XXXXXXXX)
manifest=$(mktemp -d /var/backups/bc250-initial-manifest.XXXXXXXX)
backup=$(mktemp -d /var/backups/bc250-model-migration.XXXXXXXX)
studio_path=$live/opt/bc250-ai-studio
if [[ $mode == real-studio || $mode == real-both ]]; then
  studio_path=$(mktemp -d /opt/bc250-initial-studio.XXXXXXXX)
  chmod 0755 "$studio_path"
fi
model_path=$(mktemp -d /opt/bc250-model-code-fixture.XXXXXXXX)
rmdir -- "$model_path"
trap 'echo "시험 중단. 시험 unit과 파일을 보존합니다: $release $live $state $displaced $cache $model_cache $manifest $backup $studio_path $model_path" >&2' ERR
chmod 0755 "$release"
cp -a --no-preserve=ownership "$source_dir/deploy" "$release/deploy"
cp -a --no-preserve=ownership "$source_dir/systemd" "$release/systemd"
if [[ $mode == real-studio || $mode == real-both ]]; then
  cp -a --no-preserve=ownership "$source_dir/backend" "$release/backend"
  mkdir -p "$release/frontend" "$release/config"
  cp -a --no-preserve=ownership "$source_dir/frontend/dist" "$release/frontend/dist"
  cp -- "$source_dir/config/models.yaml" "$release/config/models.yaml"
  cp -- "$source_dir/pyproject.toml" "$source_dir/uv.lock" "$release/"
  chmod -R a+rX "$release"
  cp -a --no-preserve=ownership /home/vmtest/bc250-test-source/uv-cache/. "$cache/"
  if [[ $mode == real-both ]]; then
    cp -a --no-preserve=ownership /home/vmtest/bc250-test-source/uv-cache/. "$model_cache/"
  fi
  chmod -R go-w "$cache"
  chmod -R go-w "$model_cache"
  restorecon -RF "$cache" "$model_cache" "$studio_path"
fi
chmod -R go-w "$release"
cp -a --reflink=auto "$previous/backup/." "$backup/"
mkdir -p "$live/etc/systemd/system" "$live/etc/polkit-1/rules.d" "$live/etc/tmpfiles.d"
cat > "$client" <<'EOF'
[Unit]
Description=Disposable stopped client for initial install test
[Service]
ExecStart=/usr/bin/sleep 600
KillMode=control-group
EOF
restorecon -RF "$release" "$live" "$state"
restorecon -F "$client"
systemctl daemon-reload
python3 - "$release" "$live" "$state" "$displaced" "$cache" "$manifest" "$backup" "$snapshot" "$studio_path" "$mode" "$model_cache" "$model_path" <<'PY'
import importlib.util
import json
import sys
import subprocess
from pathlib import Path
from types import SimpleNamespace

release, live, state, displaced, cache, manifest, backup, snapshot, studio_path = map(Path, sys.argv[1:10])
mode = sys.argv[10]
model_cache, model_path = map(Path, sys.argv[11:13])
spec = importlib.util.spec_from_file_location('initial', release / 'deploy/model-control/initial-install-adapter.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.LIVE_ROOT = live
module.STUDIO = studio_path
module.SNAPSHOT = snapshot
module.GATE_DIR = state / 'owned-gate'
module.MODEL_CODE = model_path
try:
    module.InitialInstallAdapter(release, displaced, cache, manifest, model_cache=cache,
        check_release=lambda: True, check_configuration=lambda: True,
        check_maintenance=lambda: True, check_local_idle=lambda: True, offline=True)
except ValueError as exc:
    if '캐시는 별도' not in str(exc):
        raise
else:
    raise SystemExit('동일한 시험 캐시가 허용됐습니다.')
print('Studio·모델 코드의 동일 캐시 거절 확인', flush=True)
adapter = module.InitialInstallAdapter(release, displaced, cache, manifest,
    model_cache=model_cache,
    check_release=lambda: True, check_configuration=lambda: True,
    check_maintenance=lambda: True, check_local_idle=lambda: True, offline=True)
studio_calls = []
if mode != 'real-both':
    adapter.model_code = SimpleNamespace(install=lambda *args, **kwargs: True)
def studio(*args, **kwargs):
    if kwargs['check_ready']() is not True:
        raise ValueError('시험 설치 직전 검증 실패')
    studio_calls.append('studio')
if mode == 'mock':
    adapter.studio = SimpleNamespace(install=studio, require_same_model_config=lambda *_: None)
else:
    for name in ('backend', 'config', 'frontend/dist', '.venv'):
        (studio_path / name).mkdir(parents=True, exist_ok=True)
    for name in ('backend', 'config', 'frontend', 'frontend/dist', '.venv'):
        (studio_path / name).chmod(0o755)
    for name in ('backend/old.py', 'config/models.yaml', 'config/server-only.txt',
                 'frontend/dist/index.html', 'frontend/server-only.txt', '.venv/old.marker',
                 'pyproject.toml', 'uv.lock'):
        (studio_path / name).write_text('old fixture\n')
    (studio_path / 'config/models.yaml').write_bytes((release / 'config/models.yaml').read_bytes())
if adapter(backup) is not True or (mode == 'mock' and studio_calls != ['studio']):
    raise SystemExit('시험 설치 연결에 실패했습니다.')
if mode in ('real-studio', 'real-both'):
    for name in ('backend/old.py', '.venv/old.marker', 'config/models.yaml'):
        if not (displaced / 'previous' / name).is_file():
            raise SystemExit('시험 기존 Studio 파일이 보존되지 않았습니다.')
    for name in ('config/server-only.txt', 'frontend/server-only.txt', '.venv/bin/python'):
        if not (studio_path / name).is_file():
            raise SystemExit('시험 신규 Studio 또는 서버 전용 파일이 없습니다.')
    subprocess.run(['/usr/sbin/runuser', '-u', 'ai-studio', '--', str(studio_path / '.venv/bin/python'),
                    '-I', '-c', 'import app; from app.core.config import ROOT; assert (ROOT / "config/models.yaml").is_file()'],
                   cwd=studio_path, check=True)
    print('시험 Studio 실제 설치 및 서비스 계정 접근 확인', flush=True)
if mode == 'real-both':
    if not (model_path / '.venv/bin/python').is_file():
        raise SystemExit('시험 모델 제어 가상환경이 없습니다.')
    print('별도 캐시로 시험 모델 제어와 Studio 실제 설치 연결 확인', flush=True)
pause = json.loads(snapshot.read_text())['paused_before_maintenance']
holds = json.loads((module.GATE_DIR / 'holds.json').read_text())['holds']
if ('legacy' in holds) != pause:
    raise SystemExit('시험 기존 pause가 gate 보류에 반영되지 않았습니다.')
if not (manifest / 'new-unit-install.json').is_file():
    raise SystemExit('시험 unit 설치 기록이 없습니다.')
for name in adapter.units.FILES.values():
    if not (live / name).is_file():
        raise SystemExit('시험 unit 설치 파일이 없습니다.')
print('시험 백업 재검증·기존 pause 이관·가짜 경로 unit 설치 연결 확인', flush=True)
print(('릴리스·설정·유지보수·로컬 유휴 검사는 모의입니다.' if mode in ('real-studio', 'real-both')
       else 'Studio 설치·릴리스·설정·유지보수·로컬 유휴 검사는 모의입니다.'), flush=True)
PY
rm -- "$client"
systemctl daemon-reload
echo "시험 Client unit 정리 완료; 시험 기록 보관: $release $live $state $displaced $cache $model_cache $manifest $backup $studio_path $model_path"
