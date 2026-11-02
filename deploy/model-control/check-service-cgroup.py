#!/usr/bin/env python3
"""Fail closed if a stopped service's expected cgroup contains processes."""

import os
import re
import sys
from pathlib import Path


def check(unit, properties, root=Path('/sys/fs/cgroup')):
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+\.service', unit):
        raise ValueError('서비스 이름이 올바르지 않습니다.')
    fields = {}
    for line in properties.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in fields:
            raise ValueError('서비스 속성을 확인하지 못했습니다.')
        fields[key] = value
    if fields.get('Slice') != 'system.slice':
        raise ValueError('서비스 slice를 확인하지 못했습니다.')
    group = fields.get('ControlGroup')
    expected = '/system.slice/' + unit
    if group not in ('', expected):
        raise ValueError('서비스 cgroup 경로가 예상과 다릅니다.')
    if not (root / 'cgroup.controllers').is_file() or not (root / 'system.slice').is_dir():
        raise ValueError('cgroup v2 system.slice를 확인하지 못했습니다.')
    folder = root / 'system.slice' / unit
    if folder.is_symlink():
        raise ValueError('서비스 cgroup 경로가 링크입니다.')
    if not folder.exists():
        if group:
            raise ValueError('systemd가 보고한 cgroup이 없습니다.')
        return
    if folder.resolve() != folder.absolute():
        raise ValueError('서비스 cgroup 경로를 확인하지 못했습니다.')

    def onerror(error):
        raise error

    for directory, dirs, files in os.walk(folder, followlinks=False, onerror=onerror):
        if any((Path(directory) / name).is_symlink() for name in dirs):
            raise ValueError('서비스 cgroup에 링크가 있습니다.')
        if 'cgroup.procs' not in files:
            raise ValueError('서비스 cgroup 프로세스를 확인하지 못했습니다.')
        if (Path(directory) / 'cgroup.procs').read_text(encoding='ascii').strip():
            raise ValueError('서비스 cgroup에 프로세스가 남아 있습니다.')


def main():
    if len(sys.argv) != 3:
        raise SystemExit('서비스와 systemd 속성을 전달하세요.')
    try:
        check(sys.argv[1], sys.argv[2])
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(f'서비스 cgroup 확인 실패: {exc}') from None


if __name__ == '__main__':
    main()
