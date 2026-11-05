#!/usr/bin/env python3
"""Bind verified attestation to a candidate digest; not a production trust root."""
import importlib.util
import re
from pathlib import Path

path = Path(__file__).with_name('verify-candidate-run.py')
spec = importlib.util.spec_from_file_location('candidate_run_verifier', path)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class AttestationCheck:
    def __init__(self, gh, artifact, commit, digest, run_id, attempt, *, bundle=None, trusted_root=None):
        if not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ValueError('커밋 또는 후보 해시 형식 오류')
        self.gh, self.artifact = gh, artifact
        self.commit, self.digest = commit, digest
        self.run_id, self.attempt = run_id, attempt
        if (bundle is None) != (trusted_root is None):
            raise ValueError('오프라인 증명과 신뢰 루트는 함께 필요합니다.')
        self.bundle, self.trusted_root = bundle, trusted_root

    def __call__(self, commit, digest):
        if (commit, digest) != (self.commit, self.digest):
            raise ValueError('출처 검사 대상 커밋 또는 해시가 다릅니다.')
        actual = verifier.verify(self.gh, self.artifact, self.commit, self.run_id, self.attempt,
                                 bundle=self.bundle, trusted_root=self.trusted_root)
        if actual != self.digest:
            raise ValueError('검증된 후보 해시가 다릅니다.')
        return True
