#!/usr/bin/env bash
# Compare bounded source files only; never show contents or digests.
set -Eeuo pipefail
[[ $# == 1 ]] || { echo '사용법: internal|external' >&2; exit 1; }
case $1 in
  internal) host=192.168.0.57; port=22 ;;
  external) host=yeppyshiba.iptime.org; port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
files=(app/core/config.py app/core/files.py app/services/gpu.py)
hashes=()
for file in "${files[@]}"; do
  path=$root/backend/$file
  [[ -f $path && ! -L $path ]] || { echo '로컬 후보 소스 확인 실패' >&2; exit 1; }
  digest=$(sha256sum -- "$path")
  digest=${digest%% *}
  [[ $digest =~ ^[a-f0-9]{64}$ ]] || exit 1
  hashes+=("$digest")
done
echo "읽기 전용 비교 대상: $host:$port"
ssh -p "$port" "yeppyshiba@$host" python3 - "${hashes[@]}" <<'PY'
import hashlib
import os
import re
import stat
import sys
files = ('app/core/config.py', 'app/core/files.py', 'app/services/gpu.py')
if len(sys.argv) != 4 or any(not re.fullmatch(r'[0-9a-f]{64}', x) for x in sys.argv[1:]):
    raise SystemExit('후보 식별 값 오류')
for name, expected in zip(files, sys.argv[1:]):
    try:
        fd = os.open('/opt/bc250-ai-studio/backend/' + name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
        with os.fdopen(fd, 'rb') as file:
            before = os.fstat(file.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
                raise ValueError('invalid')
            actual = hashlib.file_digest(file, 'sha256').hexdigest()
            after = os.fstat(file.fileno())
            if any(getattr(before, key) != getattr(after, key) for key in
                   ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')):
                raise ValueError('changed')
        result = '일치' if actual == expected else '다름'
    except (OSError, ValueError):
        result = '확인 불가'
    print(name + ': ' + result)
print('파일 내용·해시는 출력하지 않았습니다. 실행 중인 코드의 출처 확인은 별도로 필요합니다.')
PY
