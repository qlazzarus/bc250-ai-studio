#!/usr/bin/env python3
"""Fail-stop coordination candidate; not a production command or recovery tool.

The caller must supply real verified adapters and a durable root-owned recorder.
Instances cannot be resumed after process loss: recorded in-progress operations
are evidence for inspection, not permission to retry an uncertain action.
"""


class MigrationError(RuntimeError):
    """A phase was not confirmed; maintain isolation and inspect the record."""


class CoordinatedMigration:
    def __init__(self, *, record, preflight, transition, transition_args, backup_adapter,
                 install, startup, verify_new, verify_restored, wiki_fence=None):
        if (not all(callable(x) for x in (record, preflight, transition, install,
                                           verify_new, verify_restored))
                or not callable(getattr(record, 'backup', None)) or not isinstance(transition_args, dict)
                or not callable(getattr(backup_adapter, 'run', None))
                or not callable(getattr(startup, 'start', None))
                or not callable(getattr(startup, 'finish', None))
                or (wiki_fence is not None and not all(callable(getattr(wiki_fence, method, None))
                    for method in ('acquire', 'check', 'release')))):
            raise ValueError('검증된 배포 어댑터와 기록기가 모두 필요합니다.')
        self.record = record
        self.preflight = preflight
        self.transition = transition
        self.transition_args = dict(transition_args)
        self.backup = backup_adapter
        self.install = install
        self.startup = startup
        self.verify_new = verify_new
        self.verify_restored = verify_restored
        self.wiki_fence = wiki_fence
        self.phase = 'new'

    def step(self, name, action):
        # Record before the mutation, so process death never looks like success.
        self.phase = 'failed'
        self.record(name + ':begin')
        result = action()
        self.record(name + ':confirmed')
        return result

    def check_wiki(self):
        if self.wiki_fence is not None and self.wiki_fence.check() is not True:
            raise MigrationError('Wiki 직접 호출 차단을 확인하지 못했습니다.')

    def start_wiki_fence(self):
        if self.wiki_fence.acquire() is not True:
            raise MigrationError('Wiki 직접 호출 차단을 설정하지 못했습니다.')
        self.check_wiki()

    def release_wiki_fence(self):
        self.check_wiki()
        if self.wiki_fence.release(can_release=lambda: self.verify_new() is True) is not True:
            raise MigrationError('Wiki 상태 복원을 확인하지 못했습니다.')

    def prepare_and_start(self):
        if self.phase != 'new':
            raise MigrationError('배포 단계를 다시 시작할 수 없습니다.')
        try:
            if self.preflight() is not True:
                raise MigrationError('배포 전 검증에 실패했습니다.')
            self.step('maintenance_enter', lambda: self.transition(mode='enter', **self.transition_args))
            if self.wiki_fence is not None:
                self.step('wiki_fence', self.start_wiki_fence)
            def take_backup():
                self.check_wiki()
                backup = self.backup.run()
                if backup is None:
                    raise MigrationError('검증된 백업 경로가 없습니다.')
                self.record.backup(backup)
                self.check_wiki()
                return backup
            backup = self.step('legacy_backup', take_backup)
            def install():
                self.check_wiki()
                if self.install(backup) is not True:
                    raise MigrationError('설치를 확인하지 못했습니다.')
                self.check_wiki()
            self.step('install', install)
            self.check_wiki()
            self.step('new_start', self.startup.start)
            self.check_wiki()
            self.record('await_manual_client_restart')
            self.phase = 'await_client'
        except Exception as error:
            self.phase = 'failed'
            raise MigrationError('배포가 중단됐습니다. 현재 상태와 기록을 보존하세요.') from error

    def finish_after_client_restart(self):
        if self.phase != 'await_client':
            raise MigrationError('Client 수동 재시작을 기다리는 단계가 아닙니다.')
        try:
            self.check_wiki()
            self.step('new_confirmation', self.startup.finish)
            self.check_wiki()
            if self.verify_new() is not True:
                raise MigrationError('새 서비스 확인에 실패했습니다.')
            if self.wiki_fence is not None:
                self.step('wiki_release', self.release_wiki_fence)
            self.step('maintenance_restore', lambda: self.transition(mode='restore', **self.transition_args))
            if self.verify_restored() is not True:
                raise MigrationError('유지보수 해제 후 응답을 확인하지 못했습니다.')
            self.record('complete')
            self.phase = 'complete'
        except Exception as error:
            self.phase = 'failed'
            raise MigrationError('배포 확인이 중단됐습니다. 현재 상태와 기록을 보존하세요.') from error
