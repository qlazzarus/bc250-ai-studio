#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 0 ]] || exit 1
namespace=bc250-nft-Aq6vWiAo
group=/sys/fs/cgroup/bc250_nft_Aq6vWiAo/gate
[[ -e /run/netns/$namespace && -d $group ]] || {
  echo '보존된 시험 네임스페이스 또는 cgroup을 찾지 못했습니다.' >&2; exit 1;
}
printf '%s\n' '--- 보존된 시험 cgroup 관찰 ---'
if [[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs ]]; then
  echo 'VM의 cgroup v2 마운트: 확인'
else
  echo 'VM의 cgroup v2 마운트: 확인 실패'
fi
host_id=$(stat -Lc '%d:%i' "$group")
if namespace_id=$(ip netns exec "$namespace" stat -Lc '%d:%i' "$group" 2>/dev/null); then
  if [[ $namespace_id == "$host_id" ]]; then
    echo '시험 네임스페이스의 cgroup 경로: 같은 디렉터리로 확인'
  else
    echo '시험 네임스페이스의 cgroup 경로: VM과 다른 디렉터리'
  fi
else
  echo '시험 네임스페이스의 cgroup 경로: 접근 또는 확인 불가'
fi
host_cgns=$(readlink /proc/self/ns/cgroup)
if namespace_cgns=$(ip netns exec "$namespace" readlink /proc/self/ns/cgroup 2>/dev/null); then
  if [[ $host_cgns == "$namespace_cgns" ]]; then
    echo 'cgroup 네임스페이스: VM과 동일'
  else
    echo 'cgroup 네임스페이스: VM과 다름'
  fi
else
  echo 'cgroup 네임스페이스: 확인 불가'
fi
for form in relative absolute; do
  case $form in
    relative) candidate=bc250_nft_Aq6vWiAo/gate ;;
    absolute) candidate=$group ;;
  esac
  rules="table inet bc250_diagnostic_Aq6vWiAo {
 chain output {
  type filter hook output priority 0; policy accept;
  socket cgroupv2 level 2 \"$candidate\" counter
 }
}"
  if printf '%s\n' "$rules" | ip netns exec "$namespace" nft --check --file - >/dev/null 2>&1; then
    echo "시험 네임스페이스의 $form 경로 nft --check: 통과"
  else
    echo "시험 네임스페이스의 $form 경로 nft --check: 실패 (원인 미확정)"
  fi
done
echo '--- 네트워크 네임스페이스만 진입한 재검사 ---'
command -v nsenter >/dev/null || { echo '시험 VM에 nsenter가 없습니다.' >&2; exit 1; }
host_net=$(readlink /proc/self/ns/net)
target_net=$(nsenter --net="/run/netns/$namespace" readlink /proc/self/ns/net)
[[ $host_net != "$target_net" ]] || { echo '별도 시험 네트워크 확인 실패' >&2; exit 1; }
if target_id=$(nsenter --net="/run/netns/$namespace" stat -Lc '%d:%i' "$group" 2>/dev/null) && [[ $target_id == "$host_id" ]]; then
  echo 'nsenter 시험 네임스페이스의 cgroup 경로: 같은 디렉터리로 확인'
else
  echo 'nsenter 시험 네임스페이스의 cgroup 경로: 확인 실패' >&2
  exit 1
fi
rules='table inet bc250_diagnostic_nsenter {
 chain output {
  type filter hook output priority 0; policy accept;
  socket cgroupv2 level 2 "bc250_nft_Aq6vWiAo/gate" counter
 }
}'
if printf '%s\n' "$rules" | nsenter --net="/run/netns/$namespace" nft --check --file - >/dev/null 2>&1; then
  echo 'nsenter 시험 네임스페이스의 상대 경로 nft --check: 통과'
else
  echo 'nsenter 시험 네임스페이스의 상대 경로 nft --check: 실패 (원인 미확정)' >&2
  exit 1
fi
echo 'nft 규칙을 적용하지 않았으며 시험 네임스페이스와 기록을 유지했습니다.'
