#!/usr/bin/env bash
# Inspect only fixed, disposable VM gate status; suppress log and environment contents.
set -Eeuo pipefail
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test && $(systemd-detect-virt) == qemu ]] || exit 1
unit=bc250-uncertain-gate-fixture.service
printf '%s\n' '--- 시험 gate 상태 ---'
systemctl show "$unit" -p LoadState -p ActiveState -p SubState -p Result -p ExecMainCode -p ExecMainStatus -p NRestarts -p MainPID -p Job
printf '%s\n' '--- 시험 포트 상태 ---'
if [[ -n $(ss -H -ltn 'sport = :18887') ]]; then echo '18887 수신 중'; else echo '18887 수신 없음'; fi
printf '%s\n' '--- 시험 Python ---'
if [[ -x /opt/bc250-model-control/.venv/bin/python ]]; then echo '시험 Python 실행 파일 있음'; else echo '시험 Python 실행 파일 없음'; fi
printf '%s\n' '--- 시험 gate 로그 오류 유형 ---'
python3 - "$unit" <<'PY'
import subprocess
import sys

unit = sys.argv[1]
result = subprocess.run(['/usr/bin/journalctl', '--no-pager', '--boot', '-u', unit, '-o', 'cat'],
                        capture_output=True, text=True, check=True, timeout=30)
log = result.stdout
patterns = (
    ('ModuleNotFoundError', 'ModuleNotFoundError'),
    ('ImportError', 'ImportError'),
    ('ValidationError', 'ValidationError'),
    ('PermissionError', 'PermissionError'),
    ('Permission denied', 'Permission denied'),
    ('FileNotFoundError', 'FileNotFoundError'),
    ('Address already in use', 'Address already in use'),
    ('Failed to load environment files', 'Failed to load environment files'),
    ('Failed to spawn', 'Failed to spawn'),
    ('Application startup failed', 'Application startup failed'),
    ('Error loading ASGI app', 'Error loading ASGI app'),
    ('Traceback', 'Traceback'),
)
found = [label for pattern, label in patterns if pattern in log]
if found:
    for label in found:
        print('오류 유형 감지:', label)
else:
    print('지정된 오류 유형은 감지되지 않았습니다.')
print('로그 내용·환경값·키는 출력하지 않았습니다.')
PY
