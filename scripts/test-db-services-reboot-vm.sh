#!/usr/bin/env bash
# Two-phase disposable VM unit experiment; the operator reboots between phases.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 2 ]] || exit 1
mode=$2
[[ $mode == prepare || $mode == verify ]] || exit 1
records=/var/backups/bc250-db-services-reboot-fixture
marker_dir=/var/lib/bc250-db-services-reboot-fixture
marker=$marker_dir/blocked
studio=bc250-db-reboot-studio-fixture.service
gate=bc250-db-reboot-gate-fixture.service
trap 'echo "시험 중단. 시험 unit과 기록을 보존합니다: $studio $gate $records $marker_dir" >&2' ERR
if [[ $mode == prepare ]]; then
  for path in "$records" "$marker_dir"; do [[ ! -e $path && ! -L $path ]] || exit 1; done
  for unit in "$studio" "$gate"; do
    [[ ! -e /etc/systemd/system/$unit && ! -L /etc/systemd/system/$unit \
      && ! -e /etc/systemd/system/$unit.d && ! -L /etc/systemd/system/$unit.d \
      && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
  done
  install -d -o root -g root -m 0700 "$records" "$marker_dir"
  cat /proc/sys/kernel/random/boot_id > "$records/boot-before"
  chmod 0600 "$records/boot-before"
  for unit in "$studio" "$gate"; do
    cat > "/etc/systemd/system/$unit" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
Restart=on-failure
KillMode=control-group
[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 "/etc/systemd/system/$unit"
    install -d -o root -g root -m 0755 "/etc/systemd/system/$unit.d"
    cat > "/etc/systemd/system/$unit.d/90-bc250-test.conf" <<EOF
[Unit]
ConditionPathExists=!$marker
[Service]
Restart=no
EOF
    chmod 0644 "/etc/systemd/system/$unit.d/90-bc250-test.conf"
    restorecon -RF "/etc/systemd/system/$unit" "/etc/systemd/system/$unit.d"
    sync -f "/etc/systemd/system/$unit"
    sync -f "/etc/systemd/system/$unit.d/90-bc250-test.conf"
    sync -f "/etc/systemd/system/$unit.d"
  done
  touch "$marker"
  restorecon -RF "$records" "$marker_dir"
  sync -f "$records/boot-before"
  sync -f "$marker"
  sync -f "$marker_dir"
  sync -f "$records"
  systemctl daemon-reload
  systemctl enable "$studio" "$gate" >/dev/null
  sync -f /etc/systemd/system/multi-user.target.wants
  sync -f /etc/systemd/system
else
  [[ -d $records && ! -L $records && -f $records/boot-before && ! -L $records/boot-before \
    && -f $marker && ! -L $marker && $(stat -c %u "$records") == 0 \
    && $(stat -c %u "$marker") == 0 && $(stat -c %u "$records/boot-before") == 0 ]] || exit 1
  [[ $(cat "$records/boot-before") != "$(cat /proc/sys/kernel/random/boot_id)" ]] || {
    echo '시험 VM 재부팅이 확인되지 않았습니다.' >&2; exit 1;
  }
  for unit in "$studio" "$gate"; do
    [[ -f /etc/systemd/system/$unit && ! -L /etc/systemd/system/$unit \
      && -f /etc/systemd/system/$unit.d/90-bc250-test.conf \
      && ! -L /etc/systemd/system/$unit.d/90-bc250-test.conf \
      && $(systemctl show "$unit" -p FragmentPath --value) == "/etc/systemd/system/$unit" ]] || exit 1
    cmp -s "/etc/systemd/system/$unit" <(printf '[Service]\nExecStart=/usr/bin/sleep infinity\nRestart=on-failure\nKillMode=control-group\n[Install]\nWantedBy=multi-user.target\n') || exit 1
    cmp -s "/etc/systemd/system/$unit.d/90-bc250-test.conf" <(printf '[Unit]\nConditionPathExists=!%s\n[Service]\nRestart=no\n' "$marker") || exit 1
    systemctl is-enabled --quiet "$unit"
    [[ $(systemctl show "$unit" -p ActiveState --value) == inactive \
      && $(systemctl show "$unit" -p MainPID --value) == 0 \
      && $(systemctl show "$unit" -p ConditionResult --value) == no \
      && $(systemctl show "$unit" -p Restart --value) == no ]] || {
        echo "시험 재부팅 직후 조건 상태 확인 실패: $unit" >&2; exit 1;
      }
  done
  echo '시험 VM 재부팅 직후 자동 시작 조건 차단과 Restart=no 확인'
fi
for unit in "$studio" "$gate"; do
  systemctl is-enabled --quiet "$unit"
  systemctl start "$unit" || true
  [[ $(systemctl show "$unit" -p LoadState --value) == loaded \
    && $(systemctl show "$unit" -p ActiveState --value) == inactive \
    && $(systemctl show "$unit" -p MainPID --value) == 0 \
    && $(systemctl show "$unit" -p ConditionResult --value) == no \
    && $(systemctl show "$unit" -p Restart --value) == no ]] || {
      echo "시험 영구 조건과 정지 상태 확인 실패: $unit" >&2; exit 1;
    }
done
if [[ $mode == prepare ]]; then
  echo '시험 두 unit의 영구 조건·Restart=no·자동 시작 설정과 정지 확인'
  echo "시험 재부팅 준비 완료; 시험 unit과 기록을 유지합니다: $records"
  trap - ERR
  exit 0
fi
echo '시험 VM 재부팅 후 두 unit의 영구 조건·Restart=no·정지 확인'
cp -a -- "$marker" "$records/blocked.evidence"
rm -- "$marker"
for unit in "$studio" "$gate"; do
  rm -- "/etc/systemd/system/$unit.d/90-bc250-test.conf"
  rmdir -- "/etc/systemd/system/$unit.d"
done
systemctl daemon-reload
systemctl start "$studio" "$gate"
for unit in "$studio" "$gate"; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == active \
    && $(systemctl show "$unit" -p Restart --value) == on-failure ]] || exit 1
done
echo '시험 차단 해제 후 두 unit의 기존 정책과 시작 확인'
systemctl stop "$studio" "$gate"
systemctl disable "$studio" "$gate" >/dev/null
rm -- "/etc/systemd/system/$studio" "/etc/systemd/system/$gate"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 시험 기록과 차단 표시 사본 보관: $records"
echo '두 시험 unit만 검증했습니다. 실제 서비스·DB 직접 쓰기와 운영 복구는 시험하지 않았습니다.'
