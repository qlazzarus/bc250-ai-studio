# 모델 전환 수동 배포 구성과 검증 초안

**아직 운영에 적용하지 않습니다.** 코드와 unit은 배포 후보입니다. 이 문서는 운영자가 직접 실행할 절차를 검토하기 위한 초안입니다. 실제 Fedora의 systemd·polkit·SELinux, gate 이전과 롤백을 검증한 뒤 최종 배포 명령으로 확정합니다. 운영 모델 전환과 GPU 작업은 자동 실행하지 않습니다.

## 구성과 권한

- `/opt/bc250-model-control`: root가 소유하는 별도 코드·가상환경. 기존 UID 1001 소유 Studio 코드를 root가 실행하지 않습니다. [코드 준비 스크립트](../deploy/model-control/prepare-code.sh)는 새 경로만 만들며 기존 경로를 덮어쓰지 않습니다.
- `bc250-model-worker.socket` → `bc250-model-worker.service`: 단일 root 작업자. 소켓 호출자는 `ai-studio` 또는 root이며 허용된 모델 목록·상태·전환·복구 요청만 처리합니다. 같은 `ai-studio` UID의 모든 로컬 프로세스가 이 제한된 소켓 기능을 호출할 수 있으므로 UID 자체가 신뢰 경계입니다.
- `bc250-model-api.service`: `ai-studio`가 실행하는 127.0.0.1:8091 HTTP API. 전용 키를 systemd credential로 받습니다. client 백엔드와 다른 호스트 사이의 TLS·접근 제한은 실제 네트워크 환경에 맞춰 별도 구성해야 합니다. 키를 브라우저에 전달하지 않습니다.
- gate는 별도 `ai-gate` 계정으로 실행하는 후보입니다. 관리자·Studio·전환 작업자 키를 분리하고 gate 상태를 `/var/lib/bc250-llm-gate`에 저장합니다. 기존 관리자 key가 바뀌므로 외부 관리자 도구도 같은 시점에 이전해야 합니다.
- `/run/bc250-gpu/gpu.lock`: Studio와 전환 작업자가 함께 사용하는 root 소유의 사전 생성 flock. 별도 `model-worker.lock`은 작업자의 생명주기 잠금입니다. `/var/lib/bc250-model-control/switch.json`은 root가 쓰고 Studio가 읽는 복구 차단 기록입니다. DB는 root만 접근합니다.
- Studio는 같은 잠금·복구 기록을 사용하고, root가 소유한 polkit 규칙은 `ai-studio`에 `llama-server.service`의 `start`·`stop`만 허용합니다. 이 권한은 해당 UID의 모든 프로세스에 적용되므로 다른 비신뢰 코드를 같은 계정에서 실행하지 않습니다.
- `MODEL_CONTROL_SWITCH_ENABLED=false`가 초기값입니다. 소켓과 HTTP를 배포하더라도 전환은 503 `switch_disabled`로 거절됩니다.

## 1. 배포 전에 확인할 조건

1. 자동 GitHub Actions 배포가 작업 도중 실행되지 않도록 사용자가 관리합니다. 코드·unit·기존 환경 설정과 데이터, gate·Studio·전환 상태를 호환되는 단위로 백업합니다. 비밀 파일 내용을 채팅에 출력하지 않습니다.
2. 이미지 작업과 모든 LLM 호출자를 유지보수 상태로 만들고 기존 gate의 진행 중 요청과 llama 슬롯을 drain합니다. Studio 복구 기록이 비어 있고 llama가 정상이어야 합니다. 기존 gate의 **유지보수 시작 전** 관리자 `paused` 값을 별도로 기록해, 새 상태 파일의 `legacy` hold에 보존합니다. 기존 gate는 프로세스 재시작 후 상태를 보존하지 않으므로 이관 중 ingress가 열리지 않도록 호출자를 차단합니다.
3. `/opt/bc250-model-control`, `/etc/bc250-model-control`, `/var/lib/bc250-model-control`, `/var/lib/bc250-llm-gate`가 새 설치 대상인지 확인합니다. 이미 있으면 초기화 명령을 실행하지 않고 기존 journal·DB·hold를 보존하며 업그레이드 절차를 별도로 수립합니다.
4. 운영 모델 설정 문법, 코드·가상환경의 전체 소유권·ACL·링크, Python 3.14 의존성, SELinux 레이블과 서비스 접근 권한을 확인합니다. `ai-model status` 설정 파일과 실제 GGUF ID의 일치도 확인합니다. ACL 또는 SELinux 레이블을 보존할 수 없는 활성 설정 교체는 현재 전환이 실패하도록 처리합니다.
5. 단일 관리자라는 현재 조건과 별도로, 비인가 사용자의 관리 API 접근 방식을 검토합니다. 사용자 ID별 격리는 [추후 작업](./USER_ISOLATION_TODO.md)입니다.

## 2. 서비스 중단 없는 사전 준비 명령 후보

다음 세 스크립트는 새 코드·비밀 설정·빈 전환 기록만 준비하고 서비스를 중지·재시작하거나 모델 전환을 실행하지 않습니다. 사용자가 검토한 릴리스 소스 디렉터리에서 실행합니다. `uv`는 root 소유 `/usr/bin/uv` 또는 `/usr/local/bin/uv`여야 합니다. 의존성 설치 시 네트워크 접근이 필요할 수 있습니다. 기존 대상이 있거나 도중 실패하면 재실행해 덮어쓰지 않습니다.

```bash
sudo ./deploy/model-control/prepare-code.sh "$PWD"
sudo python3 ./deploy/model-control/prepare-secrets.py
sudo python3 ./deploy/model-control/prepare-state.py
```

두 번째 스크립트가 새 전용 키를 만들고 값을 출력하지 않습니다. 세 번째 스크립트는 새 빈 전환 journal을 생성합니다. llama-server가 키를 요구한다면 root 전용 `/etc/bc250-model-control/llm-key`에 같은 키를 안전하게 넣어야 합니다. 현재 제공받은 설정만으로 llama API 키 필요 여부를 확정하지 않습니다. 준비 후 다음은 비밀값을 출력하지 않습니다.

```bash
sudo stat -c '%A %U:%G %n' /opt/bc250-model-control /etc/bc250-model-control
sudo find /opt/bc250-model-control ! -uid 0 -print
sudo find /opt/bc250-model-control ! -type l -perm /022 -print
getenforce
```

가상환경의 Python 및 라이브러리 심볼릭 링크와 ACL·SELinux는 위 명령만으로 검증되지 않습니다. `uv`가 실행한 빌드와 생성된 패키지 경로도 점검합니다. 불일치 시 진행하지 않습니다.

## 3. 배포 파일과 적용 순서 후보

1. `ai-gate` 시스템 계정, root 소유 `/run/bc250-gpu` 잠금 파일, root:`ai-studio` 소유 0750 전환 상태 디렉터리와 0640 빈 journal (`{}`), `ai-gate` 전용 gate 상태 디렉터리·파일을 신규 생성합니다. 잠금은 [tmpfiles 후보](../systemd/bc250-gpu-lock.conf)를 사용하고 기존 파일·복구 상태를 덮어쓰지 않습니다. 상태 파일에는 위에서 기록한 기존 관리자 pause를 반영합니다. 기존 Studio 설치 경로에도 이 릴리스의 Studio 코드가 필요합니다. root 작업자용 코드만 준비해서는 Studio가 새 잠금·hold 계약을 사용하지 않습니다.
2. 이미지가 유휴이고 이전 gate가 정상인 상태에서 [기존 gate 이전 도구](../deploy/model-control/migrate-legacy-gate.py)의 `capture`를 실행하면 기존 관리자 pause를 root 전용 기록에 먼저 저장하고 gate를 pause합니다. 응답 유실 시 기록을 보존하고 `pause`로 재시도합니다. Studio와 기존 gate가 모두 정상적으로 중지된 뒤 `create-state`로 새 gate 상태를 생성합니다. 이미 상태 디렉터리가 있으면 덮어쓰지 않습니다. 이 도구는 이전 gate의 환경 파일에서 키를 읽으며 값을 출력하지 않습니다. 기존 환경 파일의 키 문법이 지원되지 않으면 중단합니다. 운영과 유사한 환경에서 이 단계를 시험하기 전에는 명령을 실행하지 않습니다.
3. [gate drop-in](../deploy/model-control/gate.conf), [Studio drop-in](../deploy/model-control/studio.conf), [polkit 규칙](../deploy/model-control/50-bc250-studio-llm.rules), [작업자 소켓](../systemd/bc250-model-worker.socket), [작업자 서비스](../systemd/bc250-model-worker.service), [관리 API 서비스](../systemd/bc250-model-api.service)를 설치합니다. 기존 unit을 덮어쓰지 않고 drop-in 및 독립 unit을 사용합니다. systemd 설정에 따른 쓰기 경로와 SELinux 접근을 먼저 확인합니다.
4. `daemon-reload` 및 tmpfiles 적용을 수행합니다. 동일한 잠금 inode를 사용하는 새 Studio·root 작업자와 영구 상태를 사용하는 새 gate를 함께 올립니다. 구버전과 신버전 Studio, gate 또는 잠금 경로를 혼용하지 않습니다. 운영 서비스 중지·시작 및 polkit 설치 명령은 Fedora 격리 환경 검증 후 확정합니다.
5. gate 시작 시 자동으로 `startup` hold가 생깁니다. 다른 Studio·전환 hold, journal, 시스템 상태를 먼저 확인합니다. root의 `gate_admin confirm-startup`은 공통 GPU 잠금을 획득하고 작업·복구 기록, 실행 중인 Studio와 gate의 계정·실제 환경 설정·키 일치, gate hold, systemd 안정 상태, 요청 drain, 활성 GGUF ID 및 health를 확인한 뒤 `startup` hold만 해제합니다. 관리자 `legacy` 및 `admin-*` hold는 유지합니다. 환경값은 출력하지 않습니다.
6. 우선 전환이 꺼진 상태에서 모델 목록, 현재 모델, 인증 실패 및 `switch_disabled` 응답을 확인합니다. 실제 전환을 켜기 전 별도 프로세스 강제 종료·복구, systemd 및 SELinux 검증과 롤백 시험을 완료합니다. 그다음 운영자가 설정을 변경하고 사용자 본인이 검증 전환을 실행합니다.

위 2번에 대한 명령 후보입니다. `capture` 전에 Studio의 이미지 작업과 복구가 유휴이고 관리자 pause 상태가 안정적인지 확인해야 합니다. `create-state`는 Studio와 구 gate가 모두 완전히 중지된 뒤에만 성공합니다. ingress 차단과 시스템 계정 준비는 별도입니다.

```bash
sudo python3 ./deploy/model-control/migrate-legacy-gate.py capture
# capture 후 gate pause 응답을 받지 못했을 때만 재시도:
sudo python3 ./deploy/model-control/migrate-legacy-gate.py pause
# Studio와 구 gate의 중지 및 요청 drain 확인 후:
sudo python3 ./deploy/model-control/migrate-legacy-gate.py create-state
```

## 4. 복구와 롤백

- root는 다음 명령으로 미완료 작업을 조회할 수 있습니다. 값에는 모델 관리 이름과 작업 상태가 포함되며 키는 출력되지 않습니다.

  ```bash
  sudo /opt/bc250-model-control/.venv/bin/python -I -m app.services.model_control_admin pending
  ```

- 기록이 일치하고 `recovery_required`인 작업은 root의 `model_control_admin recover <작업ID>`가 기존 hold를 유지한 채 이전 모델 복구를 시도합니다. 진행 상태는 `get <작업ID>`로 확인합니다. `MODEL_CONTROL_SWITCH_ENABLED=false`이면 이 일반 복구도 꺼집니다.
- **작업 기록은 있으나 journal이 비어 있는 경우:** root가 먼저 `gate_admin hold-reconciliation`으로 별도 관리자 hold를 건 뒤 `model_control_admin resolve_verified <작업ID>`를 요청할 수 있습니다. 작업자는 공유 GPU 잠금 안에서 Studio 복구 상태, 독립 gate hold, 진행 중 요청, systemd·현재 모델 health를 검증하고 해당 작업을 `failed`/`interrupted`로 정리합니다. 이전 모델로 롤백했다고 표시하지 않습니다. 다른 Studio·전환 hold가 있거나 검증에 실패하면 그대로 `recovery_required`입니다. 확인 후 `gate_admin release-reconciliation`이 같은 안전 검사를 수행하고 이 관리자 hold만 해제합니다. `gate_admin status`로 키를 출력하지 않고 hold와 요청 수를 볼 수 있습니다.
- **journal은 있으나 작업 DB와 맞지 않아 작업자가 시작하지 못하는 경우:** gate에 `hold-reconciliation`을 건 다음 운영자가 작업자 소켓과 서비스를 중지하고 `python -I -m app.services.model_control_offline`을 root로 실행할 수 있습니다. 이 도구는 두 unit의 중지, 별도 작업자 생명주기 잠금, GPU 잠금, Studio 상태와 독립 관리자 hold를 확인하고 journal의 이전 모델을 복구·health 확인한 뒤 해당 switch hold만 해제합니다. 이후 소켓을 다시 올리고 남은 작업 DB 기록을 조회합니다. journal이 손상됐거나 다른 Studio·전환 hold가 있으면 자동으로 수정하지 않습니다. 이 절차는 격리 환경 테스트 대상이며 실제 systemd에서 검증되기 전 운영에 적용하지 않습니다.
- **journal과 Studio 복구 기록은 비었지만 고아 hold만 남은 경우:** 운영자는 `gate_admin status`로 ID를 확인하고 별도 `hold-reconciliation`을 건 뒤 `release-orphan-switch <hold-ID>` 또는 `release-orphan-studio <hold-ID>`를 실행할 수 있습니다. 도구는 공통 GPU 잠금, 독립 관리자 hold, journal, 작업 상태, Studio 복구·gate 역할, 요청 drain, 활성 모델 health를 확인한 후 지정한 단일 hold만 소유자 키로 해제합니다. 다른 고아 hold가 섞여 있거나 결과가 불확실하면 중단하며 관리자 hold는 남습니다. 이후 작업 DB가 `recovery_required`이면 위의 `resolve_verified` 절차를 실행하고, 모든 상태를 확인한 후에만 `release-reconciliation`을 실행합니다.
- 모든 복구 확인 후 gate의 시작 hold를 해제하려면 운영자가 다음 명령을 직접 실행합니다. 검증 도중 실패하면 해제를 시도하지 않습니다. 해제 요청의 응답이 유실되면 실제 hold 상태가 불확실하므로 gate 상태를 다시 조회합니다.

  ```bash
  sudo /opt/bc250-model-control/.venv/bin/python -I -m app.services.gate_admin confirm-startup
  ```

- 구버전 gate는 소유권 hold를 이해하지 못합니다. 롤백 전에 호출자를 차단하고, 실행 중인 작업을 중지·복구해 활성 모델과 health를 확인한 뒤, 백업한 코드·설정·unit·상태를 호환되는 단위로 복원해야 합니다. 구버전 gate를 먼저 시작하면 LLM 요청이 무조건 열릴 수 있습니다. 아직 실제 롤백 절차는 시험하지 않았습니다.

## 5. 아직 배포를 막는 사항

- 실제 systemd 소켓 활성화, 별도 UID·polkit, root 소유 가상환경, Python 3.14, SELinux, 기존 gate 설정 이관 및 부팅·재시작 절차가 운영과 유사한 격리 환경에서 검증되지 않았습니다.
- 기존 관리자 pause의 캡처·영구 상태 이관은 로컬 단위 테스트 대상이며 실제 이전·중단 시 재개·롤백을 시험해야 합니다. 특히 이전 gate 종료 전후에 외부 요청이 들어오지 않도록 유지보수 진입 방법을 확정해야 합니다.
- 실제 systemd 프로세스 강제 종료와 service restart 실패, health timeout, 이전 모델 복구 실패, gate 디스크 오류·재시작, Studio 이미지 복구와 모델 전환의 교차 복구를 시험해야 합니다. 작성된 프로세스 강제 종료 시험은 실제 systemd·GPU 대신 모의 서비스를 사용합니다.
- `ai-model status`·`list`와 관리 API·실제 llama 모델 ID의 성공·실패·복구 일치는 실제 서버와 같은 설정에서 검증해야 합니다. 외부 client 백엔드의 TLS 및 키 전달 경로도 확정되지 않았습니다.
- 재시작·롤백의 검증된 정확한 명령과 기존 데이터의 복원 절차는 위 시험을 반영하여 작성합니다. 현재 문서는 배포 승인이나 운영 활성화 지시가 아닙니다.
