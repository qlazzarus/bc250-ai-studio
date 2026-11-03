#!/usr/bin/env bash
# Compare only hashes; do not print configuration, paths inside it, or secrets.
set -Eeuo pipefail
[[ $# == 1 ]] || { echo '사용법: bash scripts/compare-studio-model-config-remote.sh internal|external' >&2; exit 1; }
case $1 in
  internal) host=192.168.0.57; port=22 ;;
  external) host=yeppyshiba.iptime.org; port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
candidate=$root/config/models.yaml
[[ -f $candidate && ! -L $candidate ]] || { echo '로컬 모델 설정을 확인하지 못했습니다.' >&2; exit 1; }
digest=$(sha256sum -- "$candidate")
digest=${digest%% *}
[[ $digest =~ ^[0-9a-f]{64}$ ]] || exit 1
echo "읽기 전용 비교 대상: $host:$port"
ssh -p "$port" "yeppyshiba@$host" python3 - "$digest" <<'PY'
import hashlib
import os
import re
import stat
import sys

expected = sys.argv[1]
if not re.fullmatch(r'[0-9a-f]{64}', expected):
    raise SystemExit('후보 해시 형식이 올바르지 않습니다.')
try:
    fd = os.open('/opt/bc250-ai-studio/config/models.yaml', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
            raise ValueError
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
        after = os.fstat(source.fileno())
        if any(getattr(before, key) != getattr(after, key) for key in
               ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')):
            raise ValueError
except (OSError, ValueError):
    raise SystemExit('운영 Studio 모델 설정을 안전하게 읽지 못했습니다.') from None
print('운영 Studio 모델 설정과 로컬 작업 트리 후보: ' + ('일치' if actual == expected else '다름'))
print('파일 내용과 해시는 출력하지 않았습니다. 서비스는 변경하지 않았습니다.')
PY
