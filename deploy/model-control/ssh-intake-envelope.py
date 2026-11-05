#!/usr/bin/env python3
"""Parse a bounded candidate identity header; this does not authenticate it.

Candidate protocol helper only. The caller must authenticate the transport and
verify the candidate hash independently before using any of these values.
"""
import json
import re

MAX_HEADER = 1024


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('중복된 헤더 항목')
        result[key] = value
    return result


def read_header(stream):
    raw = stream.readline(MAX_HEADER + 1)
    if not raw.endswith(b'\n') or len(raw) > MAX_HEADER:
        raise ValueError('헤더가 없거나 크기 제한을 초과했습니다.')
    try:
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('헤더 형식 오류') from exc
    if not isinstance(data, dict) or set(data) != {'commit', 'sha256', 'run_id', 'attempt'}:
        raise ValueError('헤더 항목 오류')
    patterns = {
        'commit': r'[0-9a-f]{40}',
        'sha256': r'[0-9a-f]{64}',
        'run_id': r'[1-9][0-9]{0,19}',
        'attempt': r'[1-9][0-9]{0,9}',
    }
    if any(type(data[key]) is not str or re.fullmatch(pattern, data[key]) is None
           for key, pattern in patterns.items()):
        raise ValueError('헤더 값 오류')
    return data
