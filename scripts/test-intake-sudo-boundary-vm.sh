#!/usr/bin/env bash
# Isolated VM only: no SSH keys, existing accounts, or production services.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
work=$(mktemp -d /opt/bc250-sudo-boundary.XXXXXXXX)
chmod 0755 "$work"
suffix=${work##*.}
account="bci${suffix,,}"
rule="/etc/sudoers.d/$account"
getent passwd "$account" >/dev/null && { echo '시험 계정 이름이 이미 존재합니다.' >&2; exit 1; }
[[ ! -e "$rule" ]] || exit 1
trap 'echo "시험 중단. 계정·sudoers와 기록 확인: $account $rule $work" >&2' ERR
useradd -M -s /sbin/nologin "$account"
cat > "$work/receive" <<'EOF'
#!/bin/sh
[ "$#" -eq 0 ] || exit 1
[ "$(id -u)" -eq 0 ] || exit 1
printf '%s\n' fixture-receiver-ok
EOF
chmod 0755 "$work/receive"
printf '%s ALL=(root) NOPASSWD: %s/receive ""\n' "$account" "$work" > "$rule"
chmod 0440 "$rule"
restorecon "$work" "$work/receive" "$rule"
visudo -cf "$rule" >/dev/null
result=$(runuser -u "$account" -- sudo -n "$work/receive")
[[ $result == fixture-receiver-ok ]]
echo '시험 계정의 인자 없는 고정 root 명령 허용 확인'
if runuser -u "$account" -- sudo -n "$work/receive" extra >/dev/null 2>&1; then
  echo '시험 명령의 임의 인자가 허용됐습니다.' >&2; exit 1
fi
if runuser -u "$account" -- sudo -n /usr/bin/id >/dev/null 2>&1; then
  echo '시험 계정의 다른 root 명령이 허용됐습니다.' >&2; exit 1
fi
echo '시험 계정의 임의 인자와 다른 root 명령 거절 확인'
rm -- "$rule"
userdel "$account"
trap - ERR
echo "시험 계정과 sudoers 정리 완료; 시험 파일 보관: $work"
echo 'SSH 인증·강제 명령·후보 수신·Actions 승인과 운영 권한은 시험하지 않았습니다.'
