#!/usr/bin/env bash
# Exercise first-install files and manifest-based preservation in disposable paths.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/install-units.py ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-unit-install-test.XXXXXXXX)
release=$(mktemp -d /opt/bc250-unit-release.XXXXXXXX)
chmod 0755 "$release"
mkdir -p "$release/deploy/model-control" "$release/systemd"
for name in studio.conf gate.conf llm-client.conf 50-bc250-studio-llm.rules install-units.py preserve-installed-units.py; do
  install -o root -g root -m 0644 "$1/deploy/model-control/$name" "$release/deploy/model-control/$name"
done
for name in bc250-gpu-lock.conf bc250-model-worker.socket bc250-model-worker.service bc250-model-api.service; do
  install -o root -g root -m 0644 "$1/systemd/$name" "$release/systemd/$name"
done
restorecon -RF "$release"
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture $release" >&2' ERR
python3 - "$fixture" "$release" <<'PY'
import importlib.util
import os
import sys
from pathlib import Path

fixture, release = map(Path, sys.argv[1:])
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
installer_path = release / 'deploy/model-control/install-units.py'
installer = load('fixture_installer', installer_path)
remover = load('fixture_remover', release / 'deploy/model-control/preserve-installed-units.py')

def setup(name):
    case = fixture / name
    live, record, saved = (case / value for value in ('live', 'record', 'saved'))
    for path in (live / 'etc/systemd/system', live / 'etc/polkit-1/rules.d',
                 live / 'etc/tmpfiles.d', record, saved):
        path.mkdir(parents=True, mode=0o700)
    return live, record, saved

live, record, saved = setup('success')
installer.install(release, live, record)
for name in installer.FILES.values():
    target = live / name
    assert target.is_file() and target.stat().st_uid == 0 and target.stat().st_mode & 0o777 == 0o644
assert (record / 'new-unit-install.json').is_file()
remover.preserve(live, record, saved, installer_path)
for name in installer.FILES.values():
    assert not (live / name).exists() and (saved / name).is_file()
print('시험 unit·drop-in·polkit·tmpfiles 설치 및 기록 기반 보존 확인', flush=True)

live, record, saved = setup('collision')
target = live / 'etc/systemd/system/bc250-model-worker.socket'
target.write_text('existing fixture')
try:
    installer.install(release, live, record)
except ValueError:
    pass
else:
    raise SystemExit('기존 시험 unit을 잘못 덮어썼습니다.')
assert target.read_text() == 'existing fixture'
assert not (record / 'new-unit-install.json').exists()
print('기존 대상 존재 시 설치 전 중단 확인', flush=True)

live, record, saved = setup('changed')
installer.install(release, live, record)
target = live / 'etc/systemd/system/bc250-model-worker.socket'
target.write_text('changed fixture')
try:
    remover.preserve(live, record, saved, installer_path)
except ValueError:
    pass
else:
    raise SystemExit('변경된 시험 unit을 잘못 이동했습니다.')
assert target.read_text() == 'changed fixture'
assert not any(saved.iterdir())
print('설치 후 변경된 unit은 보존 이동 전에 거절 확인', flush=True)

live, record, saved = setup('interrupted')
original_run = installer.subprocess.run
calls = 0
def fail_after_first_file(*args, **kwargs):
    global calls
    calls += 1
    if calls == 5:
        raise OSError('fixture restorecon failure')
    return original_run(*args, **kwargs)
installer.subprocess.run = fail_after_first_file
try:
    installer.install(release, live, record)
except OSError:
    pass
else:
    raise SystemExit('시험 설치 실패가 발생하지 않았습니다.')
finally:
    installer.subprocess.run = original_run
assert (record / 'new-unit-install.json').is_file()
assert any((live / name).is_file() for name in installer.FILES.values())
remover.preserve(live, record, saved, installer_path)
assert any((saved / name).is_file() for name in installer.FILES.values())
print('중간 설치 실패 시 기록과 설치된 파일 보존 확인', flush=True)
PY
echo "시험 파일 보관: $fixture $release"
