#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 1 ]] || { echo '사용법: internal|external' >&2; exit 1; }
case $1 in
  internal) host=192.168.0.57; port=22 ;;
  external) host=yeppyshiba.iptime.org; port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
program=$(base64 -w0 -- "$root/scripts/inspect-local-gpu-callers.py")
[[ $program =~ ^[A-Za-z0-9+/=]+$ ]] || exit 1
echo "읽기 전용 순간 관찰 대상: $host:$port"
ssh -t -p "$port" "yeppyshiba@$host" \
  "sudo /usr/bin/python3 -c 'import base64;exec(compile(base64.b64decode(\"$program\"),\"<caller-check>\",\"exec\"))'"
