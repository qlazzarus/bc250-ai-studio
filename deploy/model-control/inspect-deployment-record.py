#!/usr/bin/env python3
"""Read-only diagnosis; a journal is never proof of current hold ownership."""

import json
import os
import re
import stat
import sys
from pathlib import Path


def parse_rows(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('기록에 중복 키가 있습니다')
            result[key] = value
        return result

    return [json.loads(line, object_pairs_hook=unique) for line in data.splitlines()]


def classify(rows):
    if not isinstance(rows, list) or not all(isinstance(row, dict) and isinstance(row.get('event'), str)
                                             for row in rows):
        raise ValueError('기록 형식 오류')
    generations = [row for row in rows if row.get('event') == 'deployment_hold:generation']
    if (len(generations) > 1 or any(not isinstance(row.get('generation'), str)
            or not re.fullmatch(r'[a-f0-9]{32}', row['generation']) for row in generations)):
        raise ValueError('배포 보류 세대 기록 오류')
    relevant = [row['event'] for row in rows if row['event'].startswith('deployment_hold:')
                or row['event'].startswith('deployment_confirmation:')]
    if 'deployment_hold:generation' in relevant:
        if len(relevant) < 2 or relevant[0:2] != ['deployment_hold:begin', 'deployment_hold:generation']:
            raise ValueError('배포 보류 세대 기록 순서 오류')
        relevant.remove('deployment_hold:generation')
    phases = {
        (): '배포 보류 시작 기록 없음',
        ('deployment_hold:begin',): '배포 보류 설정 결과 불명확',
        ('deployment_hold:begin', 'deployment_hold:confirmed'): '배포 보류 설정 확인; 시작 확인 전',
        ('deployment_hold:begin', 'deployment_hold:confirmed',
         'deployment_confirmation:begin'): '배포 보류 설정 확인; 시작 확인 미완료',
        ('deployment_hold:begin', 'deployment_hold:confirmed', 'deployment_confirmation:begin',
         'deployment_confirmation:confirmed'): '배포 보류 설정 및 시작 확인 기록 있음',
    }
    if tuple(relevant) not in phases:
        raise ValueError('배포 보류 기록 순서 오류')
    return phases[tuple(relevant)]


def read_record_snapshot(directory):
    directory = Path(directory)
    if os.geteuid() != 0 or not directory.is_absolute() or '..' in directory.parts:
        raise ValueError('root와 정규화된 절대 경로가 필요합니다')
    for path in (directory, *directory.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('기록 상위 경로를 신뢰할 수 없습니다')
    if stat.S_IMODE(directory.lstat().st_mode) != 0o700:
        raise ValueError('기록 디렉터리는 root 전용이어야 합니다')
    path = directory / 'migration-events.jsonl'
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        current = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 65536
                or (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino)):
            raise ValueError('기록 파일을 신뢰할 수 없습니다')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(65537)
        if len(data) != info.st_size or (data and not data.endswith(b'\n')):
            raise ValueError('기록이 변경됐거나 불완전합니다')
        after = os.fstat(fd)
        current_after = path.lstat()
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
                info.st_size, info.st_mtime_ns, info.st_ctime_ns) or (
                current_after.st_dev, current_after.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError('기록을 읽는 중 변경됐습니다')
        rows = parse_rows(data)
        status = classify(rows)
        generations = [row['generation'] for row in rows if row.get('event') == 'deployment_hold:generation']
        releases = [row for row in rows if row.get('event') == 'release']
        if len(releases) > 1 or (releases and rows[0] is not releases[0]):
            raise ValueError('릴리스 기록 순서 오류')
        release = releases[0] if releases else None
        if release is not None and (not isinstance(release.get('commit'), str)
                or not re.fullmatch(r'[a-f0-9]{40}', release['commit'])
                or not isinstance(release.get('sha256'), str)
                or not re.fullmatch(r'[a-f0-9]{64}', release['sha256'])):
            raise ValueError('릴리스 기록 형식 오류')
        return status, generations[0] if generations else None, release
    finally:
        os.close(fd)


def read_record(directory):
    return read_record_details(directory)[0]


def read_record_details(directory):
    status, generation, _ = read_record_snapshot(directory)
    return status, generation


def matches_release_record(directory, expected_commit, expected_sha256, verify_release):
    """Compare a recorded release with independently verified caller inputs; no recovery approval."""
    if (not isinstance(expected_commit, str) or not re.fullmatch(r'[a-f0-9]{40}', expected_commit)
            or not isinstance(expected_sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_sha256)
            or not callable(verify_release)):
        raise ValueError('검증된 릴리스 식별 조건이 필요합니다')
    _, _, release = read_record_snapshot(directory)
    if release is None or release['commit'] != expected_commit or release['sha256'] != expected_sha256:
        return False
    return verify_release(expected_commit, expected_sha256) is True


def matches_recorded_generation(directory, authenticated_gate_state):
    """Compare only; caller must authenticate gate and enforce other recovery checks."""
    status, generation = read_record_details(directory)
    return _generation_matches(status, generation, authenticated_gate_state)


def _generation_matches(status, generation, state):
    return (status in {'배포 보류 설정 확인; 시작 확인 전', '배포 보류 설정 확인; 시작 확인 미완료',
                       '배포 보류 설정 및 시작 확인 기록 있음'}
            and generation is not None and isinstance(state, dict)
            and state.get('protocol') == 2 and state.get('durable') is True
            and state.get('paused') is True and isinstance(state.get('holds'), list)
            and 'admin-deployment' in state['holds'] and state.get('deployment_generation') == generation)


def matches_release_and_generation(directory, expected_commit, expected_sha256, verify_release, gate_state):
    """Compare one record snapshot; caller must authenticate the gate and enforce recovery barriers."""
    if (not isinstance(expected_commit, str) or not re.fullmatch(r'[a-f0-9]{40}', expected_commit)
            or not isinstance(expected_sha256, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_sha256)
            or not callable(verify_release)):
        raise ValueError('검증된 릴리스 식별 조건이 필요합니다')
    status, generation, release = read_record_snapshot(directory)
    if (release is None or release['commit'] != expected_commit or release['sha256'] != expected_sha256
            or not _generation_matches(status, generation, gate_state)):
        return False
    return verify_release(expected_commit, expected_sha256) is True


def main():
    if len(sys.argv) != 2:
        raise SystemExit('기록 디렉터리 하나가 필요합니다')
    try:
        result = read_record(sys.argv[1])
    except (OSError, ValueError, UnicodeError):
        raise SystemExit('기록 검증 실패; 상태를 보존하고 조사하세요') from None
    print(result)
    print('이 기록은 현재 gate 보류의 소유권·동일성이나 해제 가능성을 증명하지 않습니다.')
    print('기록 내용과 환경값은 출력하지 않았으며 서비스를 변경하지 않았습니다.')


if __name__ == '__main__':
    main()
