#!/usr/bin/env bash
# Cleanup only the exact disposable account left by the SSH boundary fixture.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $# == 2 ]] || exit 1
account=$1
work=$2
[[ $work =~ ^/opt/bc250-ssh-boundary\.([A-Za-z0-9]{8})$ ]] || exit 1
suffix=${BASH_REMATCH[1],,}
[[ $account == "bcs$suffix" && -d $work && ! -L $work ]] || exit 1
[[ $(stat -c '%u:%a' "$work") == 0:755 ]] || exit 1
rule="/etc/sudoers.d/$account"
if [[ -e $rule || -L $rule ]]; then
  [[ -f $rule && ! -L $rule && $(stat -c '%u:%a' "$rule") == 0:440 ]] || exit 1
  [[ $(cat "$rule") == "$account ALL=(root) NOPASSWD: $work/receive \"\"" ]] || exit 1
  rule_present=yes
else
  rule_present=no
fi
entry=$(getent passwd "$account")
IFS=: read -r name _ uid _ _ home shell <<< "$entry"
[[ $name == "$account" && $uid =~ ^[0-9]+$ && $uid -gt 0 \
  && $home == "/home/$account" && $shell == /bin/sh ]] || exit 1
for ((waited=0; waited<10; waited++)); do
  pgrep -u "$uid" >/dev/null || break
  sleep 1
done
if pgrep -u "$uid" >/dev/null; then
  echo '시험 계정 프로세스가 실행 중이어서 정리하지 않았습니다.' >&2; exit 1
fi
backup=$(mktemp -d /var/backups/bc250-ssh-boundary-cleanup.XXXXXXXX)
if [[ $rule_present == yes ]]; then
  cp -a -- "$rule" "$backup/sudoers"
  rm -- "$rule"
else
  printf '%s\n' 'sudoers 항목이 정리 전에 이미 없음' > "$backup/sudoers-absent"
fi
printf '%s\n' "$entry" > "$backup/account"
userdel "$account"
echo "시험 계정과 sudoers 정리 완료; 기록 보관: $backup $work $home"
