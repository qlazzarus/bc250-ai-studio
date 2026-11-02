#!/usr/bin/env python3
"""Two-phase initial service startup candidate; no operational CLI.

Phase one starts the new services but never starts the Client. The operator
must restart the Client manually before phase two. Neither phase changes the
Caddy configuration or performs a model switch.
"""

import json
import os
import re
import stat
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVICE_UNITS = ('bc250-ai-studio.service', 'bc250-llm-gate.service',
                 'bc250-llm-client.service', 'bc250-model-worker.service',
                 'bc250-model-api.service')
SOCKET = 'bc250-model-worker.socket'
PYTHON = Path('/opt/bc250-model-control/.venv/bin/python')
API_KEY = Path('/etc/bc250-model-control/api-key')
TMPFILES = Path('/etc/tmpfiles.d/bc250-gpu-lock.conf')
ENABLE_LINKS = (Path('/etc/systemd/system/sockets.target.wants/bc250-model-worker.socket'),
                Path('/etc/systemd/system/multi-user.target.wants/bc250-model-api.service'))


class StartupError(RuntimeError):
    """The requested phase was not confirmed; do not release maintenance."""


def trusted_file(path):
    if not path.is_absolute() or '..' in path.parts:
        raise StartupError('신뢰할 수 없는 도구 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise StartupError('도구 경로의 소유권 또는 권한이 올바르지 않습니다.')
        if item != path and not stat.S_ISDIR(info.st_mode):
            raise StartupError('도구 상위 경로가 디렉터리가 아닙니다.')
    if not stat.S_ISREG(path.lstat().st_mode) or path.lstat().st_nlink != 1:
        raise StartupError('도구가 단일 링크의 일반 파일이 아닙니다.')


def command(args, *, timeout=60):
    subprocess.run(args, check=True, timeout=timeout, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def properties(unit, *names):
    result = subprocess.run(['/usr/bin/systemctl', 'show', '--all', unit,
                             *[f'-p{name}' for name in names]], check=True,
                            capture_output=True, text=True, timeout=10)
    values = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise StartupError('서비스 상태를 확인하지 못했습니다.')
        values[key] = value
    return values


def socket_stopped():
    value = properties(SOCKET, 'LoadState', 'ActiveState', 'Job')
    if value != {'LoadState': 'loaded', 'ActiveState': 'inactive', 'Job': ''}:
        raise StartupError('작업자 소켓이 정지 상태가 아닙니다.')


def active_pid(unit, user):
    value = properties(unit, 'LoadState', 'ActiveState', 'Job', 'MainPID', 'User')
    pid = value.get('MainPID', '')
    if (value.get('LoadState') != 'loaded' or value.get('ActiveState') != 'active'
            or value.get('Job') != '' or value.get('User') != user
            or not pid.isdecimal() or int(pid) <= 1):
        raise StartupError('실행 중인 서비스 상태를 확인하지 못했습니다.')
    return pid


def worker_disabled():
    pid = active_pid('bc250-model-worker.service', 'root')
    with (Path('/proc') / pid / 'environ').open('rb') as file:
        data = file.read(131073)
    if len(data) > 131072:
        raise StartupError('작업자 환경 크기가 예상과 다릅니다.')
    values = [item for item in data.split(b'\0') if item.startswith(b'MODEL_CONTROL_SWITCH_ENABLED=')]
    if values != [b'MODEL_CONTROL_SWITCH_ENABLED=false']:
        raise StartupError('작업자의 전환 비활성 설정을 확인하지 못했습니다.')
    if active_pid('bc250-model-worker.service', 'root') != pid:
        raise StartupError('확인 중 작업자 프로세스가 변경됐습니다.')


def api_ready():
    info = API_KEY.lstat()
    if not API_KEY.is_file() or API_KEY.is_symlink() or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
        raise StartupError('관리 API 키 파일의 보호 상태가 올바르지 않습니다.')
    key = API_KEY.read_text(encoding='utf-8').strip()
    if len(key) < 24 or any(char.isspace() for char in key):
        raise StartupError('관리 API 키 형식이 올바르지 않습니다.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url = 'http://127.0.0.1:8091/api/v1/llm/models'
    try:
        with opener.open(url, timeout=10):
            raise StartupError('관리 API가 인증 없는 요청을 허용했습니다.')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise StartupError('관리 API의 미인증 응답이 예상과 다릅니다.') from None
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
    with opener.open(request, timeout=10) as response:
        raw = response.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise StartupError('관리 API 모델 목록이 너무 큽니다.')
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('models'), list) or not data['models']:
        raise StartupError('관리 API의 인증된 모델 목록을 확인하지 못했습니다.')


def wait_for_coordination(expected_user, *, timeout=60):
    """Wait only for a refused connection; never retry hold release."""
    probe = '''import sys, urllib.error
from app.services.gate_admin import coordinated_participants_are_ready
try:
    coordinated_participants_are_ready(sys.argv[1])
except urllib.error.URLError as error:
    if type(error) is urllib.error.URLError and isinstance(error.reason, ConnectionRefusedError):
        raise SystemExit(75) from None
    raise SystemExit(1) from None
except Exception:
    raise SystemExit(1) from None
'''
    end = time.monotonic() + timeout
    while True:
        result = subprocess.run([str(PYTHON), '-I', '-c', probe, expected_user],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=15, check=False)
        if result.returncode == 0:
            return
        if result.returncode != 75:
            raise StartupError('Studio·gate·Client 조율 준비 검증에 실패했습니다.')
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise StartupError('Studio·gate·Client 연결 준비 시간이 초과됐습니다.')
        time.sleep(min(1, remaining))


class NewServiceStart:
    def __init__(self, guard_script, *, check_maintenance, check_release, check_local_idle,
                 check_configuration, expected_client_user):
        if (os.geteuid() != 0 or not all(callable(x) for x in
                (check_maintenance, check_release, check_local_idle, check_configuration))
                or not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', expected_client_user)):
            raise ValueError('root와 필수 검증 조건이 필요합니다.')
        self.guard_script = Path(guard_script)
        self.check_maintenance = check_maintenance
        self.check_release = check_release
        self.check_local_idle = check_local_idle
        self.check_configuration = check_configuration
        self.client_user = expected_client_user

    def preconditions(self):
        trusted_file(self.guard_script)
        trusted_file(self.guard_script.with_name('check-service-cgroup.py'))
        if (self.check_maintenance() is not True or self.check_release() is not True
                or self.check_local_idle() is not True or self.check_configuration() is not True):
            raise StartupError('유지보수·릴리스·로컬 유휴 또는 신규 설정이 확인되지 않았습니다.')

    def start(self):
        """Start new services and stop for the operator's Client restart."""
        self.preconditions()
        command(['/usr/bin/systemctl', 'daemon-reload'])
        command(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                 'startup-check', str(self.guard_script), *SERVICE_UNITS])
        socket_stopped()
        self.preconditions()
        trusted_file(TMPFILES)
        command(['/usr/bin/systemd-tmpfiles', '--create', str(TMPFILES)])
        for unit in ('bc250-llm-gate.service', SOCKET, 'bc250-ai-studio.service', 'bc250-model-api.service'):
            command(['/usr/bin/systemctl', 'start', unit], timeout=1200)
        print('신규 서비스 시작 요청 완료. Client를 운영자가 수동 재시작한 뒤 검증을 계속하세요.', flush=True)

    def finish(self):
        """Verify the manually restarted Client and release only startup hold."""
        self.preconditions()
        command([str(PYTHON), '-I', '-m', 'app.services.client_gate_check',
                 '--expected-user', self.client_user])
        trusted_file(API_KEY)
        # The authenticated request activates the socket-owned worker.
        api_ready()
        worker_disabled()
        wait_for_coordination(self.client_user)
        self.preconditions()
        if any(path.exists() or path.is_symlink() for path in ENABLE_LINKS):
            raise StartupError('새 서비스 enablement 경로가 이미 존재합니다.')
        command(['/usr/bin/systemctl', 'enable', SOCKET, 'bc250-model-api.service'])
        for unit in (SOCKET, 'bc250-model-api.service'):
            command(['/usr/bin/systemctl', 'is-enabled', '--quiet', unit])
        self.preconditions()
        # This verifies gate/Studio/Client, pending state and current model
        # health under the GPU lock; only the startup hold is released.
        command([str(PYTHON), '-I', '-m', 'app.services.gate_admin', 'confirm-startup',
                 '--expected-client-user', self.client_user], timeout=600)
        print('신규 서비스와 수동 재시작한 Client 확인 완료; 기존 관리자 보류는 유지됩니다.', flush=True)
