#!/usr/bin/env python3
"""Fail-closed snapshot of sockets accepted on the local llama port.

This does not block new connections, inspect other network namespaces, or
prove GPU idleness. The caller must maintain independent ingress fences.
"""
import os
import re
from pathlib import Path

PROC = Path('/proc')
LLAMA_PORT = 8080
TCP_STATES = frozenset(f'{i:02X}' for i in range(1, 13))
INACTIVE = frozenset({'06', '0A'})  # TIME_WAIT and LISTEN


def busy_listener_connections(text, port):
    if not isinstance(port, int) or not 1 <= port <= 65535 or not isinstance(text, str):
        raise ValueError('TCP 검사 입력이 올바르지 않습니다.')
    lines = text.splitlines()
    if not lines or 'local_address' not in lines[0] or 'st' not in lines[0].split():
        raise ValueError('TCP 표 형식이 올바르지 않습니다.')
    count = 0
    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 4 or not re.fullmatch(r'[0-9A-Fa-f]+:[0-9A-Fa-f]{4}', fields[1]):
            raise ValueError('TCP 항목 형식이 올바르지 않습니다.')
        state = fields[3].upper()
        if state not in TCP_STATES:
            raise ValueError('알 수 없는 TCP 상태가 있습니다.')
        if int(fields[1].rsplit(':', 1)[1], 16) == port and state not in INACTIVE:
            count += 1
    return count


def check_host_llama():
    if os.geteuid() != 0:
        raise ValueError('root 권한이 필요합니다.')
    host_ns = (PROC / '1/ns/net').stat()
    caller_ns = (PROC / 'self/ns/net').stat()
    if (host_ns.st_dev, host_ns.st_ino) != (caller_ns.st_dev, caller_ns.st_ino):
        raise ValueError('PID 1의 네트워크 네임스페이스와 다릅니다.')
    for table in ('tcp', 'tcp6'):
        if busy_listener_connections((PROC / 'net' / table).read_text(encoding='ascii'), LLAMA_PORT):
            raise ValueError('llama 포트에 종료되지 않은 TCP 연결이 있습니다.')
    after = (PROC / 'self/ns/net').stat()
    if (caller_ns.st_dev, caller_ns.st_ino) != (after.st_dev, after.st_ino):
        raise ValueError('TCP 검사 중 네트워크 네임스페이스가 변경됐습니다.')
    return True
