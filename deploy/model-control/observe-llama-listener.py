#!/usr/bin/env python3
"""Fail-closed snapshot of a systemd service's expected loopback listener.

This is a momentary observation, not a fence against future binds, privileged
processes, inherited sockets, other network namespaces, or GPU activity.
"""

import os
import re
import subprocess
from pathlib import Path

PROC = Path('/proc')


def listening_inodes(text, port, family):
    if (not isinstance(text, str) or not isinstance(port, int) or not 1 <= port <= 65535
            or family not in {'tcp', 'tcp6'}):
        raise ValueError('TCP 수신 검사 입력 오류')
    lines = text.splitlines()
    if not lines or 'local_address' not in lines[0] or 'st' not in lines[0].split():
        raise ValueError('TCP 수신 표 형식 오류')
    result = []
    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 10:
            raise ValueError('TCP 항목 형식 오류')
        match = re.fullmatch(r'([0-9A-Fa-f]+):([0-9A-Fa-f]{4})', fields[1])
        if not match or not re.fullmatch(r'[0-9A-Fa-f]{2}', fields[3]) or not fields[9].isdigit():
            raise ValueError('TCP 항목 값 오류')
        if int(match[2], 16) == port and fields[3].upper() == '0A':
            result.append((family, match[1].upper(), fields[9]))
    return result


def service_pid(unit):
    if not re.fullmatch(r'[a-zA-Z0-9_.@-]+\.service', unit):
        raise ValueError('systemd 서비스 이름 오류')
    output = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--all', unit, '-p', 'LoadState', '-p', 'ActiveState',
         '-p', 'SubState', '-p', 'MainPID', '-p', 'Job'],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout
    values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    if (values.get('LoadState') != 'loaded' or values.get('ActiveState') != 'active'
            or values.get('SubState') != 'running' or values.get('Job') != ''
            or not values.get('MainPID', '').isdigit() or int(values['MainPID']) <= 1):
        raise ValueError('서비스가 안정적으로 실행 중이지 않습니다.')
    return int(values['MainPID'])


def process_starttime(pid):
    text = (PROC / str(pid) / 'stat').read_text(encoding='ascii')
    close = text.rfind(')')
    if close < 0:
        raise ValueError('프로세스 상태 형식 오류')
    fields = text[close + 1:].split()
    if len(fields) <= 19 or not fields[19].isdigit():
        raise ValueError('프로세스 시작 시각 오류')
    return fields[19]


def snapshot(port):
    entries = []
    for family in ('tcp', 'tcp6'):
        entries.extend(listening_inodes((PROC / 'net' / family).read_text(encoding='ascii'), port, family))
    if len(entries) != 1 or entries[0][:2] != ('tcp', '0100007F'):
        raise ValueError('예상한 단일 IPv4 loopback 수신이 아닙니다.')
    return entries[0][2]


def check_namespaces(pid):
    host_ns = (PROC / '1/ns/net').stat()
    expected = (host_ns.st_dev, host_ns.st_ino)
    for ns in (PROC / 'self/ns/net', PROC / str(pid) / 'ns/net'):
        info = ns.stat()
        if (info.st_dev, info.st_ino) != expected:
            raise ValueError('호스트 네트워크 네임스페이스가 아닙니다.')
    return expected


def listener_identity(port=8080, unit='llama-server.service'):
    if os.geteuid() != 0:
        raise ValueError('root 권한이 필요합니다.')
    pid = service_pid(unit)
    namespace = check_namespaces(pid)
    started = process_starttime(pid)
    inode = snapshot(port)
    descriptors = {os.readlink(path) for path in (PROC / str(pid) / 'fd').iterdir()}
    if f'socket:[{inode}]' not in descriptors:
        raise ValueError('서비스 주 프로세스의 수신 소켓을 확인하지 못했습니다.')
    if (service_pid(unit) != pid or process_starttime(pid) != started or snapshot(port) != inode
            or check_namespaces(pid) != namespace):
        raise ValueError('검사 중 서비스 또는 수신 소켓이 변경됐습니다.')
    return (pid, started, namespace, inode)


def check_listener(port=8080, unit='llama-server.service'):
    listener_identity(port, unit)
    return True


def main():
    try:
        check_listener()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('llama 수신 상태 확인 실패: 서비스와 포트를 확인하세요.') from None
    print('서비스 주 프로세스의 단일 IPv4 loopback 수신 확인')
    print('순간 관찰이며 다른 프로세스의 소켓 공유와 이후 변경은 확인하지 않습니다.')


if __name__ == '__main__':
    main()
