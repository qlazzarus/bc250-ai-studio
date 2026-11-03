#!/usr/bin/env python3
"""Validate a structured systemd condition observation; not a fence itself.

The caller must obtain the property over an authenticated system bus, keep the
unit referenced for the entire read and independently verify marker, loaded
drop-in, stopped cgroup and caller exclusion. This module never changes units.
"""


def require_block_condition(value, marker):
    """Require exactly one non-trigger, negated path-exists condition."""
    if not isinstance(marker, str) or not marker.startswith('/') or '\x00' in marker:
        raise ValueError('조건 marker 경로가 올바르지 않습니다.')
    if (not isinstance(value, dict) or value.get('type') != 'a(sbbsi)'
            or not isinstance(value.get('data'), list)):
        raise ValueError('systemd 조건 속성 형식이 올바르지 않습니다.')
    entries = value['data']
    for entry in entries:
        if (not isinstance(entry, list) or len(entry) != 5 or not isinstance(entry[0], str)
                or type(entry[1]) is not bool or type(entry[2]) is not bool
                or not isinstance(entry[3], str) or type(entry[4]) is not int):
            raise ValueError('systemd 조건 항목이 올바르지 않습니다.')
    matching = [entry for entry in entries if entry[0] == 'ConditionPathExists' and entry[3] == marker]
    if len(matching) != 1 or matching[0][1] is not False or matching[0][2] is not True:
        raise ValueError('필요한 부정 경로 조건이 없거나 중복됐습니다.')
    return True
