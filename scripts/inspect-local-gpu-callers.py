#!/usr/bin/env python3
"""Redacted read-only snapshot, never a fence or proof of GPU idleness."""
import ipaddress
import os
import re
import stat
import struct
from pathlib import Path

PROC = Path('/proc')


def remote_is_loopback(value, version):
    try:
        encoded, port = value.split(':')
        if int(port, 16) != 8080:
            return False
        if version == 4:
            address = ipaddress.IPv4Address(struct.pack('<I', int(encoded, 16)))
        else:
            if len(encoded) != 32:
                return False
            address = ipaddress.IPv6Address(b''.join(
                struct.pack('<I', int(encoded[index:index + 8], 16)) for index in range(0, 32, 8)))
            if address.ipv4_mapped is not None:
                address = address.ipv4_mapped
        return address.is_loopback
    except (ValueError, struct.error):
        raise ValueError('TCP 상태 형식을 확인하지 못했습니다.') from None


def socket_inodes(path, version):
    lines = path.read_text(encoding='ascii').splitlines()
    if not lines:
        raise ValueError('TCP 상태가 비어 있습니다.')
    result = set()
    for row in lines[1:]:
        fields = row.split()
        if len(fields) < 10:
            raise ValueError('TCP 상태 형식이 올바르지 않습니다.')
        if fields[3] == '01' and remote_is_loopback(fields[2], version):
            if not fields[9].isdigit():
                raise ValueError('TCP 소켓 식별자가 올바르지 않습니다.')
            result.add(fields[9])
    return result


def main():
    if os.geteuid() != 0:
        raise ValueError('root가 필요합니다.')
    inodes = socket_inodes(PROC / 'net/tcp', 4) | socket_inodes(PROC / 'net/tcp6', 6)
    owners = set()
    found_inodes = set()
    gpu_owners = set()
    incomplete = 0
    for proc in PROC.iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            descriptors = list((proc / 'fd').iterdir())
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            incomplete += 1
            continue
        for fd in descriptors:
            try:
                link = os.readlink(fd)
                match = re.fullmatch(r'socket:\[([0-9]+)\]', link)
                if match and match.group(1) in inodes:
                    owners.add(int(proc.name))
                    found_inodes.add(match.group(1))
                info = fd.stat()
                if stat.S_ISCHR(info.st_mode) and os.major(info.st_rdev) == 226:
                    gpu_owners.add(int(proc.name))
            except (FileNotFoundError, ProcessLookupError):
                continue
            except PermissionError:
                incomplete += 1
    print('현재 네트워크 네임스페이스의 loopback 8080 연결 수:', len(inodes))
    print('해당 연결에서 소유자를 찾은 PID:', ', '.join(map(str, sorted(owners))) or '없음')
    print('소유자를 찾지 못한 연결 수:', len(inodes - found_inodes))
    print('DRM 장치 파일을 연 PID:', ', '.join(map(str, sorted(gpu_owners))) or '없음')
    print('권한으로 검사하지 못한 프로세스·파일 항목 수:', incomplete)
    print('순간 관찰이며 다른 네임스페이스, 이후 요청, GPU 유휴 또는 지속 차단을 보증하지 않습니다.')
    print('환경값·명령줄·파일 내용·키는 읽거나 출력하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError):
        raise SystemExit('로컬 호출·GPU 장치 관찰을 완료하지 못했습니다.') from None
