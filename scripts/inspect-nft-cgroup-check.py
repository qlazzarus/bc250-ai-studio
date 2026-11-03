#!/usr/bin/env python3
"""Validate a throwaway nft expression without installing rules or changing services."""

import os
import re
import secrets
import shutil
import subprocess


def service_cgroup(unit):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit,
                             '-p', 'LoadState', '-p', 'ActiveState', '-p', 'ControlGroup', '-p', 'Job'],
                            check=True, capture_output=True, text=True, timeout=10)
    fields = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('서비스 상태 형식 오류')
        fields[key] = value
    path = fields.get('ControlGroup', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or path != '/system.slice/' + unit):
        raise ValueError('서비스 또는 cgroup 상태가 예상과 다릅니다')
    return path[1:]


def check_expression(nft, gate_cgroup):
    if not re.fullmatch(r'system\.slice/bc250-llm-gate\.service', gate_cgroup):
        raise ValueError('gate cgroup 경로가 예상과 다릅니다')
    table = 'bc250_check_' + secrets.token_hex(8)
    rules = (f'table inet {table} {{\n'
             ' chain output {\n'
             '  type filter hook output priority 0; policy accept;\n'
             f'  socket cgroupv2 level 2 "{gate_cgroup}" counter\n'
             ' }\n}\n')
    return subprocess.run([nft, '--check', '--file', '-'], input=rules,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                          text=True, check=False, timeout=20).returncode == 0


def main():
    if os.geteuid() != 0:
        raise ValueError('root 권한 필요')
    nft = shutil.which('nft')
    if not nft:
        raise ValueError('nft 실행 파일 없음')
    gate = service_cgroup('bc250-llm-gate.service')
    studio = service_cgroup('bc250-ai-studio.service')
    if gate == studio:
        raise ValueError('서비스 cgroup이 분리되지 않았습니다')
    print('실행 중인 gate와 Studio의 systemd cgroup: 서로 다름')
    if not check_expression(nft, gate):
        raise ValueError('nft cgroup 표현식 검사 실패; 원인은 이 결과만으로 확정할 수 없습니다')
    if service_cgroup('bc250-llm-gate.service') != gate or service_cgroup('bc250-ai-studio.service') != studio:
        raise ValueError('관찰 중 서비스 cgroup이 변경됐습니다')
    print('nft --check에서 gate cgroup 표현식 검증 완료')
    print('규칙 적용, 패킷 차단, 다른 네임스페이스 및 재시작 후 보존은 확인하지 않았습니다.')
    print('방화벽 규칙·환경값·키를 출력하지 않았으며 서비스를 변경하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error)) from None
