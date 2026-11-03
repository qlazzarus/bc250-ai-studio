#!/usr/bin/env bash
# Compare installation files with local Git history without printing source or digests.
set -Eeuo pipefail
[[ $# == 1 ]] || { echo '사용법: internal|external' >&2; exit 1; }
case $1 in
  internal) host=192.168.0.57; port=22 ;;
  external) host=yeppyshiba.iptime.org; port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
manifest=$(python3 - "$root" <<'PY'
import base64
import hashlib
import json
import subprocess
import sys
root = sys.argv[1]
files = ('app/core/config.py', 'app/core/files.py', 'app/services/gpu.py')
result = {}
for name in files:
    path = 'backend/' + name
    commits = subprocess.check_output(['git', '-C', root, 'log', '--all', '--format=%H', '--', path], text=True).splitlines()
    if len(commits) > 500: raise SystemExit('후보 이력이 너무 많습니다.')
    seen = set()
    result[name] = []
    for commit in commits:
        item = subprocess.run(['git', '-C', root, 'show', commit + ':' + path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if item.returncode != 0:
            continue
        digest = hashlib.sha256(item.stdout).hexdigest()
        if digest not in seen:
            result[name].append([commit, digest])
            seen.add(digest)
print(base64.b64encode(json.dumps(result).encode()).decode())
PY
)
[[ $manifest =~ ^[A-Za-z0-9+/=]+$ ]] || exit 1
echo "읽기 전용 이력 비교 대상: $host:$port"
ssh -p "$port" "yeppyshiba@$host" python3 - "$manifest" <<'PY'
import base64
import hashlib
import json
import os
import stat
import sys
files = ('app/core/config.py', 'app/core/files.py', 'app/services/gpu.py')
try:
    manifest = json.loads(base64.b64decode(sys.argv[1], validate=True))
    if set(manifest) != set(files): raise ValueError('invalid')
except (IndexError, ValueError):
    raise SystemExit('후보 이력을 확인하지 못했습니다.') from None
for name in files:
    try:
        fd = os.open('/opt/bc250-ai-studio/backend/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            before = os.fstat(file.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024: raise ValueError('invalid')
            digest = hashlib.file_digest(file, 'sha256').hexdigest()
            after = os.fstat(file.fileno())
            if any(getattr(before, key) != getattr(after, key) for key in
                   ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')): raise ValueError('changed')
        matches = [commit[:12] for commit, value in manifest[name] if value == digest]
        result = '이력 일치 ' + matches[0] if matches else '이력에서 일치 항목 없음'
    except (OSError, ValueError):
        result = '확인 불가'
    print(name + ': ' + result)
print('설치 파일 기준 결과입니다. 실행 중인 코드의 출처는 별도 확인이 필요합니다.')
print('파일 내용·해시·환경값은 출력하지 않았습니다. 서비스를 변경하지 않았습니다.')
PY
