#!/usr/bin/env python3
"""Experimental ordering for stopping two services; not a DB write fence.

Callbacks must independently implement trusted, persistent operations and
capture all required process identities. Failure leaves changes in place;
this in-memory object cannot be resumed after interruption.
"""


class ServiceStopFenceError(RuntimeError):
    pass


def classify_record(events):
    """Classify recorded ordering only; never establish current protection."""
    if not isinstance(events, list) or any(not isinstance(event, str) for event in events):
        raise ValueError('서비스 차단 기록 형식이 올바르지 않습니다.')
    prefixes = ('service_restart_disable:', 'service_start_block:', 'service_stop_fence:')
    selected = tuple(event for event in events if event.startswith(prefixes))
    stages = (
        ('service_restart_disable:begin', 'service_restart_disable:confirmed'),
        ('service_start_block:begin', 'service_start_block:confirmed'),
        ('service_stop_fence:begin', 'service_stop_fence:confirmed'),
    )
    completed = ()
    states = {(): '시작 기록 없음'}
    for begin, confirmed in stages:
        states[completed + (begin,)] = '작업 결과 미확인'
        completed += (begin, confirmed)
        states[completed] = '단계 완료 기록 있음'
    states[completed + ('service_stop_fence:lost',)] = '차단 상실 기록 있음'
    if selected not in states:
        raise ValueError('서비스 차단 기록의 순서 또는 이벤트가 올바르지 않습니다.')
    return states[selected]


class ServiceStopFence:
    def __init__(self, *, record, generation_current, disable_restart, install_start_block,
                 check_policy, stop_services, check_stopped):
        callbacks = (record, generation_current, disable_restart, install_start_block,
                     check_policy, stop_services, check_stopped)
        if not all(callable(callback) for callback in callbacks):
            raise ValueError('서비스 차단 검사와 작업이 모두 필요합니다.')
        (self.record, self.generation_current, self.disable_restart, self.install_start_block,
         self.check_policy, self.stop_services, self.check_stopped) = callbacks
        self.phase = 'new'

    def prepare(self):
        if self.phase != 'new':
            raise ServiceStopFenceError('서비스 차단을 자동으로 재시도할 수 없습니다.')
        self.phase = 'failed'
        try:
            if self.generation_current() is not True:
                raise ValueError('기존 서비스 세대를 확인하지 못했습니다.')
            self.record('service_restart_disable:begin')
            if self.disable_restart() is not True or self.generation_current() is not True:
                raise ValueError('재시작 차단 또는 서비스 세대 확인 실패')
            self.record('service_restart_disable:confirmed')
            self.record('service_start_block:begin')
            if self.install_start_block() is not True or self.generation_current() is not True:
                raise ValueError('시작 차단 또는 서비스 세대 확인 실패')
            if self.check_policy() is not True or self.generation_current() is not True:
                raise ValueError('정지 전 차단 정책 또는 서비스 세대 확인 실패')
            self.record('service_start_block:confirmed')
            self.record('service_stop_fence:begin')
            if self.stop_services() is not True:
                raise ValueError('서비스 정지 요청 실패')
            if self.check_policy() is not True or self.check_stopped() is not True:
                raise ValueError('정지된 서비스 또는 차단 정책 확인 실패')
            self.record('service_stop_fence:confirmed')
        except Exception as error:
            raise ServiceStopFenceError('서비스 차단이 중단됐습니다. 현재 상태를 보존하세요.') from error
        self.phase = 'protected'
        return True

    def check(self):
        if self.phase != 'protected':
            return False
        try:
            if self.check_policy() is True and self.check_stopped() is True:
                return True
        except Exception:
            self.phase = 'failed'
            self.record('service_stop_fence:lost')
            raise
        self.phase = 'failed'
        self.record('service_stop_fence:lost')
        return False
