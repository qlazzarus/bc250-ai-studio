#!/usr/bin/env python3
"""Fail-stop lock handoff candidate; no operational entry point.

Callers must independently establish real local-call exclusion and GPU safety.
The old service generation must remain gone, and prepare_new_lock must create or
verify only the independently approved *new* path. The lock is cooperative and
never proves hardware idleness. A failed phase is not automatically retried.
"""


class HandoffError(RuntimeError):
    pass


class GPULockHandoff:
    def __init__(self, *, fence, old_generation_gone, other_callers_blocked,
                 gpu_safe, prepare_new_lock):
        if (not all(callable(value) for value in (old_generation_gone, other_callers_blocked,
                                                   gpu_safe, prepare_new_lock))
                or not all(callable(getattr(fence, name, None)) for name in ('acquire', 'check', 'release'))):
            raise ValueError('검증된 기존 세대·차단·GPU·신규 잠금 검사가 필요합니다.')
        self.fence, self.old, self.callers = fence, old_generation_gone, other_callers_blocked
        self.gpu, self.prepare = gpu_safe, prepare_new_lock
        self.phase = 'new'

    def conditions(self):
        if self.old() is not True or self.callers() is not True or self.gpu() is not True:
            raise HandoffError('기존 작업 종료 또는 직접 호출·GPU 조건을 확인하지 못했습니다.')

    def acquire(self):
        if self.phase != 'new':
            raise HandoffError('잠금 이전을 재시도할 수 없습니다.')
        self.phase = 'failed'
        try:
            self.conditions()
            if self.prepare() is not True:
                raise HandoffError('신규 잠금 준비를 확인하지 못했습니다.')
            self.conditions()
            if self.fence.acquire() is not True:
                raise HandoffError('신규 잠금 획득을 확인하지 못했습니다.')
            self.conditions()
            if self.fence.check() is not True:
                raise HandoffError('신규 잠금을 확인하지 못했습니다.')
            self.phase = 'held'
            return True
        except Exception as error:
            raise HandoffError('잠금 이전이 중단됐습니다. 현재 상태를 보존하세요.') from error

    def check(self):
        if self.phase != 'held':
            raise HandoffError('신규 잠금 보유 단계가 아닙니다.')
        try:
            self.conditions()
            if self.fence.check() is not True:
                raise HandoffError('신규 잠금 확인 실패')
            self.conditions()
            return True
        except Exception as error:
            self.phase = 'failed'
            raise HandoffError('잠금 또는 유지 조건을 확인하지 못했습니다. 보존하고 중단하세요.') from error

    def release(self, *, can_release):
        if self.phase != 'held' or not callable(can_release):
            raise HandoffError('검증된 해제 조건이 필요합니다.')
        try:
            self.check()
            if can_release() is not True:
                raise HandoffError('잠금 해제 조건을 확인하지 못했습니다.')
            self.check()
            self.fence.release()
            self.phase = 'released'
            return True
        except Exception as error:
            self.phase = 'failed'
            raise HandoffError('잠금 해제가 중단됐습니다. 현재 상태를 보존하세요.') from error
