#!/usr/bin/env python3
"""Report only non-secret metadata needed to plan a Studio release replacement."""

import os
import stat
import subprocess
from pathlib import Path


def metadata(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return '없음'
    except OSError:
        return '조회 실패'
    if stat.S_ISLNK(info.st_mode):
        kind = '링크'
    elif stat.S_ISDIR(info.st_mode):
        kind = '디렉터리'
    elif stat.S_ISREG(info.st_mode):
        kind = '일반 파일'
    else:
        kind = '기타'
    return f'{kind}, uid={info.st_uid}, gid={info.st_gid}, mode={stat.S_IMODE(info.st_mode):04o}'


def main():
    result = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--all', 'bc250-ai-studio.service',
         '-p', 'LoadState', '-p', 'User', '-p', 'Group', '-p', 'WorkingDirectory', '-p', 'ExecStart'],
        check=True, capture_output=True, text=True, timeout=10,
    )
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if fields.get('LoadState') != 'loaded':
        raise RuntimeError('Studio unit을 확인하지 못했습니다.')
    print('--- Studio 서비스 메타데이터 ---')
    print('서비스 사용자:', fields.get('User') or '(지정 없음)')
    print('서비스 그룹:', fields.get('Group') or '(지정 없음)')
    print('작업 디렉터리 예상 경로 일치:',
          '예' if fields.get('WorkingDirectory') == '/opt/bc250-ai-studio' else '아니요')
    print('기존 가상환경 uvicorn 사용:',
          '예' if '/opt/bc250-ai-studio/.venv/bin/uvicorn' in fields.get('ExecStart', '') else '아니요')
    app = Path('/opt/bc250-ai-studio')
    print('\n--- 기존 설치 파일 메타데이터 ---')
    for label, path in (
        ('설치 디렉터리', app), ('백엔드', app / 'backend'), ('가상환경', app / '.venv'),
        ('프런트엔드 빌드', app / 'frontend/dist'), ('모델 설정', app / 'config/models.yaml'),
        ('프로젝트 설정', app / 'pyproject.toml'), ('의존성 잠금', app / 'uv.lock'),
        ('Studio 데이터', Path('/opt/ai-studio-data')),
    ):
        print(label + ':', metadata(path))
    print('\n--- 추가 Python 빌드 설정 존재 여부 ---')
    for name in ('setup.py', 'setup.cfg', 'MANIFEST.in', 'sitecustomize.py', 'usercustomize.py', 'uv.toml'):
        path = app / name
        try:
            os.lstat(path)
        except FileNotFoundError:
            present = '없음'
        except OSError:
            present = '조회 실패'
        else:
            present = '있음'
        print(name + ':', present)
    print('\n파일 내용, 프로세스 환경과 키는 읽거나 출력하지 않았습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, subprocess.SubprocessError, RuntimeError):
        raise SystemExit('Studio 설치 메타데이터를 확인하지 못했습니다.') from None
