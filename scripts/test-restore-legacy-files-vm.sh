#!/usr/bin/env bash
# Exercise file-set restoration against private disposable VM paths only.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing ]] || exit 1
[[ $# == 1 && -f $1/deploy/model-control/restore-legacy-files.py ]] || exit 1
fixture=$(mktemp -d /var/backups/bc250-restore-files-test.XXXXXXXX)
toolsdir=$(mktemp -d /opt/bc250-restore-files-tools.XXXXXXXX)
chmod 0755 "$toolsdir"
install -o root -g root -m 0644 "$1/deploy/model-control/restore-legacy-files.py" "$toolsdir/restore-legacy-files.py"
restorecon -RF "$toolsdir"
trap 'echo "시험 실패. 시험 파일을 보존합니다: $fixture $toolsdir" >&2' ERR
python3 - "$toolsdir/restore-legacy-files.py" "$fixture" <<'PY'
import importlib.util
import os
import shutil
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('restore_files', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(sys.argv[2])

def fixture(name):
    root_case = root / name
    stage, live, saved = (root_case / part for part in ('stage', 'live', 'saved'))
    for path in (stage, live, saved):
        path.mkdir(parents=True, mode=0o700)
    for base, value in ((stage, 'legacy'), (live, 'new')):
        for relative in module.REQUIRED:
            path = base / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if relative in module.REQUIRED[:2]:
                path.mkdir()
                (path / 'test-data').write_text(value)
            else:
                path.write_text(value)
    for relative in module.UNCHANGED:
        original = stage / relative
        original.parent.mkdir(parents=True, exist_ok=True)
        original.write_text('preserve unchanged')
        copy = live / relative
        copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, copy)
    extra = live / module.OPTIONAL[0]
    extra.mkdir(parents=True)
    (extra / 'new.conf').write_text('new drop-in')
    os.setxattr(stage / module.REQUIRED[2], 'user.bc250-fixture', b'preserve')
    return stage, live, saved

stage, live, saved = fixture('success')
module.restore(stage, live, saved)
assert (live / module.REQUIRED[0] / 'test-data').read_text() == 'legacy'
assert (saved / 'displaced' / module.REQUIRED[0] / 'test-data').read_text() == 'new'
assert (saved / 'displaced' / module.OPTIONAL[0] / 'new.conf').is_file()
assert not (live / module.OPTIONAL[0]).exists()
assert os.getxattr(live / module.REQUIRED[2], 'user.bc250-fixture') == b'preserve'
assert (live / module.UNCHANGED[0]).read_text() == 'preserve unchanged'
print('시험 기존 코드·데이터·환경 복원과 신규 파일 및 drop-in 보존 확인', flush=True)
print('시험 활성 모델 설정 내용·소유권·권한·확장 속성 유지 확인', flush=True)

stage, live, saved = fixture('failure')
original_rename = module.os.rename
count = 0
def fail_second(source, target):
    global count
    count += 1
    if count == 2:
        raise OSError('fixture failure')
    return original_rename(source, target)
module.os.rename = fail_second
try:
    module.restore(stage, live, saved)
except OSError:
    pass
else:
    raise SystemExit('시험 파일 교체 실패를 감지하지 못했습니다.')
assert (saved / 'displaced' / module.REQUIRED[0] / 'test-data').read_text() == 'new'
assert (saved / 'prepared' / module.REQUIRED[0] / 'test-data').read_text() == 'legacy'
assert (live / module.REQUIRED[1] / 'test-data').read_text() == 'new'
print('시험 교체 실패 시 신규 파일·복원 후보와 미교체 데이터 보존 확인', flush=True)
PY
echo "시험 파일 보관: $fixture $toolsdir"
