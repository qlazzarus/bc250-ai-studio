#!/usr/bin/env python3
"""Read process metadata, report only redacted GPU lock facts; never acquire a lock."""
import os
import pwd
import stat
import subprocess
from pathlib import Path


def values(raw, key):
    items = [entry.partition(b'=')[2] for entry in raw.split(b'\0') if entry.startswith(key + b'=')]
    if len(items) > 1:
        raise ValueError('duplicate')
    return os.fsdecode(items[0]) if items else None


def configured_path(raw, home):
    data = values(raw, b'STUDIO_DATA_DIR')
    lock = values(raw, b'STUDIO_GPU_LOCK_PATH')
    if data == '' or lock == '':
        raise ValueError('empty')
    if lock is not None:
        if not Path(lock).is_absolute():
            return None
        path = Path(lock)
    else:
        base = Path(data) if data is not None else Path(home) / '.local/share/bc250-ai-studio'
        if not base.is_absolute():
            return None
        path = base / 'gpu.lock'
    if '..' in path.parts:
        return None
    return path


def classify(raw, home):
    path = configured_path(raw, home)
    if path is None:
        return 'unknown'
    if path == Path('/opt/ai-studio-data/gpu.lock'):
        return 'legacy'
    if path == Path('/run/bc250-gpu/gpu.lock'):
        return 'new'
    return 'other'


def file_kind(info):
    if info is None:
        return '없음'
    if stat.S_ISLNK(info.st_mode):
        return '심볼릭 링크'
    if stat.S_ISREG(info.st_mode):
        return '일반 파일'
    return '그 외 파일'


def parents_match_candidate(path):
    """Match the candidate fence's root-owned, non-writable parent policy."""
    if path is None:
        return None
    try:
        for parent in path.parents:
            info = parent.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                    or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022):
                return False
    except OSError:
        return None
    return True


def service_pid():
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', 'bc250-ai-studio.service',
        '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job', '-p', 'User'],
        check=True, capture_output=True, text=True, timeout=10)
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or fields.get('User') != 'ai-studio'
            or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('service')
    return int(pid)


def main():
    if os.geteuid() != 0:
        raise ValueError('root')
    account = pwd.getpwnam('ai-studio')
    pid = service_pid()
    proc = Path('/proc') / str(pid)
    if proc.stat().st_uid != account.pw_uid:
        raise ValueError('owner')
    with (proc / 'environ').open('rb') as file:
        raw = file.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('size')
    category = classify(raw, account.pw_dir)
    path = configured_path(raw, account.pw_dir)
    try:
        info = path.lstat() if path else None
    except FileNotFoundError:
        info = None
    regular = bool(info and stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode))
    linked_fd = False
    if regular:
        for fd in (proc / 'fd').iterdir():
            try:
                opened = fd.stat()
            except FileNotFoundError:
                continue
            if (opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino):
                linked_fd = True
                break
    if service_pid() != pid or proc.stat().st_uid != account.pw_uid:
        raise ValueError('changed')
    labels = {'legacy': '기존 Studio 데이터 경로', 'new': '신규 공용 경로', 'other': '그 외 절대 경로', 'unknown': '판단 불가'}
    print('후보 코드 설정 규칙 기준 GPU 잠금 경로 분류:', labels[category])
    print('잠금 경로 선택:', '명시 설정' if values(raw, b'STUDIO_GPU_LOCK_PATH') is not None else '데이터 경로 기본값')
    print('설정 경로의 파일:', file_kind(info) if path is not None else '확인 불가')
    parents = parents_match_candidate(path)
    print('상위 경로가 후보 잠금기의 root 소유·쓰기 제한 조건에 부합:',
          '예' if parents is True else '아니요' if parents is False else '확인 불가')
    if info is not None:
        print('파일 root 소유·단일 링크·기타 사용자 권한 없음:',
              '예' if (regular and info.st_uid == 0 and info.st_nlink == 1
                       and not info.st_mode & 0o007) else '아니요')
    print('Studio 프로세스가 해당 파일을 열고 있음:', '예' if linked_fd else '아니요 또는 확인 불가')
    print('잠금은 획득하지 않았으며 환경값·파일 내용은 출력하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('Studio GPU 잠금 메타데이터를 확인하지 못했습니다.') from None
