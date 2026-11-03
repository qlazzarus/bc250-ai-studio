#!/usr/bin/env python3
"""Internal candidate: safely order a cooperative lock handoff, not a CLI.

The callbacks must enforce real maintenance, durable startup hold, Wiki and
other local caller exclusion, old-generation exit and GPU safety. The actual
startup confirmation must acquire and release the same GPU lock itself.
This object provides no recovery or process-death persistence.
"""


class StartupLockError(RuntimeError):
    pass


class StartupLockSequence:
    def __init__(self, *, record, check_pre_handoff, prepare_tmpfiles, handoff,
                 check_before_confirm, confirm_startup):
        callbacks = (record, check_pre_handoff, prepare_tmpfiles, check_before_confirm, confirm_startup)
        if (not all(callable(value) for value in callbacks)
                or not all(callable(getattr(handoff, name, None)) for name in ('acquire', 'check', 'release'))):
            raise ValueError('기록기와 검증된 시작·잠금 어댑터가 필요합니다.')
        self.record, self.pre, self.prepare = record, check_pre_handoff, prepare_tmpfiles
        self.handoff, self.check_confirm, self.confirm = handoff, check_before_confirm, confirm_startup
        self.phase = 'new'

    def begin(self):
        if self.phase != 'new':
            raise StartupLockError('시작 잠금 단계를 다시 실행할 수 없습니다.')
        self.phase = 'failed'
        try:
            if self.pre() is not True:
                raise StartupLockError('잠금 준비 전 조건이 확인되지 않았습니다.')
            self.record('startup_tmpfiles:begin')
            if self.prepare() is not True:
                raise StartupLockError('신규 잠금 파일 준비를 확인하지 못했습니다.')
            self.record('startup_tmpfiles:confirmed')
            if self.pre() is not True:
                raise StartupLockError('잠금 준비 후 조건이 변경됐습니다.')
            self.record('startup_lock:begin')
            if self.handoff.acquire() is not True:
                raise StartupLockError('신규 잠금 보유가 확인되지 않았습니다.')
            self.record('startup_lock:confirmed')
            self.phase = 'held'
            return True
        except Exception as error:
            raise StartupLockError('시작 잠금 준비가 중단됐습니다. 상태와 기록을 보존하세요.') from error

    def confirm_after_client_restart(self):
        if self.phase != 'held':
            raise StartupLockError('시작 잠금 보유 상태가 아닙니다.')
        self.phase = 'failed'
        try:
            if self.check_confirm() is not True or self.handoff.check() is not True:
                raise StartupLockError('인계 전 서비스 또는 차단 상태가 확인되지 않았습니다.')
            self.record('startup_lock_transfer:begin')
            if self.handoff.release(can_release=lambda: self.check_confirm() is True) is not True:
                raise StartupLockError('시작 확인용 잠금 인계에 실패했습니다.')
            self.record('startup_lock_transfer:released')
            if self.check_confirm() is not True:
                raise StartupLockError('잠금 인계 후 차단 상태가 변경됐습니다.')
            if self.confirm() is not True:
                raise StartupLockError('시작 확인이 완료되지 않았습니다.')
            self.record('startup_lock_transfer:confirmed')
            self.phase = 'complete'
            return True
        except Exception as error:
            raise StartupLockError('시작 확인이 중단됐습니다. 상태와 기록을 보존하세요.') from error
