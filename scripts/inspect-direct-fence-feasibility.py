#!/usr/bin/env python3
"""Redacted observation for fence design; never proves isolation or GPU idleness."""

import os
import shutil
import subprocess
from pathlib import Path

SERVICES = {
    'gate': 'bc250-llm-gate.service',
    'Studio': 'bc250-ai-studio.service',
    'Client': 'bc250-llm-client.service',
    'Wiki': 'bc250-family-wiki.service',
    'llama': 'llama-server.service',
}


def service_identity(unit, proc=Path('/proc')):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit,
                             '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'],
                            check=True, capture_output=True, text=True, timeout=10)
    fields = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('서비스 상태 형식 오류')
        fields[key] = value
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('실행 중인 서비스 확인 실패')
    status = (proc / pid / 'status').read_text(encoding='utf-8')
    uid_fields = [line.split() for line in status.splitlines() if line.startswith('Uid:')]
    if len(uid_fields) != 1 or len(uid_fields[0]) != 5 or not uid_fields[0][2].isdigit():
        raise ValueError('실행 계정 확인 실패')
    uid = int(uid_fields[0][2])
    # A restarted service must not be mistaken for the process just observed.
    second = subprocess.run(['/usr/bin/systemctl', 'show', unit, '-p', 'MainPID', '--value'],
                            check=True, capture_output=True, text=True, timeout=10).stdout.strip()
    if second != pid:
        raise ValueError('서비스 관찰 중 프로세스 변경')
    return int(pid), uid


def net_namespace_counts(proc=Path('/proc')):
    host = os.readlink(proc / '1/ns/net')
    namespaces = set()
    missing = 0
    for path in proc.iterdir():
        if not path.name.isdecimal():
            continue
        try:
            namespaces.add(os.readlink(path / 'ns/net'))
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            missing += 1
    return len(namespaces - {host}), missing


def other_same_uid_processes(uid, known_pids, proc=Path('/proc')):
    host = os.readlink(proc / '1/ns/net')
    same_namespace = other_namespace = incomplete = disappeared = 0
    for path in proc.iterdir():
        if not path.name.isdecimal() or int(path.name) in known_pids:
            continue
        try:
            status = (path / 'status').read_text(encoding='utf-8')
            entries = [line.split() for line in status.splitlines() if line.startswith('Uid:')]
            if len(entries) != 1 or len(entries[0]) != 5 or not entries[0][2].isdigit():
                incomplete += 1
                continue
            if int(entries[0][2]) != uid:
                continue
            namespace = os.readlink(path / 'ns/net')
            if namespace == host:
                same_namespace += 1
            else:
                other_namespace += 1
        except (FileNotFoundError, ProcessLookupError):
            disappeared += 1
        except PermissionError:
            incomplete += 1
    return same_namespace, other_namespace, incomplete, disappeared


def main():
    if os.geteuid() != 0:
        raise ValueError('root 권한 필요')
    identities = {label: service_identity(unit) for label, unit in SERVICES.items()}
    print('실행 중인 다섯 서비스의 계정 분리 관찰:')
    for label in ('Studio', 'Client', 'Wiki', 'llama'):
        print(f'  gate와 {label}:', '동일 실행 UID' if identities['gate'][1] == identities[label][1] else '서로 다른 실행 UID')
    print('gate 실행 UID가 root:', '예' if identities['gate'][1] == 0 else '아니요')
    other, missing = net_namespace_counts()
    print('PID 1과 다른 네트워크 네임스페이스 수:', other)
    print('권한으로 네임스페이스를 확인하지 못한 프로세스 수:', missing)
    same, other_uid_ns, incomplete, disappeared = other_same_uid_processes(
        identities['gate'][1], {identities['gate'][0], identities['Studio'][0]})
    print('gate·Studio 주 프로세스 외 같은 UID의 호스트 네임스페이스 프로세스 수:', same)
    print('gate·Studio 주 프로세스 외 같은 UID의 다른 네임스페이스 프로세스 수:', other_uid_ns)
    print('계정 또는 네임스페이스를 확인하지 못한 프로세스 수:', incomplete)
    print('관찰 중 사라져 확인하지 못한 프로세스 수:', disappeared)
    print('nft 실행 파일:', '있음' if shutil.which('nft') else '없음')
    print('순간 관찰이며 신규 호출 차단·GPU 유휴·UID 기반 차단 가능성을 증명하지 않습니다.')
    print('계정 값·환경값·명령줄·방화벽 규칙과 키는 출력하지 않았으며 서비스를 변경하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('실행 계정 또는 네임스페이스를 확인하지 못했습니다. 서비스를 변경하지 않았습니다.') from None
