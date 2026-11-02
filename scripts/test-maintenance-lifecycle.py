#!/usr/bin/env python3
"""Exercise Caddy maintenance entry and restoration on disposable ports."""

import importlib.util
import contextlib
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        body = (self.server.label + ':' + self.path).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    if len(sys.argv) not in (3, 5, 6) or (len(sys.argv) == 6 and sys.argv[5] not in ('uncertain', 'transaction', 'linked', 'adapter', 'adapter-systemd', 'systemd-linked')):
        raise SystemExit('사용법: test-maintenance-lifecycle.py Caddyfile 생성기 [보관기 교체기 [uncertain|transaction]]')
    caddy = shutil.which('caddy')
    if not caddy:
        raise SystemExit('caddy 실행 파일이 없습니다.')
    spec = importlib.util.spec_from_file_location('caddy_generator', sys.argv[2])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = Path(sys.argv[1]).read_text(encoding='utf-8')
    maintenance = module.candidate(original)
    servers = []
    threads = []
    for label in ('studio', 'client', 'wiki'):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        server.label = label
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        servers.append(server)
        threads.append(thread)
    try:
        systemd_fixture = len(sys.argv) == 6 and sys.argv[5] in ('adapter-systemd', 'systemd-linked')
        temporary = (contextlib.nullcontext(tempfile.mkdtemp(prefix='bc250-caddy-cycle-', dir='/var/backups'))
                     if systemd_fixture else tempfile.TemporaryDirectory(prefix='bc250-caddy-cycle-'))
        with temporary as temp:
            root = Path(temp)
            for name in ('studio', 'client'):
                (root / name).mkdir()
                (root / name / 'index.html').write_text(name + '-static', encoding='utf-8')
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                admin = sock.getsockname()[1]
            if port == admin:
                raise RuntimeError('시험 포트가 중복됐습니다.')
            replacements = {
                ':80 {': f'http://127.0.0.1:{port} {{',
                '127.0.0.1:8090': f'127.0.0.1:{servers[0].server_port}',
                '127.0.0.1:8010': f'127.0.0.1:{servers[1].server_port}',
                '127.0.0.1:8020': f'127.0.0.1:{servers[2].server_port}',
                '/opt/bc250-ai-studio/frontend/dist': str(root / 'studio'),
                '/opt/bc250-llm-client/frontend/dist': str(root / 'client'),
            }

            def make_config(text, name):
                for old, new in replacements.items():
                    # API upstreams are absent from the maintenance candidate.
                    if old not in text and old in ('127.0.0.1:8090', '127.0.0.1:8010'):
                        continue
                    if text.count(old) != 1:
                        raise ValueError('시험 구성의 예상 항목 수가 다릅니다.')
                    text = text.replace(old, new)
                path = root / name
                path.write_text(f'{{\n admin 127.0.0.1:{admin}\n auto_https off\n}}\n' + text,
                                encoding='utf-8')
                return path

            normal = make_config(original, 'normal.caddy')
            paused = make_config(maintenance, 'maintenance.caddy')
            atomic = len(sys.argv) >= 5
            if atomic:
                def load(name, path):
                    spec = importlib.util.spec_from_file_location(name, path)
                    loaded = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(loaded)
                    return loaded

                capture = load('fixture_capture', sys.argv[3])
                swap = load('fixture_swap', sys.argv[4])
                normal_text = normal.read_text(encoding='utf-8')
                paused_text = paused.read_text(encoding='utf-8')

                class FixtureGenerator:
                    @staticmethod
                    def candidate(text):
                        if text != normal_text:
                            raise ValueError('시험 원본 설정이 변경됐습니다.')
                        return paused_text

                # Only this disposable, unprivileged fixture bypasses root path checks.
                # Root ownership and SELinux behavior are tested separately in the VM.
                def fixture_trusted(path, *, directory):
                    if not Path(path).resolve().is_relative_to(root.resolve()):
                        raise ValueError('시험 디렉터리 밖의 경로입니다.')

                if not systemd_fixture:
                    capture.trusted = fixture_trusted
                capture.candidate_module = lambda _: FixtureGenerator
                snapshot = capture.capture(normal, root, Path(sys.argv[2]))
            env = {**os.environ, 'XDG_CONFIG_HOME': temp, 'XDG_DATA_HOME': temp}
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def get(path):
                try:
                    with opener.open(f'http://127.0.0.1:{port}{path}', timeout=3) as response:
                        return response.status, response.read()
                except urllib.error.HTTPError as error:
                    return error.code, error.read()

            def check(maintenance_mode):
                expected = ((503, None), (503, None)) if maintenance_mode else (
                    (200, b'studio:/api/probe'), (200, b'client:/api/probe'))
                for path, (status, body) in zip(('/api/probe', '/llm/api/probe'), expected):
                    actual_status, actual_body = get(path)
                    if actual_status != status or (body is not None and actual_body != body):
                        raise RuntimeError(f'시험 API 경로 확인 실패: {path} / {actual_status}')
                if get('/wiki/probe') != (200, b'wiki:/probe'):
                    raise RuntimeError('시험 Wiki 경로 확인 실패')

            with (root / 'caddy.log').open('w+', encoding='utf-8') as log:
                process = None
                unit = Path('/run/systemd/system/bc250-caddy-fixture.service')
                success = False
                if systemd_fixture:
                    if os.geteuid() != 0 or unit.exists() or unit.is_symlink():
                        raise RuntimeError('시험 Caddy unit이 이미 있거나 root가 아닙니다.')
                    state = subprocess.check_output(['/usr/bin/systemctl', 'show',
                        'bc250-caddy-fixture.service', '-p', 'LoadState', '--value'], text=True).strip()
                    if state != 'not-found':
                        raise RuntimeError('기존 시험 Caddy unit을 확인했습니다.')
                    unit.write_text('[Unit]\nDescription=Disposable Caddy fixture\n[Service]\nType=exec\n'
                        f'Environment=XDG_CONFIG_HOME={temp}\nEnvironment=XDG_DATA_HOME={temp}\n'
                        f'ExecStart={caddy} run --config {normal} --adapter caddyfile\n'
                        f'ExecReload={caddy} reload --address 127.0.0.1:{admin} --config {normal} --adapter caddyfile\n'
                        'KillMode=control-group\n')
                    subprocess.run(['/usr/sbin/restorecon', '-F', str(unit)], check=True)
                    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
                    print('시험 Caddy systemd unit과 기록 경로:', temp, flush=True)
                    subprocess.run(['/usr/bin/systemctl', 'start', 'bc250-caddy-fixture.service'], check=True)
                else:
                    process = subprocess.Popen([caddy, 'run', '--config', str(normal),
                                                '--adapter', 'caddyfile'], stdout=log, stderr=log, env=env)
                try:
                    for _ in range(100):
                        if process is not None and process.poll() is not None:
                            raise RuntimeError('시험 Caddy 시작 실패')
                        try:
                            check(False)
                            break
                        except (OSError, TimeoutError):
                            time.sleep(0.1)
                    else:
                        raise RuntimeError('시험 Caddy 시작 시간 초과')
                    print('시험 정상 API와 Wiki 확인', flush=True)
                    def reload(config, *, check_result=True, address=None):
                        return subprocess.run([caddy, 'reload', '--address', address or f'127.0.0.1:{admin}',
                                               '--config', str(config), '--adapter', 'caddyfile'],
                                              check=check_result, stdout=log, stderr=log,
                                              timeout=20, env=env)

                    if atomic and len(sys.argv) == 5:
                        swap.swap(snapshot, normal, Path(sys.argv[2]), 'enter', capture)
                        broken = root / 'invalid.caddy'
                        broken.write_text('invalid {\n', encoding='utf-8')
                        if reload(broken, check_result=False).returncode == 0:
                            raise RuntimeError('잘못된 설정의 reload가 성공했습니다.')
                        check(False)
                        swap.swap(snapshot, normal, Path(sys.argv[2]), 'restore', capture)
                        reload(normal)
                        check(False)
                        print('시험 reload 실패 시 기존 응답과 원본 파일 복원 확인', flush=True)

                    if len(sys.argv) == 6 and sys.argv[5] == 'uncertain':
                        # Forward the complete admin exchange, then discard its response.
                        # This deliberately makes the client result ambiguous even though
                        # Caddy has already answered its admin request.
                        listener = socket.socket()
                        listener.bind(('127.0.0.1', 0))
                        listener.listen(1)
                        listener.settimeout(20)
                        proxy_port = listener.getsockname()[1]
                        errors = []

                        def discard_response():
                            try:
                                with listener, listener.accept()[0] as incoming:
                                    incoming.settimeout(15)
                                    with socket.create_connection(('127.0.0.1', admin), timeout=15) as upstream:
                                        upstream.settimeout(15)
                                        header = b''
                                        while b'\r\n\r\n' not in header:
                                            chunk = incoming.recv(65536)
                                            if not chunk:
                                                raise RuntimeError('시험 요청이 중간에 끝났습니다.')
                                            header += chunk
                                            if len(header) > 1048576:
                                                raise RuntimeError('시험 요청이 너무 큽니다.')
                                        head, body = header.split(b'\r\n\r\n', 1)
                                        lengths = [line.split(b':', 1)[1].strip() for line in head.split(b'\r\n')
                                                   if line.lower().startswith(b'content-length:')]
                                        if len(lengths) != 1:
                                            raise RuntimeError('시험 요청 길이를 확인하지 못했습니다.')
                                        length = int(lengths[0])
                                        lines = head.split(b'\r\n')
                                        hosts = [i for i, line in enumerate(lines)
                                                 if line.lower().startswith(b'host:')]
                                        if len(hosts) != 1:
                                            raise RuntimeError('시험 요청의 Host를 확인하지 못했습니다.')
                                        lines[hosts[0]] = f'Host: 127.0.0.1:{admin}'.encode('ascii')
                                        origins = [i for i, line in enumerate(lines)
                                                   if line.lower().startswith(b'origin:')]
                                        if len(origins) > 1:
                                            raise RuntimeError('시험 요청의 Origin이 중복됐습니다.')
                                        if origins:
                                            lines[origins[0]] = f'Origin: http://127.0.0.1:{admin}'.encode('ascii')
                                        upstream.sendall(b'\r\n'.join(lines) + b'\r\n\r\n' + body)
                                        remaining = length - len(body)
                                        while remaining > 0:
                                            chunk = incoming.recv(min(65536, remaining))
                                            if not chunk:
                                                raise RuntimeError('시험 요청 본문이 중간에 끝났습니다.')
                                            upstream.sendall(chunk)
                                            remaining -= len(chunk)
                                        response = b''
                                        while b'\r\n' not in response:
                                            chunk = upstream.recv(4096)
                                            if not chunk:
                                                raise RuntimeError('시험 Caddy 응답이 없습니다.')
                                            response += chunk
                                            if len(response) > 65536:
                                                raise RuntimeError('시험 Caddy 응답이 너무 깁니다.')
                                        status = response.split(b'\r\n', 1)[0].split()
                                        if len(status) < 2 or status[1] != b'200':
                                            code = status[1].decode('ascii', errors='replace') if len(status) >= 2 else 'unknown'
                                            raise RuntimeError('시험 Caddy가 reload를 거절했습니다. HTTP ' + code)
                            except Exception as exc:
                                errors.append(str(exc))

                        proxy = threading.Thread(target=discard_response, daemon=True)
                        proxy.start()
                        swap.swap(snapshot, normal, Path(sys.argv[2]), 'enter', capture)
                        result = reload(normal, check_result=False, address=f'127.0.0.1:{proxy_port}')
                        proxy.join(timeout=20)
                        if proxy.is_alive() or errors or result.returncode == 0:
                            raise RuntimeError('응답 유실 시험을 확인하지 못했습니다: ' + ', '.join(errors))
                        check(True)
                        print('시험 reload 응답 유실: 명령 실패에도 유지보수 적용 확인', flush=True)
                        swap.swap(snapshot, normal, Path(sys.argv[2]), 'restore', capture)
                        reload(normal)
                        check(False)
                        print('시험 reload 결과 불명확 후 원본 응답 복원 확인', flush=True)

                    if len(sys.argv) == 6 and sys.argv[5] in ('adapter', 'adapter-systemd', 'systemd-linked'):
                        adapter_module = load('fixture_caddy_adapter',
                                              Path(sys.argv[4]).with_name('caddy-maintenance-adapter.py'))
                        transaction_module = load('fixture_transaction',
                                                  Path(sys.argv[4]).with_name('caddy-transaction.py'))
                        maintenance_module = load('fixture_probe',
                                                  Path(sys.argv[4]).with_name('maintenance-probe.py'))
                        raw_probe = maintenance_module.probe
                        maintenance_module.probe = lambda: raw_probe(f'http://127.0.0.1:{port}')
                        modules = {'caddy_capture': capture, 'caddy_swap': swap,
                                   'caddy_transaction': transaction_module, 'caddy_probe': maintenance_module}
                        # The unprivileged fixture lives under /tmp. The systemd
                        # fixture uses root-owned /var/backups and /opt paths.
                        if not systemd_fixture:
                            adapter_module.trusted = lambda *args, **kwargs: None
                        if not systemd_fixture:
                            adapter_module.service_ready = lambda: None
                        def fixture_load(name, path):
                            if systemd_fixture:
                                adapter_module.trusted(path)
                            return modules[name]
                        adapter_module.load = fixture_load
                        adapter_module.CADDY = Path(caddy)
                        adapter_module.CADDYFILE = normal
                        if systemd_fixture:
                            adapter_module.SERVICE = 'bc250-caddy-fixture.service'
                        def restored():
                            try:
                                check(False)
                                return True
                            except (OSError, TimeoutError, RuntimeError):
                                return False
                        adapter = adapter_module.CaddyMaintenanceAdapter(
                            Path(sys.argv[2]).parent, snapshot,
                            check_local_idle=lambda: True, check_restored=restored)
                        if not systemd_fixture:
                            adapter.reload = lambda path: reload(path)
                        adapter.transition('enter')
                        check(True)
                        if sys.argv[5] == 'systemd-linked':
                            source = Path(os.environ['BC250_FIXTURE_SOURCE_DIR']).resolve()
                            linked_env = dict(env, BC250_FIXTURE_CADDY_BASE=f'http://127.0.0.1:{port}')
                            subprocess.run(['bash', str(source / 'scripts/test-service-migration-rollback-vm.sh'),
                                            str(source)], check=True, timeout=1200, env=linked_env)
                            check(True)
                            print('시험 systemd Caddy 유지보수 중 gate·백업·상태 보존·복구 확인', flush=True)
                        adapter.transition('restore')
                        check(False)
                        print('시험 Caddy 어댑터의 검증·유지보수 진입·정상 응답 복원 확인', flush=True)
                        if systemd_fixture:
                            print('시험 root 소유 경로 검사와 실제 systemd reload·응답 확인', flush=True)
                        else:
                            def lost(path):
                                reload(path)
                                raise OSError('fixture response lost')
                            adapter.reload = lost
                            try:
                                adapter.transition('enter')
                            except transaction_module.TransitionError:
                                pass
                            else:
                                raise RuntimeError('응답 유실을 잘못 성공으로 판정했습니다.')
                            check(True)
                            print('시험 Caddy 어댑터가 reload 결과 불명확 시 중단 확인', flush=True)
                            adapter.reload = lambda path: reload(path)
                            adapter.transition('restore')
                            check(False)

                    if len(sys.argv) == 6 and sys.argv[5] in ('transaction', 'linked'):
                        transaction = load('fixture_transaction',
                                           Path(sys.argv[4]).with_name('caddy-transaction.py'))
                        maintenance_probe = load('fixture_maintenance_probe',
                                                 Path(sys.argv[4]).with_name('maintenance-probe.py'))

                        def validate(path):
                            subprocess.run([caddy, 'validate', '--config', str(path), '--adapter', 'caddyfile'],
                                           check=True, stdout=log, stderr=log, timeout=20, env=env)

                        def probe():
                            status, _ = get('/api/probe')
                            if status == 503:
                                check(True)
                                maintenance_probe.probe(f'http://127.0.0.1:{port}')
                                return True
                            if status == 200:
                                check(False)
                                return False
                            raise RuntimeError('시험 Caddy 응답을 확인하지 못했습니다.')

                        def perform(mode, reload_fn=reload):
                            return transaction.transition(mode=mode, snapshot=snapshot, live=normal,
                                generator=Path(sys.argv[2]), capture=capture, swap=swap.swap,
                                validate=validate, reload=reload_fn, probe=probe)

                        def response_lost(path):
                            reload(path)
                            raise OSError('시험 응답 유실')

                        try:
                            perform('enter', response_lost)
                        except transaction.TransitionError:
                            pass
                        else:
                            raise RuntimeError('reload 결과 불명확 상태를 거절하지 않았습니다.')
                        check(True)
                        print('연결 로직이 reload 결과 불명확 시 중단하고 적용 상태를 보존함을 확인', flush=True)
                        perform('restore')
                        check(False)
                        perform('enter')
                        check(True)
                        if sys.argv[5] == 'linked':
                            source = Path(sys.argv[2]).resolve().parents[2]
                            linked_env = dict(env, BC250_FIXTURE_CADDY_BASE=f'http://127.0.0.1:{port}')
                            subprocess.run(['bash', str(source / 'scripts/test-service-migration-rollback-vm.sh'),
                                            str(source)], check=True, timeout=1200, env=linked_env)
                            check(True)
                            print('시험 백업·복구 내내 Caddy 유지보수 응답 확인', flush=True)
                        perform('restore')
                        check(False)
                        print('연결 로직의 검증·유지보수 진입·원본 복원 확인', flush=True)

                    for config, mode in (() if len(sys.argv) == 6 else ((paused, True), (normal, False))):
                        if atomic:
                            swap.swap(snapshot, normal, Path(sys.argv[2]),
                                      'enter' if mode else 'restore', capture)
                            config = normal
                        reload(config)
                        check(mode)
                        print('시험 유지보수 진입 확인' if mode else '시험 원본 설정 복원 확인',
                              flush=True)
                    success = True
                finally:
                    if systemd_fixture:
                        if success:
                            subprocess.run(['/usr/bin/systemctl', 'stop', 'bc250-caddy-fixture.service'], check=True)
                            unit.unlink()
                            subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
                            print('시험 Caddy unit 정리 완료; 기록 보관:', temp, flush=True)
                        else:
                            print('시험 Caddy unit과 기록을 보존합니다:', temp, flush=True)
                    else:
                        process.terminate()
                        try:
                            process.wait(timeout=10)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
