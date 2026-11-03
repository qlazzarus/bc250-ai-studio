#!/usr/bin/env python3
"""Fail-stop rollback candidate with a manual Client restart boundary.

All callbacks require trusted real adapters. There is no operational CLI or
automatic recovery after process loss; journal and preserved state remain for
inspection. No callback may print credentials or perform model switching.
"""


class RollbackError(RuntimeError):
    pass


class ManualRollback:
    def __init__(self, *, record, wiki_fence, check_maintenance, inspect_new, stop_new,
                 require_stopped, preserve_new, recovery_safe, verify_backup, stage_backup,
                 restore_legacy, start_legacy_gate, restore_pause, start_legacy_studio,
                 client_stopped, verify_legacy, restore_ingress):
        callbacks = (record, check_maintenance, inspect_new, stop_new, require_stopped,
                     preserve_new, recovery_safe, verify_backup, stage_backup, restore_legacy,
                     start_legacy_gate, restore_pause, start_legacy_studio, client_stopped,
                     verify_legacy, restore_ingress)
        if (not all(callable(value) for value in callbacks)
                or not callable(getattr(record, 'rollback_path', None))
                or not all(callable(getattr(wiki_fence, method, None)) for method in ('check', 'release'))):
            raise ValueError('검증된 롤백 어댑터와 기록기가 필요합니다.')
        self.record, self.wiki = record, wiki_fence
        for name, callback in zip(('maintenance', 'inspect_new', 'stop_new', 'stopped', 'preserve',
                'safe', 'verify_backup', 'stage', 'restore', 'start_gate', 'restore_pause',
                'start_studio', 'client_stopped', 'verify_legacy', 'restore_ingress'), callbacks[1:]):
            setattr(self, name, callback)
        self.phase = 'new'

    def guarded(self):
        if self.maintenance() is not True or self.wiki.check() is not True:
            raise RollbackError('유지보수 또는 Wiki 차단이 확인되지 않았습니다.')

    def step(self, name, action):
        self.record(name + ':begin')
        result = action()
        self.record(name + ':confirmed')
        return result

    def begin(self):
        if self.phase != 'new':
            raise RollbackError('롤백을 다시 시작할 수 없습니다.')
        self.phase = 'failed'
        try:
            self.guarded()
            if self.inspect_new() is not True:
                raise RollbackError('신규 상태를 확인하지 못했습니다.')
            self.step('rollback_stop', self.stop_new)
            self.stopped()
            self.guarded()
            def preserve():
                evidence = self.preserve()
                if evidence is None:
                    raise RollbackError('신규 상태 보존이 확인되지 않았습니다.')
                self.record.rollback_path('evidence', evidence)
                return evidence
            evidence = self.step('rollback_preserve', preserve)
            if self.safe(evidence) is not True:
                raise RollbackError('보존된 작업과 모델 상태가 안전하지 않습니다.')
            self.verify_backup()
            self.guarded()
            def stage():
                path = self.stage()
                if path is None:
                    raise RollbackError('격리 복원 경로가 없습니다.')
                self.record.rollback_path('stage', path)
                return path
            stage_path = self.step('rollback_stage', stage)
            self.guarded()
            self.step('rollback_restore', lambda: self.restore(stage_path))
            self.guarded()
            def gate():
                self.start_gate()
                self.restore_pause()
            self.step('rollback_gate', gate)
            self.step('rollback_studio', self.start_studio)
            if self.client_stopped() is not True:
                raise RollbackError('Client가 수동 재시작 대기 상태가 아닙니다.')
            self.guarded()
            self.record('await_legacy_client_restart')
            self.phase = 'await_client'
        except Exception as error:
            raise RollbackError('롤백이 중단됐습니다. 유지보수와 기록을 보존하세요.') from error

    def finish_after_client_restart(self):
        if self.phase != 'await_client':
            raise RollbackError('Client 수동 재시작 대기 상태가 아닙니다.')
        self.phase = 'failed'
        try:
            self.guarded()
            def confirm():
                if self.verify_legacy() is not True:
                    raise RollbackError('수동 재시작한 기존 서비스 확인에 실패했습니다.')
            self.step('rollback_confirmation', confirm)
            self.guarded()
            def release_wiki():
                if self.wiki.release(can_release=lambda: self.maintenance() is True and self.verify_legacy() is True) is not True:
                    raise RollbackError('Wiki 기존 상태 복원에 실패했습니다.')
            self.step('rollback_wiki_release', release_wiki)
            def restore_ingress():
                if self.restore_ingress() is not True:
                    raise RollbackError('유지보수 해제 확인에 실패했습니다.')
            self.step('rollback_ingress_restore', restore_ingress)
            self.record('rollback_complete')
            self.phase = 'complete'
        except Exception as error:
            raise RollbackError('롤백 확인이 중단됐습니다. 현재 상태와 기록을 보존하세요.') from error
