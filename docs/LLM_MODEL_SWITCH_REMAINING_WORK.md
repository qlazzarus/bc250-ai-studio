# 모델 전환: 로컬 작업과 서버 작업 구분

기준: 저장소 코드와 모의 서비스·분리된 root 네임스페이스에서 확인한 결과, 운영자가 알려준 Fedora 설정. 서버를 직접 변경하지 않았습니다. 실제 전환 기능은 아직 운영에 배포하거나 켤 단계가 아닙니다.

## 로컬에서 진행한 작업

- 전용 HTTP API → 제한된 Unix 소켓 → 단일 root 작업자 → 기존 모델 설정·systemd 어댑터를 연결했습니다. 임의 명령은 받지 않으며 전환은 기본적으로 꺼져 있습니다.
- gate 관리자·Studio·전환 키와 hold를 분리했습니다. gate 재시작 시 `startup` 보류를 두며, Studio가 실제로 새 공유 잠금·복구 계약과 gate의 Studio 역할을 사용하고 있는지 전환 전에 확인합니다. 로컬 loopback 인증 요청에는 환경 프록시를 사용하지 않습니다.
- GPU 잠금 경합 대기, LLM 요청 drain, 관리자 pause 유지, 재시작 실패·이전 모델 복구 실패, 실제 GGUF ID 확인, journal·DB 불일치와 고아 hold의 제한된 복구 후보를 구현했습니다. 수동 `ai-model`의 안전 절차 우회는 운영자가 허용한 예외입니다.
- HTTP→소켓→실제 gate 앱→모의 systemd/모델 registry를 연결해 성공·복구·실패를 시험했습니다. 별도 모의 작업자 프로세스를 hold 획득 전후, drain, 모델 적용, health, hold 해제 직후에 강제 종료하고 재시작해 기록과 차단 상태를 확인했습니다.
- Linux 사용자·마운트 네임스페이스에서 실제 root 소유 테스트 파일로 flock, journal·모델 설정 권한, 비밀 파일 생성·덮어쓰기 방지와 잠금 의존성 기반 비편집 코드 설치를 확인했습니다. 이는 Fedora SELinux와 실제 다중 UID 검증을 대신하지 않습니다.
- Python 3.12·3.14에서 각각 백엔드 245개 테스트를 통과했고 root 네임스페이스 전용 6개는 별도로 모두 통과했습니다. Ruff, 프런트엔드 lint·빌드, Python 3.14 비편집 패키지 설치·isolated import도 확인했습니다. systemd 유닛은 로컬에 없는 실행 파일 경로만 임시 복사본에서 대체해 문법을 검사했습니다.
- `main` push 자동 배포를 저장소 워크플로에서 제거했습니다. 기존 수동 워크플로는 새 gate·root 작업자와 동기화되지 않으므로 새 구성에 사용하면 안 됩니다. 원격 저장소의 실행 설정은 이 변경을 반영하기 전까지 기존 상태입니다.

## 서버 정보만으로 확인 가능한 작업 — 서비스 변경 없음

1. 설치된 모든 LLM 모델 설정이 후보 파서의 리터럴 문법을 지원하고, 지정 GGUF 파일이 존재하는지 확인합니다. 설정값·키·모델 파일 경로는 출력하지 않습니다. [검사 스크립트](../deploy/model-control/check-model-configs.py)가 같은 검사를 구현하며, 서버에 파일을 아직 올리지 않았다면 아래 독립 명령을 사용할 수 있습니다.
2. 서버의 systemd 버전, root가 관리하는 `uv` 실행 파일 위치·권한, 관리 API 포트와 후보 계정의 사용 여부를 확인합니다. 이 결과에 따라 코드 준비 명령을 조정합니다.
3. client 백엔드가 같은 기기인지 다른 기기인지와 기존 접근 경로를 확인합니다. 다른 기기라면 TLS·인증된 백엔드 연결 방식이 필요합니다. 단일 사용자 인증은 현재 유지하고 ID별 격리는 별도 TODO입니다.

아래 명령들은 읽기 전용이며 서비스나 GPU를 건드리지 않습니다. **환경 파일을 `cat`하거나 키 값을 출력하지 않습니다.**

```bash
python3 --version
systemctl --version | sed -n '1p'
ss -H -ltn 'sport = :8091'
if getent passwd ai-gate >/dev/null; then id ai-gate; else echo 'ai-gate 계정 없음'; fi
for candidate in /usr/bin/uv /usr/local/bin/uv; do
  if [ -e "$candidate" ]; then
    stat -Lc '%A %U:%G %n' "$candidate"
  fi
done
```

```bash
python3 - <<'PY'
import os
import re
import stat
from pathlib import Path

files = sorted(Path('/opt/ai/config/models').glob('*.conf'))
if not files:
    print('모델 설정 없음')
for path in files:
    try:
        raw = path.read_bytes()
        assert not path.is_symlink() and len(raw) <= 16384
        assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}', path.stem)
        values = {}
        for line in raw.decode('utf-8').splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            item = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([A-Za-z0-9_+./:-]*)', line)
            assert item and item[1] not in values
            values[item[1]] = item[2]
        model_path = values.get('MODEL_PATH', '')
        assert model_path.startswith('/') and os.path.normpath(model_path) == model_path
        assert model_path.endswith('.gguf') and values.get('MODEL_NAME', path.stem) == path.stem
        info = os.stat(model_path)
        assert stat.S_ISREG(info.st_mode) and info.st_size > 0
        print(path.name + ': 정상')
    except (AssertionError, OSError, UnicodeError, ValueError):
        print(path.name + ': 확인 필요')
PY
```

## 서버 또는 Fedora 격리 환경에서만 할 수 있는 작업

- root 코드·가상환경의 실제 소유권·ACL·심볼릭 링크 및 SELinux 레이블을 확인하고, 별도 gate UID·polkit 규칙·systemd 소켓 활성화와 각 서비스의 접근을 검증합니다. 로컬 네임스페이스 시험은 실제 systemd와 Fedora SELinux가 아닙니다.
- Studio와 gate의 기존 코드를 새 코드로 함께 이전하고 이전 관리자 pause를 보존합니다. 이전·복구 중 직접 8080 접근과 다른 GPU 사용자를 차단하는 유지보수 절차를 실제 환경에서 확인합니다.
- 사용자가 직접 읽기 전용 설치 검증을 수행한 뒤, 실제 모델 목록·현재 모델·`ai-model status/list`와 API 결과를 비교합니다. 이어 사용자가 허용하는 시점에 모델 전환과 이미지 작업 경합을 시험합니다. 모델 전환·GPU 작업을 에이전트가 자동 실행하지 않습니다.
- 재시작 실패, health timeout, 강제 종료, 이전 모델 복구 실패와 gate 영구 저장 실패는 별도 Fedora 시험 환경에서 먼저 주입합니다. 운영 서비스에 실패를 임의로 주입하지 않습니다. hold·journal·이전 모델 health와 수동 복구 및 롤백을 확인합니다.
- 실제 네트워크 구성에 맞게 client 백엔드의 TLS와 관리 키 전달을 설정합니다. 사용자 ID별 권한과 데이터 격리는 [별도 TODO](./USER_ISOLATION_TODO.md)입니다.
- 백업·롤백과 정확한 서버별 설치·재시작 명령을 서버 확인 결과와 격리 시험에 맞게 확정합니다. 현재 [수동 배포 초안](./LLM_MODEL_SWITCH_DEPLOYMENT_DRAFT.md)은 준비·복구 명령 후보를 포함하며 운영 적용 지시서가 아닙니다.

## 결과

```bash
yeppyshiba@fedora:~$ python3 --version
systemctl --version | sed -n '1p'
ss -H -ltn 'sport = :8091'

if getent passwd ai-gate >/dev/null; then
  id ai-gate
else
  echo 'ai-gate 계정 없음'
fi

for candidate in /usr/bin/uv /usr/local/bin/uv; do
  if [ -e "$candidate" ]; then
    stat -Lc '%A %U:%G %n' "$candidate"
  fi
done
Python 3.14.0
systemd 258 (258-1.fc43)
ai-gate 계정 없음
-rwxr-xr-x root:root /usr/bin/uv
yeppyshiba@fedora:~$
yeppyshiba@fedora:~$ python3 - <<'PY'
import os
import re
import stat
from pathlib import Path

files = sorted(Path('/opt/ai/config/models').glob('*.conf'))
if not files:
    print('모델 설정 없음')
for path in files:
    try:
        raw = path.read_bytes()
        assert not path.is_symlink() and len(raw) <= 16384
        assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}', path.stem)
        values = {}
        for line in raw.decode('utf-8').splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            item = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([A-Za-z0-9_+./:-]*)', line)
            assert item and item[1] not in values
            values[item[1]] = item[2]
        model_path = values.get('MODEL_PATH', '')
        assert model_path.startswith('/') and os.path.normpath(model_path) == model_path
        assert model_path.endswith('.gguf') and values.get('MODEL_NAME', path.stem) == path.stem
        info = os.stat(model_path)
        assert stat.S_ISREG(info.st_mode) and info.st_size > 0
        print(path.name + ': 정상')
    except (AssertionError, OSError, UnicodeError, ValueError):
        print(path.name + ': 확인 필요')
PY
gemma4-e4b-hauhaucs.conf: 정상
gemma4-e4b-heretic-rp.conf: 정상
qwen35-35b-a3b-uncensored.conf: 정상
qwen36-35b-a3b-uncensored.conf: 정상
```