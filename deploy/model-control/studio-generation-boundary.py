#!/usr/bin/env python3
"""Track a confirmed stop and verified replacement; internal candidate only.

Caller owns the pidfd watch and supplies real stop and replacement validators.
The replacement validator must prove code, service and process identity as well
as any required cgroup constraints. Nothing here fences other writers or GPU
users; state is lost when this process exits.
"""


class GenerationError(RuntimeError):
    pass


class StudioGenerationBoundary:
    def __init__(self, watch, *, check_stopped, observe_replacement, verify_replacement):
        if (not callable(getattr(watch, 'exited', None))
                or not all(callable(item) for item in
                           (check_stopped, observe_replacement, verify_replacement))):
            raise ValueError('기존 주 프로세스와 정지·신규 세대 검사기가 필요합니다.')
        self.watch = watch
        self.check_stopped = check_stopped
        self.observe_replacement = observe_replacement
        self.verify_replacement = verify_replacement
        self.phase = 'old'
        self.replacement = None

    def mark_stopped(self):
        if self.phase != 'old':
            raise GenerationError('기존 세대 정지 단계를 다시 시작할 수 없습니다.')
        self.phase = 'failed'
        if (self.watch.exited() is not True or self.check_stopped() is not True
                or self.watch.exited() is not True):
            raise GenerationError('기존 주 프로세스 또는 서비스 정지를 확인하지 못했습니다.')
        self.phase = 'stopped'
        return True

    def bind_replacement(self):
        if self.phase != 'stopped':
            raise GenerationError('기존 세대 정지 확인이 필요합니다.')
        self.phase = 'failed'
        identity = self.observe_replacement()
        if (not isinstance(identity, tuple) or len(identity) != 2
                or type(identity[0]) is not int or identity[0] <= 1
                or type(identity[1]) is not str or not identity[1].isdecimal()
                or self.watch.exited() is not True
                or self.verify_replacement(identity) is not True
                or self.observe_replacement() != identity or self.watch.exited() is not True):
            raise GenerationError('신규 세대 또는 기존 주 프로세스 종료 확인 실패')
        self.replacement = identity
        self.phase = 'running'
        return True

    def check(self):
        if self.phase != 'running':
            raise GenerationError('확인된 신규 세대가 없습니다.')
        try:
            if (self.watch.exited() is not True
                    or self.observe_replacement() != self.replacement
                    or self.verify_replacement(self.replacement) is not True
                    or self.observe_replacement() != self.replacement
                    or self.watch.exited() is not True):
                raise GenerationError('세대 확인 상태가 변경됐습니다.')
        except Exception:
            self.phase = 'failed'
            raise
        return True
