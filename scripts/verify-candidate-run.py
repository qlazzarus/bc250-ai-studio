#!/usr/bin/env python3
"""Verify an Actions attestation and its certificate run URI; not a deploy gate."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

REPOSITORY = 'qlazzarus/bc250-ai-studio'
WORKFLOW = REPOSITORY + '/.github/workflows/model-control-candidate.yml'


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('중복 JSON 키가 있습니다.')
        result[key] = value
    return result


def require_run_uri(raw, run_id, attempt):
    records = json.loads(raw, object_pairs_hook=unique_object)
    if not isinstance(records, list) or not records:
        raise ValueError('검증된 attestation 결과가 없습니다.')
    expected = f'https://github.com/{REPOSITORY}/actions/runs/{run_id}/attempts/{attempt}'
    found = False
    for item in records:
        try:
            uri = item['verificationResult']['signature']['certificate']['runInvocationURI']
        except (KeyError, TypeError):
            raise ValueError('검증된 인증서의 실행 URI가 없습니다.') from None
        if not isinstance(uri, str):
            raise ValueError('인증서 실행 URI 형식이 올바르지 않습니다.')
        found |= uri == expected
    if not found:
        raise ValueError('예상 실행 ID·시도 번호와 인증서 실행 URI가 다릅니다.')


def file_identity(path):
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_nlink != 1:
        raise ValueError('후보는 단일 링크의 일반 파일이어야 합니다.')
    with path.open('rb') as file:
        before = os.fstat(file.fileno())
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
        after = os.fstat(file.fileno())
    attrs = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    if any(getattr(info, k) != getattr(before, k) or getattr(before, k) != getattr(after, k) for k in attrs):
        raise ValueError('후보 파일이 검사 중 변경됐습니다.')
    return tuple(getattr(after, k) for k in attrs), digest


def verify(gh, artifact, commit, run_id, attempt, *, bundle=None, trusted_root=None, env=None):
    gh, artifact = Path(gh), Path(artifact)
    if (not gh.is_absolute() or not gh.is_file() or not os.access(gh, os.X_OK)
            or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or not re.fullmatch(r'[1-9][0-9]*', run_id)
            or not re.fullmatch(r'[1-9][0-9]*', attempt)):
        raise ValueError('검증 인자가 올바르지 않습니다.')
    if (bundle is None) != (trusted_root is None):
        raise ValueError('오프라인 증명과 신뢰 루트는 함께 필요합니다.')
    evidence = []
    if bundle is not None:
        bundle, trusted_root = Path(bundle), Path(trusted_root)
        evidence = [(bundle, file_identity(bundle)), (trusted_root, file_identity(trusted_root))]
    before = file_identity(artifact)
    command = [str(gh), 'attestation', 'verify', str(artifact), '--repo', REPOSITORY,
               '--signer-workflow', WORKFLOW, '--source-digest', commit,
               '--source-ref', 'refs/heads/main', '--deny-self-hosted-runners', '--format', 'json']
    if evidence:
        command += ['--bundle', str(bundle), '--custom-trusted-root', str(trusted_root)]
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=120, env=env)
    require_run_uri(result.stdout, run_id, attempt)
    if before != file_identity(artifact) or any(file_identity(path) != identity for path, identity in evidence):
        raise ValueError('서명 검증 중 후보 또는 검증 자료가 변경됐습니다.')
    return before[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gh')
    parser.add_argument('artifact')
    parser.add_argument('commit')
    parser.add_argument('run_id')
    parser.add_argument('attempt')
    parser.add_argument('--bundle')
    parser.add_argument('--trusted-root')
    args = parser.parse_args()
    try:
        digest = verify(args.gh, args.artifact, args.commit, args.run_id, args.attempt,
                        bundle=args.bundle, trusted_root=args.trusted_root)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f'후보 실행 출처 검사 실패: {type(exc).__name__}')
        raise SystemExit(1) from None
    print(f'후보 서명과 실행 ID·시도 번호 확인 완료: SHA-256 {digest}; 설치하지 않았습니다.')


if __name__ == '__main__':
    main()
