#!/usr/bin/env python3
"""Legacy rollback ordering primitive; no production adapters or CLI.

Adapters perform the actual checks, preservation and restoration.  Failure at
any point leaves ingress blocked and requires inspection; no automatic retry.
"""


class RollbackError(RuntimeError):
    """Rollback was not fully confirmed; preserve the current state."""


def rollback_legacy(*, check_maintenance, inspect_new, stop_new, require_stopped, preserve_new,
                    recovery_safe, verify_backup, stage_backup, restore_legacy,
                    start_legacy_gate, restore_pause, start_legacy_services,
                    verify_legacy):
    """Restore a verified compatible unit only after preserving new state.

    recovery_safe must inspect the preserved journal, gate holds, pending work,
    systemd jobs and active-model health and return exactly True.  Callers must
    separately block direct local callers and obtain a consistent preserved
    copy while the new services are stopped.  This function never releases
    maintenance and does not decide whether post-backup data may be discarded.
    """
    try:
        if check_maintenance() is not True:
            raise RollbackError('외부 유지보수 상태를 확인하지 못했습니다.')
        if inspect_new() is not True:
            raise RollbackError('신규 서비스의 작업과 systemd 상태를 확인하지 못했습니다.')
        stop_new()
        require_stopped()
        evidence = preserve_new()
        if evidence is None:
            raise RollbackError('신규 상태 보존을 확인하지 못했습니다.')
        if recovery_safe(evidence) is not True:
            raise RollbackError('미완료 작업 또는 모델 상태를 확인하지 못했습니다.')
        verify_backup()
        stage = stage_backup()
        if stage is None:
            raise RollbackError('격리 복원 결과를 확인하지 못했습니다.')
        restore_legacy(stage)
        if check_maintenance() is not True:
            raise RollbackError('기존 gate 시작 전 유지보수 상태를 확인하지 못했습니다.')
        start_legacy_gate()
        restore_pause()
        start_legacy_services()
        verify_legacy()
        return evidence
    except Exception as exc:
        raise RollbackError('기존 구성 복원을 확인하지 못했습니다. 서비스와 기록을 보존하고 중단하세요.') from exc
