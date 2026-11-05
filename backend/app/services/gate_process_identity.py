#!/usr/bin/env python3
"""Read-only gate credential snapshot; it does not establish an access fence."""

import grp
import os
import pwd
import re
import subprocess
from pathlib import Path

PROC = Path('/proc')


def process_credentials(text, uid, gid):
    if not isinstance(text, str):
        raise ValueError('프로세스 상태 형식 오류')
    fields = {}
    for line in text.splitlines():
        name, separator, value = line.partition(':')
        if separator and name in {'Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapAmb', 'NoNewPrivs'}:
            if name in fields:
                raise ValueError('중복 프로세스 상태')
            fields[name] = value.strip()
    if set(fields) != {'Uid', 'Gid', 'Groups', 'CapInh', 'CapPrm', 'CapEff', 'CapAmb', 'NoNewPrivs'}:
        raise ValueError('프로세스 권한 정보를 확인하지 못했습니다.')
    for name, expected in (('Uid', uid), ('Gid', gid)):
        values = fields[name].split()
        if len(values) != 4 or any(not value.isdecimal() or int(value) != expected for value in values):
            raise ValueError('프로세스 계정이 예상과 다릅니다.')
    groups = fields['Groups'].split()
    if any(not value.isdecimal() or int(value) != gid for value in groups):
        raise ValueError('예상하지 않은 보조 그룹이 있습니다.')
    for name in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'):
        if not re.fullmatch(r'[0-9A-Fa-f]+', fields[name]) or int(fields[name], 16) != 0:
            raise ValueError('프로세스 capability가 비어 있지 않습니다.')
    if fields['NoNewPrivs'] != '1':
        raise ValueError('프로세스의 NoNewPrivileges가 적용되지 않았습니다.')


def unit_identity(unit, expected_user, expected_group):
    if not re.fullmatch(r'[a-zA-Z0-9_.@-]+\.service', unit):
        raise ValueError('서비스 이름 오류')
    output = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--all', unit, '-p', 'LoadState', '-p', 'ActiveState',
         '-p', 'SubState', '-p', 'MainPID', '-p', 'Job', '-p', 'User', '-p', 'Group'],
        check=True, capture_output=True, text=True, timeout=10,
    ).stdout
    fields = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('서비스 속성 형식 오류')
        fields[key] = value
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('SubState') != 'running' or fields.get('Job') != ''
            or fields.get('User') != expected_user or fields.get('Group') != expected_group
            or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('gate 서비스 계정 또는 실행 상태 오류')
    return int(pid)


def starttime(pid):
    text = (PROC / str(pid) / 'stat').read_text(encoding='ascii')
    close = text.rfind(')')
    fields = text[close + 1:].split() if close >= 0 else []
    if len(fields) <= 19 or not fields[19].isdecimal():
        raise ValueError('프로세스 시작 시각 오류')
    return fields[19]


def observe(unit='bc250-llm-gate.service', client_user='yeppyshiba'):
    if os.geteuid() != 0 or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', client_user):
        raise ValueError('root와 유효한 Client 계정이 필요합니다.')
    gate = pwd.getpwnam('ai-gate')
    studio = pwd.getpwnam('ai-studio')
    client = pwd.getpwnam(client_user)
    gid = grp.getgrnam('ai-gate').gr_gid
    if 0 in (gate.pw_uid, studio.pw_uid, client.pw_uid, gid) or len({gate.pw_uid, studio.pw_uid, client.pw_uid}) != 3:
        raise ValueError('gate·Studio·Client 계정 UID가 분리되지 않았습니다.')
    pid = unit_identity(unit, 'ai-gate', 'ai-gate')
    initial = starttime(pid)
    process_credentials((PROC / str(pid) / 'status').read_text(encoding='ascii'), gate.pw_uid, gid)
    if unit_identity(unit, 'ai-gate', 'ai-gate') != pid or starttime(pid) != initial:
        raise ValueError('검사 중 gate 서비스가 재시작됐습니다.')
    return (pid, initial, gate.pw_uid, gid)


if __name__ == '__main__':
    try:
        observe()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('gate 계정과 프로세스 권한 확인 실패') from None
    print('gate·Studio·Client 계정 분리와 gate 주 프로세스 권한 확인')
    print('순간 관찰이며 다른 프로세스·다른 접근 경로나 지속 차단은 확인하지 않습니다.')
