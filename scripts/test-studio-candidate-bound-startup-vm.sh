#!/usr/bin/env bash
# Disposable systemd fixture only; preserve unit and evidence on failure.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && $(hostname) == bc250-fedora43-test \
  && $(systemd-detect-virt) == qemu && $(getenforce) == Enforcing && $# == 1 ]] || exit 1
source_dir=$1
studios=()
for path in /opt/bc250-studio-fixture-* /opt/bc250-current-studio-candidate.*; do
  [[ -d $path && ! -L $path && $(stat -c '%u %a' "$path") == '0 755' \
    && -x $path/.venv/bin/python && -f $path/backend/app/main.py ]] || continue
  [[ -z $(find "$path" ! -uid 0 -print -quit) \
    && -z $(find "$path" ! -type l -perm /022 -print -quit) ]] || continue
  if ! "$path/.venv/bin/python" -I - "$source_dir/backend/app" <<'PYSOURCE'
import hashlib
import sys
from pathlib import Path
import app
source = Path(sys.argv[1])
installed = Path(app.__file__).resolve().parent
for file in source.rglob('*.py'):
    target = installed / file.relative_to(source)
    if not target.is_file() or hashlib.sha256(file.read_bytes()).digest() != hashlib.sha256(target.read_bytes()).digest():
        raise SystemExit(1)
PYSOURCE
  then
    continue
  fi
  studios+=("$path")
done
[[ ${#studios[@]} == 1 ]] || {
  echo "현재 시험 소스와 일치하는 보호된 Studio 후보를 하나로 확인하지 못했습니다: ${#studios[@]}개" >&2; exit 1;
}
studio=${studios[0]}
echo "현재 시험 소스와 일치하는 Studio 후보: $studio"
id ai-studio >/dev/null
tools=$(mktemp -d /opt/bc250-studio-generation.XXXXXXXX)
chmod 0755 "$tools"
ready_dir=$(mktemp -d /var/lib/bc250-studio-candidate-ready.XXXXXXXX)
chown ai-studio:ai-studio "$ready_dir"
chmod 0700 "$ready_dir"
unit=bc250-studio-generation-fixture.service
unit_file="/etc/systemd/system/$unit"
[[ ! -e $unit_file && ! -L $unit_file && $(systemctl show "$unit" -p LoadState --value) == not-found ]] || exit 1
trap 'echo "시험 중단. 시험 unit과 기록 보존: $unit_file $tools $ready_dir" >&2' ERR
for file in old-studio-process-watch.py studio-generation-boundary.py studio-process-observer.py assemble-coordinator.py backup-archive.sh check-service-cgroup.py; do
  install -o root -g root -m 0644 "$source_dir/deploy/model-control/$file" "$tools/$file"
done
cat > "$unit_file" <<'EOF'
[Service]
ExecStart=/usr/bin/sleep infinity
WorkingDirectory=/
KillMode=control-group
EOF
restorecon -RF "$tools" "$unit_file" "$ready_dir"
systemctl daemon-reload
python3 - "$tools" "$unit" "$studio" "$unit_file" "$ready_dir" <<'PY'
import importlib.util
import pwd
import subprocess
import sys
import time
from pathlib import Path
tools = Path(sys.argv[1])
unit = sys.argv[2]
studio = Path(sys.argv[3])
unit_file = Path(sys.argv[4])
python_path = str(studio / '.venv/bin/python')
ready = Path(sys.argv[5]) / 'ready'
program = f"import app.main,time;open('{ready}','w').close();time.sleep(600)"
uid = pwd.getpwnam('ai-studio').pw_uid
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('studio_watch', tools / 'old-studio-process-watch.py')
watch_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch_module)
boundary_spec = importlib.util.spec_from_file_location('studio_boundary', tools / 'studio-generation-boundary.py')
boundary_module = importlib.util.module_from_spec(boundary_spec)
boundary_spec.loader.exec_module(boundary_module)
observer_spec = importlib.util.spec_from_file_location('studio_observer', tools / 'studio-process-observer.py')
observer = importlib.util.module_from_spec(observer_spec)
observer_spec.loader.exec_module(observer)
assembler_spec = importlib.util.spec_from_file_location('fixture_assembler', tools / 'assemble-coordinator.py')
assembler = importlib.util.module_from_spec(assembler_spec)
assembler_spec.loader.exec_module(assembler)
def ctl(*args):
    return subprocess.run(['/usr/bin/systemctl', *args], check=True, capture_output=True, text=True).stdout
def stopped():
    return subprocess.run(['/usr/bin/bash', '-c', 'source "$1"; bc250_require_stopped "$2"',
                           'fixture', str(tools / 'backup-archive.sh'), unit],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
def main_pid():
    value = ctl('show', unit, '-p', 'MainPID', '--value').strip()
    if not value.isdecimal() or int(value) <= 1:
        raise RuntimeError('시험 주 프로세스를 확인하지 못했습니다.')
    return int(value)
ctl('start', unit)
old_pid = main_pid()
old = watch_module.OldStudioProcessWatch(old_pid, watch_module.process_starttime(old_pid))
def observe_new():
    pid = main_pid()
    return pid, watch_module.process_starttime(pid)
def verify_new(identity):
    return observer.verify(identity, main_pid=main_pid, python=python_path,
        cwd=studio, argv=(python_path.encode(), b'-I', b'-c', program.encode()), uid=uid)
candidate = boundary_module.StudioGenerationBoundary(old, check_stopped=stopped,
    observe_replacement=observe_new, verify_replacement=verify_new)
class FixtureStartup:
    def __init__(self):
        self.confirmed = False
    def start(self):
        unit_file.write_text('[Service]\n' + f'ExecStart={python_path} -I -c "{program}"\n'
            + f'WorkingDirectory={studio}\nUser=ai-studio\nGroup=ai-studio\nKillMode=control-group\n')
        subprocess.run(['/usr/sbin/restorecon', '-F', str(unit_file)], check=True)
        ctl('daemon-reload')
        ctl('start', unit)
        deadline = time.monotonic() + 30
        while not ready.is_file():
            if time.monotonic() >= deadline:
                raise RuntimeError('시험 후보 import 준비 시간이 초과됐습니다.')
            time.sleep(0.2)
    def finish(self):
        self.confirmed = True
fixture_startup = FixtureStartup()
installed = []
bound = assembler.GenerationBoundStartup(candidate, lambda _: installed.append(True) or True, fixture_startup)
try:
    if old.exited() or stopped():
        raise RuntimeError('기존 시험 서비스 실행 중 정지로 판단했습니다.')
    early = boundary_module.StudioGenerationBoundary(old, check_stopped=stopped,
        observe_replacement=observe_new, verify_replacement=verify_new)
    try:
        early.mark_stopped()
    except boundary_module.GenerationError:
        pass
    else:
        raise RuntimeError('실행 중인 기존 시험 서비스 정지를 허용했습니다.')
    ctl('stop', unit)
    if not bound.install('/fixture/backup') or installed != [True]:
        raise RuntimeError('시험 세대 정지와 모의 설치 연결 실패')
    if not old.exited() or not stopped():
        raise RuntimeError('기존 시험 서비스의 종료 또는 cgroup 정지 확인 실패')
    print('기존 시험 서비스 실행 중 정지 거절과 정지 후 주 프로세스·cgroup 확인', flush=True)
    bound.start()
    new_pid = main_pid()
    if not candidate.check():
        raise RuntimeError('신규 시험 세대 검사 실패')
    print('시험 정지·모의 설치·신규 세대 바인딩을 시작 조율 후보에 연결 확인', flush=True)
    try:
        observer.verify(observe_new(), main_pid=main_pid, python=python_path,
            cwd=studio, argv=(python_path.encode(), b'-I', b'-c', b'wrong'), uid=uid)
    except ValueError:
        print('시험 세대의 잘못된 실행 인자 거절 확인', flush=True)
    else:
        raise RuntimeError('잘못된 시험 프로세스 인자가 허용됐습니다.')
    if new_pid == old_pid or not old.exited() or stopped():
        raise RuntimeError('새 시험 서비스 세대 구분에 실패했습니다.')
    print('새 시험 서비스 기동 중 기존 주 프로세스 종료와 활성 unit 정지 거절 확인', flush=True)
    ctl('stop', unit)
    try:
        bound.finish()
    except Exception:
        pass
    else:
        raise RuntimeError('신규 시험 세대 종료 후 시작 확인이 허용됐습니다.')
    if fixture_startup.confirmed or not stopped():
        raise RuntimeError('세대 종료 뒤 확인이 수행됐거나 서비스가 남았습니다.')
    print('신규 시험 세대 종료 시 확인 전 중단과 재사용 거절 확인', flush=True)
    try:
        bound.finish()
    except ValueError:
        pass
    else:
        raise RuntimeError('실패한 시험 시작 확인이 재사용됐습니다.')
finally:
    old.close()
PY
rm -- "$unit_file"
systemctl daemon-reload
trap - ERR
echo "시험 unit 정리 완료; 시험 도구·준비 기록 보관: $tools $ready_dir"
echo '설치·Client 확인·GPU·직접 호출 차단은 모의이며 실제 Studio 서비스는 변경하지 않았습니다.'
