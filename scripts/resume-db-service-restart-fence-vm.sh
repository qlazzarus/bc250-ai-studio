#!/usr/bin/env bash
# Resume only the explicitly identified disposable VM fixture.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
suffix=$1
[[ $suffix =~ ^[A-Za-z0-9]{8}$ ]] || exit 1
fixture=/var/backups/bc250-db-restart-fence.$suffix
marker=$fixture/blocked
studio=bc250-db-studio-$suffix.service
gate=bc250-db-gate-$suffix.service
[[ -d $fixture && ! -L $fixture && -f $marker && ! -L $marker \
  && $(stat -c %u "$fixture") == 0 && $(stat -c %u "$marker") == 0 \
  && ! -e $fixture/blocked.evidence && ! -L $fixture/blocked.evidence ]] || exit 1
for unit in "$studio" "$gate"; do
  file=/run/systemd/system/$unit
  [[ -f $file && ! -L $file && ! -e /etc/systemd/system/$unit \
    && $(systemctl show "$unit" -p FragmentPath --value) == "$file" ]] || exit 1
  cmp -s "$file" <(printf '[Unit]\nConditionPathExists=!%s\n[Service]\nExecStart=/usr/bin/sleep infinity\nRestart=on-failure\nRestartSec=1\nKillMode=control-group\n' "$marker") || {
    echo "시험 unit 내용 불일치: $unit" >&2; exit 1;
  }
done
trap 'echo "시험 중단. 시험 unit과 기록 보존: $studio $gate $fixture" >&2' ERR
for unit in "$studio" "$gate"; do
  systemctl stop "$unit"
  systemctl start "$unit" || true
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && $(systemctl show "$unit" -p ConditionResult --value) == no \
    && $(systemctl show "$unit" -p MainPID --value) == 0 ]] || {
    echo "시험 명시적 시작 차단 확인 실패: $unit" >&2; exit 1;
  }
done
echo '차단 표시가 있을 때 정지된 두 시험 서비스의 명시적 시작 거절 확인'
cp -a -- "$marker" "$fixture/blocked.evidence"
rm -- "$marker"
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active ]] || exit 1
done
echo '표시 제거 후 두 시험 서비스 시작 확인'
systemctl stop "$studio" "$gate"
rm -- "/run/systemd/system/$studio" "/run/systemd/system/$gate"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 차단 표시 사본과 기록 보관: $fixture"
echo '이번 시험은 이미 관찰된 자동 재시작 실패를 해결하지 않습니다.'
