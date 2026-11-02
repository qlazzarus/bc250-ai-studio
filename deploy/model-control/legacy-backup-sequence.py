#!/usr/bin/env python3
"""Coordinated legacy pause, stop and backup primitive; no operational CLI.

Adapters must perform real authenticated and process-level checks.  This
primitive never retries, resumes services, restores data or releases ingress.
"""


class SequenceError(RuntimeError):
    """The sequence did not complete; preserve state and inspect it."""


def _drained(state):
    if (not isinstance(state, dict) or 'protocol' in state or state.get('paused') is not True
            or type(state.get('active_requests')) is not int
            or type(state.get('waiting_requests')) is not int
            or state['active_requests'] != 0 or state['waiting_requests'] != 0):
        raise SequenceError('기존 gate의 pause 또는 요청 drain을 확인하지 못했습니다.')


def backup_legacy(*, check_maintenance, capture_pause, gate_status, stop_services,
                  require_stopped, create_backup, verify_backup):
    """Stop immediately on uncertainty; callers must independently block local access.

    capture_pause must durably record the pre-maintenance pause before setting
    it.  stop_services must wait for all three services, and require_stopped
    must also check their processes, jobs and KillMode.  create_backup returns
    a new backup path; verify_backup must raise on any invalid backup.
    """
    try:
        if check_maintenance() is not True:
            raise SequenceError('외부 유지보수 상태를 확인하지 못했습니다.')
        _drained(capture_pause())
        _drained(gate_status())
        if check_maintenance() is not True:
            raise SequenceError('서비스 정지 직전 유지보수 상태를 확인하지 못했습니다.')
        stop_services()
        require_stopped()
        backup = create_backup()
        if backup is None:
            raise SequenceError('백업 경로가 없습니다.')
        verify_backup(backup)
        return backup
    except Exception as exc:
        raise SequenceError('이전 백업을 완료하지 못했습니다. 서비스와 기록을 보존하고 중단하세요.') from exc
