#!/usr/bin/env python3
"""Check a pinned hold against authenticated status and a protected record.

The caller must provide authenticated gate reads, a trusted record matcher and
an independently established ownership check. Matching a generation alone is
not proof of ownership. These observations do not provide continuous fencing.
"""
import re


class DeploymentHoldCheck:
    def __init__(self, *, generation, fetch_status, matches_record, check_ownership):
        if (type(generation) is not str or re.fullmatch(r'[a-f0-9]{32}', generation) is None
                or not all(callable(item) for item in (fetch_status, matches_record, check_ownership))):
            raise ValueError('인증된 보류 세대·기록·소유권 검사기가 필요합니다.')
        self.generation = generation
        self.fetch_status = fetch_status
        self.matches_record = matches_record
        self.check_ownership = check_ownership

    def __call__(self):
        for _ in range(2):
            if self.check_ownership(self.generation) is not True:
                return False
            state = self.fetch_status()
            if (not isinstance(state, dict) or state.get('deployment_generation') != self.generation
                    or self.matches_record(state) is not True):
                return False
        return self.check_ownership(self.generation) is True
