#!/usr/bin/env python3
"""Read-only, redacted inspection of the running production Studio process."""
import os
import pwd
import stat
import subprocess
from pathlib import Path

UNIT = 'bc250-ai-studio.service'
EXPECTED = Path('/opt/ai-studio-data')


def service_pid():
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', UNIT, '-p', 'LoadState',
        '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job', '-p', 'User'],
        capture_output=True, text=True, check=True, timeout=10)
    fields = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in fields:
            raise ValueError('서비스 상태를 확인하지 못했습니다.')
        fields[key] = value
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or fields.get('User') != 'ai-studio'
            or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('예상한 Studio 서비스가 실행 중이지 않습니다.')
    return int(pid)


def data_dir(raw, home):
    matches = [item.partition(b'=')[2] for item in raw.split(b'\0')
               if item.startswith(b'STUDIO_DATA_DIR=')]
    if len(matches) > 1:
        raise ValueError('Studio 데이터 경로 설정이 중복됐습니다.')
    if matches:
        value = os.fsdecode(matches[0])
        if not value:
            raise ValueError('Studio 데이터 경로 설정이 비어 있습니다.')
        # Only an absolute path can establish equality without reading or
        # printing further process environment such as HOME and cwd.
        return Path(value).resolve() if Path(value).is_absolute() else None
    return (Path(home) / '.local/share/bc250-ai-studio').resolve()


def main():
    if os.geteuid() != 0:
        raise ValueError('root 권한이 필요합니다.')
    pid = service_pid()
    account = pwd.getpwnam('ai-studio')
    proc = Path('/proc') / str(pid)
    if proc.stat().st_uid != account.pw_uid:
        raise ValueError('Studio 프로세스 소유자가 예상과 다릅니다.')
    with (proc / 'environ').open('rb') as file:
        raw = file.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ValueError('Studio 프로세스 환경이 너무 큽니다.')
    actual = data_dir(raw, account.pw_dir)
    db = EXPECTED / 'database/studio.sqlite3'
    try:
        info = db.lstat()
        regular = stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
    except FileNotFoundError:
        regular = False
    if service_pid() != pid or proc.stat().st_uid != account.pw_uid:
        raise ValueError('확인 중 Studio 서비스가 변경됐습니다.')
    print('실행 중인 Studio 데이터 경로가 예상과 일치:', '예' if actual == EXPECTED else '아니요')
    print('예상 위치의 Studio 데이터베이스 일반 파일:', '있음' if regular else '없음 또는 링크')
    print('파일 내용과 프로세스 환경값은 출력하지 않았습니다. 서비스를 변경하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        raise SystemExit('Studio 실행 상태 또는 데이터 경로를 확인하지 못했습니다.') from None
