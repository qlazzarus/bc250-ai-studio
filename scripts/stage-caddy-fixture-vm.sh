#!/usr/bin/env bash
# Copy the Fedora host's Caddy binary into a private test VM directory only.
set -Eeuo pipefail
umask 077
[[ $(id -u) != 0 ]] || { echo 'Fedora 호스트 일반 사용자로 실행하세요.' >&2; exit 1; }
vm_dir="$HOME/bc250-fedora43-test-vm"
options=(-i "$vm_dir/vm-key" -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$vm_dir/known_hosts")
for item in "$vm_dir/vm-key" "$vm_dir/known_hosts"; do
  [[ -f $item && ! -L $item ]] || { echo '시험 VM 접속 파일이 없습니다.' >&2; exit 1; }
done
binary=$(command -v caddy)
binary=$(readlink -e -- "$binary")
[[ -f $binary && ! -L $binary && -x $binary && $(stat -c '%u' "$binary") == 0 \
  && -z $(find "$binary" -maxdepth 0 -perm /022 -print) ]] || {
  echo '호스트 Caddy 실행 파일을 신뢰할 수 없습니다.' >&2; exit 1;
}
digest=$(sha256sum "$binary" | cut -d ' ' -f 1)
[[ $digest =~ ^[a-f0-9]{64}$ ]] || exit 1
ssh -n "${options[@]}" -p 22223 vmtest@127.0.0.1 \
  'test "$(hostname)" = bc250-fedora43-test && test "$(systemd-detect-virt)" = qemu'
target=$(ssh -n "${options[@]}" -p 22223 vmtest@127.0.0.1 \
  'umask 077; mktemp -d "$HOME/bc250-caddy-fixture.XXXXXXXX"')
[[ $target =~ ^/home/vmtest/bc250-caddy-fixture\.[[:alnum:]]{8}$ ]] || exit 1
echo "시험 Caddy 보관: $target"
scp "${options[@]}" -P 22223 "$binary" "vmtest@127.0.0.1:$target/caddy" </dev/null
ssh "${options[@]}" -p 22223 vmtest@127.0.0.1 bash -s -- "$target" "$digest" <<'SH'
set -Eeuo pipefail
[[ $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu \
  && $1 =~ ^/home/vmtest/bc250-caddy-fixture\.[[:alnum:]]{8}$ \
  && $2 =~ ^[a-f0-9]{64}$ ]] || exit 1
[[ -f $1/caddy && ! -L $1/caddy ]] || exit 1
[[ $(sha256sum "$1/caddy" | cut -d ' ' -f 1) == "$2" ]] || {
  echo '시험 Caddy 체크섬이 다릅니다.' >&2; exit 1;
}
chmod 0700 "$1/caddy"
"$1/caddy" version
echo '시험 VM Caddy 실행 및 호스트 파일 체크섬 일치 확인; 서비스는 시작하지 않았습니다.'
SH
