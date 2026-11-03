#!/usr/bin/env python3
"""Read-only direct-caller observation, not a maintenance or idle guarantee.

Requires the known Wiki service to be stopped and llama slots to be idle.
Other local callers must be blocked by a separate, persistent mechanism; a
successful observation alone must never authorize maintenance or deployment.
"""
import json
import os
import subprocess
import urllib.request
from pathlib import Path

WIKI = 'bc250-family-wiki.service'
LLAMA = 'llama-server.service'
SLOTS_URL = 'http://127.0.0.1:8080/slots'
MAX_RESPONSE = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require_idle_slots(data):
    if (not isinstance(data, list) or not data
            or any(not isinstance(slot, dict) or type(slot.get('is_processing')) is not bool for slot in data)):
        raise ValueError('llama 슬롯 상태를 확인할 수 없습니다.')
    if any(slot['is_processing'] for slot in data):
        raise ValueError('진행 중인 llama 슬롯이 있습니다.')


def llama_pid():
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', LLAMA,
        '-p', 'LoadState', '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'],
        check=True, capture_output=True, text=True, timeout=10)
    fields = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in fields:
            raise ValueError('llama 서비스 상태가 올바르지 않습니다.')
        fields[key] = value
    pid = fields.get('MainPID', '')
    if (fields.get('LoadState') != 'loaded' or fields.get('ActiveState') != 'active'
            or fields.get('Job') != '' or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('llama 서비스가 안정적으로 실행 중이지 않습니다.')
    return pid


def wiki_stopped(guard):
    # The checked-in backup helper validates the whole systemd cgroup, not just MainPID.
    subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                    'wiki-observation', str(guard), WIKI], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)


def observe(guard, *, llama_key=''):
    """Observe known Wiki and current slots without logging key or response data.

    The trusted caller must authenticate ``guard`` and the release, and must
    separately establish and maintain exclusion of all direct local callers.
    No result from this method supplies that exclusion.
    """
    guard = Path(guard)
    if os.geteuid() != 0 or not guard.is_absolute() or not isinstance(llama_key, str):
        raise ValueError('root와 검증된 검사 도구가 필요합니다.')
    if any(char.isspace() or ord(char) < 32 for char in llama_key):
        raise ValueError('llama 인증 정보 형식이 올바르지 않습니다.')
    wiki_stopped(guard)
    pid = llama_pid()
    headers = {'Authorization': 'Bearer ' + llama_key} if llama_key else {}
    request = urllib.request.Request(SLOTS_URL, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=5) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError('llama 슬롯 응답이 너무 큽니다.')
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('llama 슬롯 응답이 올바르지 않습니다.') from None
    require_idle_slots(data)
    if llama_pid() != pid:
        raise ValueError('확인 중 llama 서비스가 재시작됐습니다.')
    wiki_stopped(guard)
    return True
