#!/usr/bin/env bash
# Read only metadata from the already-running, isolated Fedora test VM.
set -Eeuo pipefail
vm_dir="$HOME/bc250-fedora43-test-vm"
[[ -f $vm_dir/vm-key && -f $vm_dir/known_hosts ]] || {
  echo '시험 VM 접속 파일이 없습니다.' >&2; exit 1;
}
ssh -i "$vm_dir/vm-key" -o BatchMode=yes -o ConnectTimeout=5 \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$vm_dir/known_hosts" \
  -p 22223 vmtest@127.0.0.1 \
  'test "$(hostname)" = bc250-fedora43-test && test "$(systemd-detect-virt)" = qemu && sudo -n python3 -' <<'PY'
import collections
import os
import stat
from pathlib import Path

worker = Path('/opt/bc250-current-code-candidate.YS6DiOo6')
studios = []
for path in Path('/opt').glob('bc250-studio-fixture-*'):
    if path.is_symlink() or not path.is_dir():
        continue
    info = path.stat()
    if (info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o755
            and (path / '.venv/bin/python').is_file() and (path / 'backend/app/main.py').is_file()):
        studios.append(path)
if len(studios) != 1:
    raise SystemExit(f'성공한 시험 Studio 후보를 하나로 확인하지 못했습니다: {len(studios)}개')

def check(label, root):
    uid_issues = collections.Counter()
    writable = collections.Counter()
    def onerror(error):
        raise error
    for parent, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
        for name in dirs + files:
            path = Path(parent) / name
            info = path.lstat()
            kind = '링크' if stat.S_ISLNK(info.st_mode) else ('디렉터리' if stat.S_ISDIR(info.st_mode) else '파일')
            section = '가상환경' if path.relative_to(root).parts[0] == '.venv' else '그 외'
            if info.st_uid != 0:
                uid_issues[(section, kind, info.st_uid)] += 1
            if not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022:
                writable[(section, kind, f'{stat.S_IMODE(info.st_mode):04o}')] += 1
    print(f'--- {label} ---')
    print('root 외 소유 항목:', sum(uid_issues.values()))
    for (section, kind, uid), count in sorted(uid_issues.items())[:10]:
        print(f'  {section} / {kind} / UID {uid}: {count}개')
    print('그룹 또는 기타 쓰기 허용 항목:', sum(writable.values()))
    for (section, kind, mode), count in sorted(writable.items())[:10]:
        print(f'  {section} / {kind} / 권한 {mode}: {count}개')

check('작업자 후보', worker)
check('Studio 후보', studios[0])
print('파일 이름·내용과 환경값은 출력하지 않았습니다.')
PY
