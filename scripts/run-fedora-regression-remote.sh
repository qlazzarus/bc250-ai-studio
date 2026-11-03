#!/usr/bin/env bash
# Test the current tracked working tree in a disposable Fedora container.
set -Eeuo pipefail
umask 077
[[ $# == 1 || ( $# == 2 && ( $2 == lint || $2 == gate-admin ) ) ]] || { echo '사용법: bash scripts/run-fedora-regression-remote.sh internal|external [lint|gate-admin]' >&2; exit 1; }
mode=${2:-full}
case $1 in
  internal) deploy_host=192.168.0.57; deploy_port=22 ;;
  external) deploy_host=yeppyshiba.iptime.org; deploy_port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/bc250-fedora-regression.XXXXXXXX")
archive=$stage/source.tar.gz
# tar reads the current working-tree contents of tracked paths. Explicitly add
# the new task files; never collect arbitrary untracked or ignored files.
git -C "$root" ls-files -z -- pyproject.toml uv.lock backend config deploy scripts systemd \
  > "$stage/files"
# Include only untracked Python source in the selected repository areas; never
# add ignored files or environment files. The archive still uses working-tree
# contents and therefore is not a final-commit artifact.
git -C "$root" ls-files --others --exclude-standard -z -- backend deploy scripts |
  python3 -c 'import sys; items = sys.stdin.buffer.read().split(b"\0"); sys.stdout.buffer.write(b"".join(x + b"\0" for x in items if x.endswith(b".py")))' >> "$stage/files"
tar -czf "$archive" -C "$root" --null -T "$stage/files"
digest=$(sha256sum "$archive" | cut -d ' ' -f 1)
echo "시험 대상: $deploy_host:$deploy_port"
echo "작업 트리 시험 소스 SHA-256: $digest"
echo "로컬 시험 파일 보관: $stage"
remote_dir=$(ssh -p "$deploy_port" "yeppyshiba@$deploy_host" \
  'umask 077; mktemp -d "$HOME/bc250-regression.XXXXXXXX"')
[[ $remote_dir =~ ^/home/yeppyshiba/bc250-regression\.[[:alnum:]]{8}$ ]] || {
  echo '서버 임시 경로를 확인하지 못했습니다.' >&2; exit 1;
}
echo "서버 시험 파일 보관: $remote_dir"
scp -P "$deploy_port" "$archive" "yeppyshiba@$deploy_host:$remote_dir/source.tar.gz"
ssh -p "$deploy_port" "yeppyshiba@$deploy_host" bash -s -- "$remote_dir" "$digest" "$mode" <<'REMOTE'
set -Eeuo pipefail
remote_dir=$1
digest=$2
mode=$3
[[ $mode == full || $mode == lint || $mode == gate-admin ]] || exit 1
printf '%s  %s\n' "$digest" "$remote_dir/source.tar.gz" | sha256sum -c -
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[[ $available =~ ^[0-9]+$ && $available -ge 2500000 ]] || {
  echo '서버의 사용 가능 메모리가 부족해 컨테이너 시험을 시작하지 않았습니다.' >&2; exit 1;
}
podman image exists docker.io/library/fedora:43
mkdir -m 0700 "$remote_dir/source"
tar -xzf "$remote_dir/source.tar.gz" -C "$remote_dir/source"
uv_executable=$(command -v uv)
[[ -f $uv_executable && -x $uv_executable ]] || { echo 'uv 실행 파일을 찾지 못했습니다.' >&2; exit 1; }
cp -L -- "$uv_executable" "$remote_dir/source/.test-uv"
chmod 0700 "$remote_dir/source/.test-uv"
mkdir -m 0700 "$remote_dir/build-context"
printf '%s\n' 'FROM docker.io/library/fedora:43' \
  'RUN dnf -y install python3 jemalloc && dnf clean all' > "$remote_dir/Containerfile"
echo 'Fedora 시험 이미지에 Python과 uv 실행 라이브러리를 설치합니다. 패키지 다운로드가 필요합니다.'
podman build --pull=never --iidfile "$remote_dir/image.id" \
  -f "$remote_dir/Containerfile" "$remote_dir/build-context"
image_id=$(cat "$remote_dir/image.id")
[[ $image_id =~ ^sha256:[0-9a-f]{64}$ ]] || { echo '시험 이미지 ID를 확인하지 못했습니다.' >&2; exit 1; }
if [[ $mode == gate-admin ]]; then
  echo '격리 컨테이너에서 gate 관리자 변경 부분만 시험합니다.'
elif [[ $mode == lint ]]; then
  echo '격리 컨테이너에서 잠금 의존성을 설치하고 Ruff를 실행합니다.'
else
  echo '격리 컨테이너에서 잠금 의존성을 설치하고 백엔드 시험을 실행합니다.'
fi
podman run --rm --userns=keep-id --user "$(id -u):$(id -g)" \
  --workdir /work --env HOME=/tmp --env UV_CACHE_DIR=/tmp/uv-cache \
  --env UV_PYTHON_DOWNLOADS=never --env "BC250_REGRESSION_MODE=$mode" --volume "$remote_dir/source:/work:Z" \
  "$image_id" bash -euc '
    if ! test -x /usr/bin/python3; then echo "시험 이미지에 Python이 없습니다." >&2; exit 1; fi
    /usr/bin/python3 --version
    libraries=$(ldd /work/.test-uv) || { echo "uv 실행 파일의 라이브러리 검사가 실패했습니다." >&2; exit 1; }
    if printf "%s\n" "$libraries" | grep -q "not found"; then
      printf "%s\n" "$libraries" >&2
      echo "시험 이미지에 uv 실행에 필요한 라이브러리가 없습니다." >&2
      exit 1
    fi
    /work/.test-uv sync --locked --extra dev --python /usr/bin/python3
    if [ "$BC250_REGRESSION_MODE" = gate-admin ]; then
      /work/.test-uv run --no-sync pytest -q backend/tests/test_gate_admin.py backend/tests/test_gate_holds.py
      /work/.test-uv run --no-sync ruff check backend/app/gate.py backend/app/services/gate_admin.py backend/tests/test_gate_admin.py backend/tests/test_gate_holds.py
    elif [ "$BC250_REGRESSION_MODE" = full ]; then
      /work/.test-uv run --no-sync pytest -q
      /work/.test-uv run --no-sync ruff check .
    else
      /work/.test-uv run --no-sync ruff check .
    fi
  '
if [[ $mode == gate-admin ]]; then echo 'Fedora 컨테이너 gate 관리자 시험 및 Ruff 완료'; elif [[ $mode == lint ]]; then echo 'Fedora 컨테이너 Ruff 완료'; else echo 'Fedora 컨테이너 백엔드 시험 및 Ruff 완료'; fi
REMOTE
