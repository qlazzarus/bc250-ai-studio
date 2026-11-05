#!/usr/bin/env python3
"""Read-only inventory of systemd service User settings, not an access fence."""
import os
import pwd
import re
import subprocess
from collections import Counter


def command(*args):
    return subprocess.run(['/usr/bin/systemctl', '--no-pager', *args], check=True,
                          capture_output=True, text=True, timeout=90).stdout


def service_names(text):
    names = set()
    for line in text.splitlines():
        match = re.search(r'(?:^|\s)([^\s]+\.service)(?=\s|$)', line)
        if match:
            names.add(match.group(1))
    return names


def property_blocks(text):
    blocks = []
    for block in text.strip().split('\n\n'):
        fields = {}
        for line in block.splitlines():
            key, sep, value = line.partition('=')
            if not sep or key in fields:
                raise ValueError('systemd 서비스 속성 형식 오류')
            fields[key] = value
        if not {'Id', 'LoadState'} <= fields.keys():
            raise ValueError('systemd 서비스 속성 누락')
        if fields['LoadState'] == 'loaded' and not {'User', 'DynamicUser'} <= fields.keys():
            raise ValueError('로드된 서비스 계정 속성 누락')
        blocks.append(fields)
    return blocks


def main():
    if os.geteuid() != 0:
        raise ValueError('root 권한이 필요합니다.')
    uid = str(pwd.getpwnam('ai-studio').pw_uid)
    units = service_names(command('list-unit-files', '--type=service', '--no-legend', '--plain'))
    units |= service_names(command('list-units', '--type=service', '--all', '--no-legend', '--plain'))
    if not units:
        raise ValueError('systemd 서비스 목록이 비어 있습니다.')
    matched, unresolved, dynamic = set(), {}, set()
    templates = {unit for unit in units if unit.endswith('@.service')}
    units -= templates
    units = sorted(units)
    for start in range(0, len(units), 40):
        part = units[start:start + 40]
        blocks = property_blocks(command('show', '--all', '-p', 'Id', '-p', 'LoadState',
                                         '-p', 'User', '-p', 'DynamicUser', *part))
        if len(blocks) != len(part):
            raise ValueError('서비스 목록과 속성 수가 다릅니다.')
        for fields in blocks:
            if fields['LoadState'] != 'loaded':
                unresolved[fields['Id']] = fields['LoadState']
            elif fields['User'] in ('ai-studio', uid):
                matched.add(fields['Id'])
            if fields.get('DynamicUser') == 'yes':
                dynamic.add(fields['Id'])
    print('systemd User가 ai-studio인 서비스:')
    for unit in sorted(matched):
        print(' ', unit)
    if not matched:
        print('  없음')
    print('loaded가 아니어서 User를 판단하지 않은 항목 수:', len(unresolved))
    for state, count in sorted(Counter(unresolved.values()).items()):
        print('  로드 상태', state + ':', count)
    print('인스턴스가 없어 따로 판단하지 않은 템플릿 수:', len(templates))
    print('DynamicUser 서비스 수:', len(dynamic))
    print('Studio·gate의 systemd 시작 연관 속성:')
    details = command('show', '--all', '-p', 'Id', '-p', 'ActiveState', '-p', 'TriggeredBy',
                      '-p', 'Restart', 'bc250-ai-studio.service', 'bc250-llm-gate.service')
    for block in details.strip().split('\n\n'):
        fields = dict(line.split('=', 1) for line in block.splitlines() if '=' in line)
        if not {'Id', 'ActiveState', 'TriggeredBy', 'Restart'} <= fields.keys():
            raise ValueError('서비스 시작 연관 속성 누락')
        print(' ', fields['Id'], '상태=' + fields['ActiveState'],
              '자동재시작=' + fields['Restart'], '연관 시작 unit=' + (fields['TriggeredBy'] or '없음'))
    print('systemd 설정의 순간 관찰입니다. 프로세스의 권한 변경·다른 실행 경로·지속 차단은 확인하지 않았습니다.')
    print('환경값·명령줄·파일 내용·키는 출력하지 않았습니다.')


if __name__ == '__main__':
    main()
