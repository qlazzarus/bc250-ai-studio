#!/usr/bin/env python3
"""Production-path adapter candidate for legacy-backup-sequence; no CLI.

Call only from a trusted root-owned coordinator after separately proving that
local callers and Studio/GPU work are quiescent. No service is touched by import
or construction. This candidate has not been validated for operational use.
"""

import importlib.util
import os
import re
import stat
import subprocess
from pathlib import Path

UNITS = ('bc250-ai-studio.service', 'bc250-llm-client.service', 'bc250-llm-gate.service')
LIVE_CADDY = Path('/etc/caddy/Caddyfile')
OLD_ENV = Path('/etc/bc250-llm-gate.env')
PAUSE_RECORD = Path('/var/lib/bc250-model-control/legacy-pause.json')
STUDIO_DATABASE = Path('/opt/ai-studio-data/database/studio.sqlite3')


def trusted(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('신뢰할 수 없는 경로입니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('경로 소유권 또는 권한이 올바르지 않습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('디렉터리 경로가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('단일 링크의 일반 파일이 아닙니다.')


def load(name, path):
    trusted(path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LegacyBackupAdapter:
    def __init__(self, source, snapshot, *, check_local_idle, check_database_fence):
        if os.geteuid() != 0 or not callable(check_local_idle) or not callable(check_database_fence):
            raise ValueError('root와 직접 호출·GPU 유휴 및 지속 DB 쓰기 차단 검사기가 필요합니다.')
        self.source = Path(source)
        self.snapshot = Path(snapshot)
        self.check_local_idle = check_local_idle
        # The caller must establish and maintain exclusion, including existing
        # references. A process/FD snapshot alone is not this fence.
        self.check_database_fence = check_database_fence
        trusted(self.source, directory=True)
        trusted(self.snapshot, directory=True)
        if self.snapshot.stat().st_mode & 0o077:
            raise ValueError('Caddy 보관 디렉터리는 root 전용이어야 합니다.')
        for name in ('backup-stopped.sh', 'backup-archive.sh', 'check-service-cgroup.py',
                     'verify-backup.py', 'create-maintenance-caddy.py'):
            trusted(self.source / name)
        self.migration = load('legacy_gate_migration', self.source / 'migrate-legacy-gate.py')
        self.capture = load('caddy_capture', self.source / 'capture-caddy.py')
        self.probe = load('maintenance_probe', self.source / 'maintenance-probe.py')
        self.sequence = load('legacy_backup_sequence', self.source / 'legacy-backup-sequence.py')
        self.studio_db = load('stopped_studio_db', self.source / 'inspect-stopped-studio-db.py')
        self.llama_connections = load('llama_connections', self.source / 'observe-llama-connections.py')

    def maintenance(self):
        self.capture.verify_snapshot(self.snapshot, LIVE_CADDY,
                                     self.source / 'create-maintenance-caddy.py',
                                     require_current=False)
        original = self.snapshot / 'Caddyfile.original'
        candidate = self.snapshot / 'Caddyfile.maintenance'
        if (self.capture.digest(LIVE_CADDY) != self.capture.digest(candidate)
                or self.capture.metadata(LIVE_CADDY) != self.capture.metadata(original)):
            raise RuntimeError('현재 Caddyfile이 보관된 유지보수 후보와 다릅니다.')
        return self.probe.probe()

    def key(self):
        trusted(OLD_ENV)
        trusted(PAUSE_RECORD.parent, directory=True)
        return self.migration.legacy_key(OLD_ENV)

    def capture_pause(self):
        if self.check_local_idle() is not True:
            raise RuntimeError('직접 호출·Studio·GPU 유휴 상태가 확인되지 않았습니다.')
        return self.migration.capture(self.key(), PAUSE_RECORD)

    def gate_status(self):
        return self.migration.request(self.key(), 'GET')

    def stop(self):
        if self.check_local_idle() is not True:
            raise RuntimeError('서비스 정지 전 유휴 상태가 확인되지 않았습니다.')
        for unit in UNITS:
            if unit == UNITS[2]:
                self.sequence._drained(self.gate_status())
                self.maintenance()
            subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=True, timeout=1200)

    def require_stopped(self):
        script = self.source / 'backup-archive.sh'
        subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; shift; bc250_require_stopped "$@"',
                        'backup-check', str(script), *UNITS], check=True, timeout=60)

    def require_stopped_with_clear_database(self):
        if self.check_local_idle() is not True:
            raise RuntimeError('DB 검사 전 로컬 유휴 상태가 확인되지 않았습니다.')
        if self.check_database_fence() is not True:
            raise RuntimeError('DB 검사 전 지속 쓰기 차단이 확인되지 않았습니다.')
        if self.llama_connections.check_host_llama() is not True:
            raise RuntimeError('DB 검사 전 llama 연결 종료가 확인되지 않았습니다.')
        def stopped():
            self.require_stopped()
            if self.check_database_fence() is not True:
                raise RuntimeError('DB 검사 중 지속 쓰기 차단이 확인되지 않았습니다.')
            return True
        self.studio_db.inspect(STUDIO_DATABASE, check_stopped=stopped)
        if self.check_database_fence() is not True:
            raise RuntimeError('DB 검사 중 지속 쓰기 차단이 상실됐습니다.')
        if self.check_local_idle() is not True:
            raise RuntimeError('DB 검사 후 로컬 유휴 상태가 변경됐습니다.')
        if self.llama_connections.check_host_llama() is not True:
            raise RuntimeError('DB 검사 후 llama 연결 종료가 확인되지 않았습니다.')

    def create_backup(self):
        if self.check_local_idle() is not True:
            raise RuntimeError('백업 생성 전 로컬 유휴 상태가 확인되지 않았습니다.')
        if self.check_database_fence() is not True:
            raise RuntimeError('백업 생성 전 지속 DB 쓰기 차단이 확인되지 않았습니다.')
        if self.llama_connections.check_host_llama() is not True:
            raise RuntimeError('백업 생성 전 llama 연결 종료가 확인되지 않았습니다.')
        original = self.snapshot / 'Caddyfile.original'
        print('정지된 기존 구성 백업을 시작합니다. 완료 전에는 다음 단계로 진행하지 않습니다.', flush=True)
        result = subprocess.run(['/usr/bin/bash', str(self.source / 'backup-stopped.sh'), str(original)],
                                capture_output=True, text=True, timeout=7200)
        # The wrapper reports paths and errors only; it never prints env values.
        print(result.stdout, end='', flush=True)
        if result.returncode:
            print(result.stderr, end='', flush=True)
            raise RuntimeError('정지된 기존 구성 백업이 실패했습니다.')
        paths = re.findall(r'^백업 경로: (/var/backups/bc250-model-migration\.[A-Za-z0-9]{8})$',
                           result.stdout, flags=re.MULTILINE)
        if len(paths) != 1:
            raise RuntimeError('생성된 백업 경로를 확인하지 못했습니다.')
        backup = Path(paths[0])
        if self.check_database_fence() is not True:
            raise RuntimeError('백업 생성 중 DB 쓰기 차단이 상실됐습니다. 백업을 보존하세요.')
        if self.check_local_idle() is not True:
            raise RuntimeError('백업 생성 중 로컬 유휴 상태가 변경됐습니다. 백업을 보존하세요.')
        if self.llama_connections.check_host_llama() is not True:
            raise RuntimeError('백업 생성 중 llama 연결 상태가 변경됐습니다. 백업을 보존하세요.')
        return backup

    def verify_backup(self, backup):
        if self.check_database_fence() is not True:
            raise RuntimeError('백업 검증 전 DB 쓰기 차단이 확인되지 않았습니다.')
        subprocess.run(['/usr/bin/python3', str(self.source / 'verify-backup.py'), str(backup)],
                       check=True, timeout=7200)
        if self.check_database_fence() is not True:
            raise RuntimeError('백업 검증 중 DB 쓰기 차단이 상실됐습니다. 백업을 보존하세요.')
        if self.check_local_idle() is not True:
            raise RuntimeError('백업 검증 중 로컬 유휴 상태가 변경됐습니다. 백업을 보존하세요.')
        if self.llama_connections.check_host_llama() is not True:
            raise RuntimeError('백업 검증 후 llama 연결 종료가 확인되지 않았습니다. 백업을 보존하세요.')

    def run(self):
        return self.sequence.backup_legacy(
            check_maintenance=self.maintenance, capture_pause=self.capture_pause,
            gate_status=self.gate_status, stop_services=self.stop,
            require_stopped=self.require_stopped_with_clear_database, create_backup=self.create_backup,
            verify_backup=self.verify_backup)
