#!/usr/bin/env python3
"""Redacted snapshot of potential DB owner and privileged processes; not a fence."""
import os
import subprocess
from pathlib import Path

PROC = Path('/proc')
DATA = Path('/opt/ai-studio-data')


def parse_status(text):
    fields = {}
    for line in text.splitlines():
        key, sep, value = line.partition(':')
        if sep and key in ('Uid', 'CapEff', 'CapPrm', 'CapAmb'):
            if key in fields:
                raise ValueError('중복 프로세스 상태')
            fields[key] = value.split()
    if len(fields.get('Uid', [])) != 4 or any(not v.isdecimal() for v in fields['Uid']):
        raise ValueError('프로세스 UID 확인 실패')
    caps = []
    for key in ('CapEff', 'CapPrm', 'CapAmb'):
        value = fields.get(key, [])
        if len(value) != 1:
            raise ValueError('프로세스 capability 확인 실패')
        caps.append(int(value[0], 16))
    return tuple(map(int, fields['Uid'])), any(caps)


def service_pid(unit):
    r = subprocess.run(['/usr/bin/systemctl', 'show', unit,
                        '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'],
                       capture_output=True, text=True, check=True, timeout=10)
    fields = dict(line.split('=', 1) for line in r.stdout.splitlines())
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('서비스 주 프로세스 확인 실패')
    return int(pid)


def observe(proc, owner, studio, gate):
    counts = {'owner': 0, 'root': 0, 'capabilities': 0, 'other_mount': 0,
              'unknown': 0, 'vanished': 0, 'owner_other': 0, 'owner_gate': 0}
    host_mount = os.readlink(proc / '1/ns/mnt')
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            uids, has_caps = parse_status((entry / 'status').read_text(encoding='ascii'))
            if int(entry.name) != studio and owner in uids:
                counts['owner'] += 1
                if int(entry.name) == gate:
                    counts['owner_gate'] += 1
                else:
                    counts['owner_other'] += 1
            if 0 in uids:
                counts['root'] += 1
            if has_caps:
                counts['capabilities'] += 1
            if os.readlink(entry / 'ns/mnt') != host_mount:
                counts['other_mount'] += 1
        except (FileNotFoundError, ProcessLookupError):
            counts['vanished'] += 1
        except (OSError, ValueError, UnicodeError):
            counts['unknown'] += 1
    return counts


def main():
    if os.geteuid() != 0:
        raise ValueError('root 권한이 필요합니다.')
    owner = DATA.stat().st_uid
    pid = service_pid('bc250-ai-studio.service')
    gate = service_pid('bc250-llm-gate.service')
    if gate == pid:
        raise ValueError('서비스 주 프로세스가 같습니다.')
    uid, _ = parse_status((PROC / str(pid) / 'status').read_text(encoding='ascii'))
    if uid[1] != owner or owner == 0:
        raise ValueError('Studio 실행 계정과 데이터 소유자가 다르거나 root입니다.')
    counts = observe(PROC, owner, pid, gate)
    if (service_pid('bc250-ai-studio.service') != pid
            or service_pid('bc250-llm-gate.service') != gate or DATA.stat().st_uid != owner):
        raise ValueError('관찰 중 Studio 프로세스 또는 소유자가 변경됐습니다.')
    print('Studio 주 프로세스 외 소유자 UID를 가진 프로세스 수:', counts['owner'])
    print('그중 gate 주 프로세스 수:', counts['owner_gate'])
    print('Studio·gate 주 프로세스 외 같은 UID 프로세스 수:', counts['owner_other'])
    print('root UID를 가진 프로세스 수:', counts['root'])
    print('capability를 가진 프로세스 수:', counts['capabilities'])
    print('PID 1과 다른 mount 네임스페이스 프로세스 수:', counts['other_mount'])
    print('권한·형식 등으로 확인하지 못한 프로세스 수:', counts['unknown'])
    print('관찰 중 사라진 프로세스 수:', counts['vanished'])
    print('항목은 중복될 수 있으며 순간 관찰입니다. 실제 DB 접근이나 지속 차단을 판정하지 않습니다.')
    print('환경값·명령줄·파일 내용·키는 읽거나 출력하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print('읽기 전용 관찰 실패:', type(exc).__name__)
        raise SystemExit(1)
