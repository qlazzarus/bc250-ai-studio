#!/usr/bin/env bash
# Fake upload and root-owned intake only; never touches operational services.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
upload=$(mktemp -d /var/lib/bc250-intake-upload.XXXXXXXX)
records=$(mktemp -d /var/backups/bc250-intake-test.XXXXXXXX)
trap 'echo "시험 중단. 시험 파일 보관: $upload $records" >&2' ERR
chown vmtest:vmtest "$upload"
chmod 0700 "$upload" "$records"
install -o root -g root -m 0644 "$source_dir/deploy/model-control/intake-authenticated-artifact.py" "$records/intake.py"
restorecon -RF "$upload" "$records"
python3 - "$upload" "$records" <<'PY'
import hashlib
import importlib.util
import os
import pwd
import stat
import sys
from pathlib import Path
upload, records = map(Path, sys.argv[1:])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('intake', records/'intake.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
owner = pwd.getpwnam('vmtest').pw_uid
source = upload/'candidate.tar.gz'
source.write_bytes(b'fake candidate contents\n')
os.chown(source, owner, -1)
os.chmod(source, 0o600)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
commit, run_id, attempt = 'a'*40, '42', '1'
def destination(name):
    path = records/name
    path.mkdir(mode=0o700)
    return path
def options(auth, expected=digest):
    return dict(owner=owner, commit=commit, digest=expected, run_id=run_id, attempt=attempt,
                verify_authorization=auth)
rejected = destination('unapproved')
try:
    module.receive(source, rejected, **options(lambda *_: False))
except ValueError:
    pass
else:
    raise SystemExit('승인되지 않은 시험 후보를 허용했습니다.')
if list(rejected.iterdir()): raise SystemExit('승인 거절 전 수신 파일을 만들었습니다.')
print('모의 Actions 승인 실패 시 시험 파일 생성 전 거절 확인', flush=True)
wrong = destination('wrong-digest')
try:
    module.receive(source, wrong, **options(lambda *_: True, '0'*64))
except ValueError:
    pass
else:
    raise SystemExit('잘못된 시험 해시를 허용했습니다.')
if not (wrong/'candidate.incomplete').is_file() or (wrong/'candidate.tar.gz').exists():
    raise SystemExit('해시 실패의 미완료 파일 보존이 올바르지 않습니다.')
print('다른 시험 해시 거절 및 미완료 파일 보존 확인', flush=True)
link = upload/'link.tar.gz'
link.symlink_to(source)
linked = destination('symlink')
try:
    module.receive(link, linked, **options(lambda *_: True))
except OSError:
    pass
else:
    raise SystemExit('시험 심볼릭 링크를 허용했습니다.')
if list(linked.iterdir()): raise SystemExit('시험 링크 거절 전 파일이 생성됐습니다.')
print('시험 전송 파일의 심볼릭 링크 거절 확인', flush=True)
revoked = destination('revoked')
responses = iter([True, False])
try:
    module.receive(source, revoked, **options(lambda *_: next(responses)))
except ValueError:
    pass
else:
    raise SystemExit('시험 승인 상실을 허용했습니다.')
if not (revoked/'candidate.incomplete').is_file() or (revoked/'candidate.tar.gz').exists():
    raise SystemExit('승인 상실 후 미완료 파일을 보존하지 않았습니다.')
print('시험 전송 중 모의 승인 상실 시 미완료 파일 보존 확인', flush=True)
ready = destination('ready')
target = module.receive(source, ready, **options(lambda *_: True))
info = target.stat()
if (target.read_bytes() != source.read_bytes() or info.st_uid != 0
        or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1
        or (ready/'candidate.incomplete').exists()):
    raise SystemExit('root 소유 시험 후보가 올바르지 않습니다.')
try:
    module.receive(source, ready, **options(lambda *_: True))
except ValueError:
    print('정상 시험 수신 및 기존 후보 덮어쓰기 거절 확인', flush=True)
else:
    raise SystemExit('기존 시험 후보 덮어쓰기를 허용했습니다.')
print('Actions 출처 인증·SSH 전달·실제 아티팩트와 서비스는 시험하지 않았습니다.', flush=True)
PY
trap - ERR
echo "시험 파일 보관: $upload $records"
