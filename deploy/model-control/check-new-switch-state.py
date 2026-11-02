#!/usr/bin/env python3
"""Inspect a stopped, privately preserved new gate/switch state; no CLI.

This checks only persisted model-switch records.  It is not sufficient on its
own to authorize rollback: service jobs, Studio recovery, active-model health,
local callers and ingress must also be checked by the coordinator.
"""

import json
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

TERMINAL = frozenset({'succeeded', 'failed', 'failed_rolled_back'})


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('보존된 상태 파일을 확인하지 못했습니다.')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('보존된 상태에 중복 키가 있습니다.')
            result[key] = value
        return result

    with path.open('r', encoding='utf-8') as file:
        return json.load(file, object_pairs_hook=unique)


def check(state_dir, gate_dir):
    """Reject non-empty journal, unresolved DB states and non-legacy holds.

    Inputs must already be stable, trusted, privately preserved copies. SQLite
    files are copied again into a private temporary directory so opening a WAL
    database cannot create or change sidecars in the preserved evidence.
    """
    state_dir, gate_dir = Path(state_dir), Path(gate_dir)
    if read_json(state_dir / 'switch.json') != {}:
        raise ValueError('전환 journal이 비어 있지 않습니다.')
    holds = read_json(gate_dir / 'holds.json')
    if (not isinstance(holds, dict) or set(holds) != {'holds'}
            or not isinstance(holds['holds'], list)
            or any(not isinstance(hold, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', hold)
                   for hold in holds['holds'])
            or len(set(holds['holds'])) != len(holds['holds'])
            or any(hold not in {'startup', 'legacy'} for hold in holds['holds'])):
        raise ValueError('구 gate로 안전하게 이전할 수 없는 보류가 있습니다.')
    database = state_dir / 'operations.sqlite3'
    if database.is_symlink() or not database.is_file():
        raise ValueError('전환 작업 DB를 확인하지 못했습니다.')
    with tempfile.TemporaryDirectory(prefix='bc250-switch-inspect-') as temp:
        copied = Path(temp) / database.name
        for suffix in ('', '-wal', '-shm'):
            source = state_dir / (database.name + suffix)
            if source.is_symlink():
                raise ValueError('전환 작업 DB에 링크가 있습니다.')
            if source.exists():
                if not source.is_file():
                    raise ValueError('전환 작업 DB 파일 형식이 다릅니다.')
                shutil.copyfile(source, Path(temp) / source.name)
        with sqlite3.connect(copied.as_uri() + '?mode=ro', uri=True, timeout=5) as db:
            result = db.execute('PRAGMA quick_check(1)').fetchall()
            if result != [('ok',)]:
                raise ValueError('전환 작업 DB 무결성을 확인하지 못했습니다.')
            states = db.execute('SELECT DISTINCT state FROM switch_operations').fetchall()
            if any(len(row) != 1 or row[0] not in TERMINAL for row in states):
                raise ValueError('미완료 또는 알 수 없는 전환 작업이 있습니다.')
    return True
