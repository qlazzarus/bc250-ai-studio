#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing \
  && ( $# == 2 || ( $# == 3 && ( $3 == adapter || $3 == adapter-systemd || $3 == systemd-linked ) ) ) \
  && $2 =~ ^[a-f0-9]{64}$ ]] || exit 1
source_dir=$1
digest=$2
binary=''
for path in /home/vmtest/bc250-caddy-fixture.????????/caddy; do
  [[ -f $path && ! -L $path ]] || continue
  if [[ $(sha256sum "$path" | cut -d ' ' -f 1) == "$digest" ]]; then
    binary=$path
    break
  fi
done
[[ -n $binary ]] || { echo '호스트와 해시가 일치하는 시험 Caddy가 없습니다.' >&2; exit 1; }
fixture=$(mktemp -d /opt/bc250-caddy-linked.XXXXXXXX)
trap 'echo "시험 중단. 시험 파일과 서비스 기록을 보존합니다: $fixture" >&2' ERR
install -o root -g root -m 0755 "$binary" "$fixture/caddy"
[[ $(sha256sum "$fixture/caddy" | cut -d ' ' -f 1) == "$digest" ]] || exit 1
restorecon -RF "$fixture"
release="$source_dir/deploy/model-control"
if [[ ${3:-linked} == adapter-systemd || ${3:-linked} == systemd-linked ]]; then
  release=$fixture/release
  install -d -o root -g root -m 0755 "$release"
  for name in create-maintenance-caddy.py capture-caddy.py caddy-file-swap.py \
    caddy-transaction.py caddy-maintenance-adapter.py maintenance-probe.py; do
    install -o root -g root -m 0644 "$source_dir/deploy/model-control/$name" "$release/$name"
  done
  restorecon -RF "$release"
fi
python3 - "$source_dir" "$fixture/Caddyfile.original" <<'PY'
import importlib.util
import sys
from pathlib import Path
source = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('generator', source / 'deploy/model-control/create-maintenance-caddy.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
Path(sys.argv[2]).write_text('\n'.join(generator.EXPECTED) + '\n')
PY
BC250_FIXTURE_SOURCE_DIR="$source_dir" PATH="$fixture:/usr/sbin:/usr/bin:/sbin:/bin" \
  python3 "$source_dir/scripts/test-maintenance-lifecycle.py" \
  "$fixture/Caddyfile.original" "$release/create-maintenance-caddy.py" \
  "$release/capture-caddy.py" "$release/caddy-file-swap.py" "${3:-linked}"
echo "시험 Caddy 연결 시험 완료; 시험 파일 보관: $fixture"
