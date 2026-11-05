#!/usr/bin/env python3
"""Observe DB references held by the two current service main processes only."""
import os
import subprocess

DATA_ROOT = '/opt/ai-studio-data'
DATABASE = '/opt/ai-studio-data/database/studio.sqlite3'
UNITS = (('Studio', 'bc250-ai-studio.service'), ('gate', 'bc250-llm-gate.service'))


def unit_pid(unit):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit,
                             '-pLoadState', '-pActiveState', '-pMainPID', '-pJob'],
                            check=True, capture_output=True, text=True, timeout=10)
    values = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in values:
            raise ValueError('서비스 속성 오류')
        values[key] = value
    pid = values.get('MainPID', '')
    if (set(values) != {'LoadState', 'ActiveState', 'MainPID', 'Job'}
            or values['LoadState'] != 'loaded' or values['ActiveState'] != 'active'
            or values['Job'] or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('서비스 상태 확인 실패')
    return int(pid)


def inspect(observe_known_processes):
    if os.geteuid() != 0 or not callable(observe_known_processes):
        raise ValueError('root와 읽기 전용 검사기가 필요합니다.')
    before = {name: unit_pid(unit) for name, unit in UNITS}
    if len(set(before.values())) != len(before):
        raise ValueError('서비스 주 프로세스가 구분되지 않습니다.')
    result = observe_known_processes(tuple(before.values()), DATA_ROOT, DATABASE)
    if before != {name: unit_pid(unit) for name, unit in UNITS}:
        raise ValueError('관찰 중 서비스가 변경됐습니다.')
    allowed = {'fd', 'cwd', 'root', 'mapping', 'mapping-ambiguous'}
    if set(result) != set(before.values()) or any(not refs <= allowed for refs in result.values()):
        raise ValueError('프로세스 관찰 결과 오류')
    return {name: result[pid] for name, pid in before.items()}


if __name__ == '__main__':
    try:
        observed = inspect(observe_known_processes)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit('서비스 또는 DB 참조를 안전하게 확인하지 못했습니다. 상태를 변경하지 않았습니다.') from None
    for role, refs in observed.items():
        print(f'{role} 주 프로세스의 DB 관련 참조: ' + (', '.join(sorted(refs)) if refs else '없음'))
    print('두 주 프로세스의 순간 관찰입니다. 다른 프로세스·새 참조·지속 차단은 확인하지 않았습니다.')
    print('파일 내용·환경값·명령줄·키를 출력하지 않았으며 서비스를 변경하지 않았습니다.')
