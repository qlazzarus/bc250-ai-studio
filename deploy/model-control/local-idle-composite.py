#!/usr/bin/env python3
"""Fail-closed composition candidate; no operating entry point.

All callbacks must be independently authenticated and provide persistent
exclusion where needed. This module does not establish or prove any fence.
"""


class LocalIdleComposite:
    def __init__(self, *, check_wiki_fence, check_other_callers_fenced, observe_llama,
                 check_gpu_idle):
        callbacks = (check_wiki_fence, check_other_callers_fenced, observe_llama, check_gpu_idle)
        if not all(callable(item) for item in callbacks):
            raise ValueError('Wiki·직접 호출자·llama·GPU 검사기가 필요합니다.')
        self.wiki, self.callers, self.llama, self.gpu = callbacks

    def __call__(self):
        # Recheck fences after observations so a concurrent loss fails closed.
        for check in (self.wiki, self.callers, self.llama, self.gpu, self.wiki, self.callers):
            if check() is not True:
                raise ValueError('로컬 차단 또는 유휴 상태가 확인되지 않았습니다.')
        return True
