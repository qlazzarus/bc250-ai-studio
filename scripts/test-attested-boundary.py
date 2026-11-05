#!/usr/bin/env python3
"""Exercise the real verifier with a mocked staged-tree check; no installation."""
import importlib.util
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if len(sys.argv) != 7:
    raise SystemExit('사용법: GH경로 후보tar 커밋 SHA256 실행ID 시도번호')
root = Path(__file__).resolve().parents[1]
adapter = load('attestation_adapter', root / 'scripts/candidate-attestation-adapter.py')
pinned = load('pinned_boundary', root / 'deploy/model-control/assemble-pinned-coordinator.py')
gh, artifact, commit, digest, run_id, attempt = sys.argv[1:]
checks = []
provenance = adapter.AttestationCheck(gh, artifact, commit, digest, run_id, attempt)
checker = pinned.ProvenanceBoundCheck(lambda *_: checks.append('tree') or True, provenance)
if checker(commit, digest) is not True or checks != ['tree']:
    raise SystemExit('후보 출처·스테이징 연결 실패')
print('실제 attestation과 모의 스테이징 검사를 같은 후보 해시에 연결 확인')
try:
    checker(commit, '0' * 64 if digest != '0' * 64 else '1' * 64)
except ValueError:
    pass
else:
    raise SystemExit('다른 후보 해시가 허용됐습니다.')
if checks != ['tree']:
    raise SystemExit('출처 거절 뒤 스테이징 검사가 실행됐습니다.')
print('후보 해시 불일치 시 스테이징 검사 전 거절 확인')
print('스테이징 검사는 모의이며 root 신뢰·운영 조율기·서비스 변경은 시험하지 않았습니다.')
