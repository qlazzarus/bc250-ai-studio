#!/usr/bin/env python3
"""Read-only Studio snapshot; does not fence submissions or establish idleness.

The caller supplies a protected credential in memory. Requests, service status,
and job pagination are observations only: jobs can arrive or start afterwards.
"""
import json
import os
import subprocess
import urllib.request

UNIT = 'bc250-ai-studio.service'
BASE = 'http://127.0.0.1:8090/api/v1'
PAGE_SIZE = 200
MAX_PAGES = 250
MAX_RESPONSE = 4 * 1024 * 1024
TERMINAL = frozenset({'completed', 'failed', 'cancelled', 'interrupted'})


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require_idle_status(data):
    if (not isinstance(data, dict) or data.get('recovery_required') is not False
            or data.get('scheduler_running') is not True or data.get('gpu_owner', object()) is not None
            or data.get('active_job', object()) is not None or data.get('transition') != {}
            or data.get('llm_recovery') != {}):
        raise ValueError('Studio 작업 또는 복구 상태가 유휴가 아닙니다.')


def require_finished_jobs(data):
    if not isinstance(data, list) or len(data) > PAGE_SIZE:
        raise ValueError('Studio 작업 목록을 확인하지 못했습니다.')
    if any(not isinstance(item, dict) or not isinstance(item.get('status'), str)
           or item['status'] not in TERMINAL for item in data):
        raise ValueError('완료되지 않은 Studio 작업이 있습니다.')


def service_pid():
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', UNIT, '-p', 'LoadState',
        '-p', 'ActiveState', '-p', 'MainPID', '-p', 'Job'], check=True,
        capture_output=True, text=True, timeout=10)
    values = {}
    for line in result.stdout.splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in values:
            raise ValueError('Studio 서비스 상태를 확인하지 못했습니다.')
        values[key] = value
    pid = values.get('MainPID', '')
    if (values.get('LoadState') != 'loaded' or values.get('ActiveState') != 'active'
            or values.get('Job') != '' or not pid.isdecimal() or int(pid) <= 1):
        raise ValueError('Studio 서비스가 안정적으로 실행 중이지 않습니다.')
    return pid


def observe(token):
    """Observe authenticated status and jobs without logging them or the token."""
    if (os.geteuid() != 0 or not isinstance(token, str) or len(token) < 24
            or any(char.isspace() or ord(char) < 32 for char in token)):
        raise ValueError('root와 Studio 인증 정보가 필요합니다.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def get(path):
        request = urllib.request.Request(BASE + path, headers={'Authorization': 'Bearer ' + token})
        with opener.open(request, timeout=10) as response:
            raw = response.read(MAX_RESPONSE + 1)
        if len(raw) > MAX_RESPONSE:
            raise ValueError('Studio 응답이 너무 큽니다.')
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            raise ValueError('Studio 응답이 올바르지 않습니다.') from None
    pid = service_pid()
    require_idle_status(get('/system/status'))
    for page in range(MAX_PAGES):
        jobs = get(f'/jobs?limit={PAGE_SIZE}&offset={page * PAGE_SIZE}')
        require_finished_jobs(jobs)
        if len(jobs) < PAGE_SIZE:
            break
    else:
        raise ValueError('Studio 작업 목록의 끝을 확인하지 못했습니다.')
    require_idle_status(get('/system/status'))
    if service_pid() != pid:
        raise ValueError('확인 중 Studio 서비스가 재시작됐습니다.')
    return True
