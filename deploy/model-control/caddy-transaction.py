#!/usr/bin/env python3
"""Checked Caddy transition primitive; not an operational command.

The caller supplies trusted paths, an atomic swap implementation, a reload
operation, and probes against the running server.  No automatic retry or
rollback is safe when the outcome of a reload is unknown.
"""


class TransitionError(RuntimeError):
    """A transition was not confirmed; the caller must preserve all state."""


def transition(*, mode, snapshot, live, generator, capture, swap, validate, reload, probe):
    """Perform one transition and return only after the running server is checked.

    A raised exception never means that the server remained in its previous
    state.  In particular, a reload can apply a configuration before its
    response is lost.  The caller must stop and investigate on every failure.
    """
    if mode not in ('enter', 'restore'):
        raise ValueError('지원하지 않는 Caddy 전환 단계입니다.')
    target_maintenance = mode == 'enter'
    try:
        # Validate the candidate before touching the live file.  The swap
        # independently verifies the snapshot, original and metadata again.
        validate(snapshot / ('Caddyfile.maintenance' if target_maintenance else 'Caddyfile.original'))
        swap(snapshot, live, generator, mode, capture)
        reload(live)
        if probe() is not target_maintenance:
            raise TransitionError('실행 중인 Caddy 응답이 목표 상태와 다릅니다.')
    except Exception as exc:
        raise TransitionError(
            'Caddy 전환을 확인하지 못했습니다. 파일·보관본과 서비스 상태를 보존하고 중단하세요.'
        ) from exc
