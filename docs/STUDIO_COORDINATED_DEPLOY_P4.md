# P4 Studio 조율 배포: 운영 사전 점검

상태: 준비 중. 운영 배포기 아님. 2026-11-15 기준 읽기 전용 관찰이며 배포 직전 다시 확인해야 한다.

## 확인된 상황

- Studio·LLM gate·LLM Client·model worker/socket·llama 서비스가 active였다. Studio는 기존 오류 당시 재시작되지 않았다.
- 일반 Studio 배포기는 모델 제어 구성 감지 시 backend 차이를 거절한다. 실패한 릴리스와 설치된 backend는 `backend/app/api/routes.py`, `backend/app/models/schemas.py`, `backend/app/services/registry.py`, `backend/tests/test_api.py`, `backend/tests/test_prompt_composition.py`에서 차이가 있었다.
- 릴리스와 설치본의 `pyproject.toml`, `uv.lock`, `config/models.yaml`, `backend/app/services/gpu.py`, `backend/app/services/switch_barrier.py`, `backend/app/core/studio_config.py`, `backend/app/main.py`는 비교 당시 일치했다. 이것은 실제 유휴 상태, 배포 안전성, 향후 릴리스 일치를 증명하지 않는다.
- Studio는 `TimeoutStopSec=900`, `KillMode=control-group`이며 worker는 Studio와 gate 뒤에 시작하고 `TimeoutStopSec=1800`이다. gate는 별도 `/opt/bc250-llm-gate` 런타임을 사용한다. 이 설정만으로 배포 중 신규 작업 차단이나 안전한 재시작이 보장되는 것은 아니다.
- 기존 Studio 관련 검증 130건, frontend build/lint는 로컬에서 통과했다. 운영 배포·중단 복구·실제 GPU 실행의 검증은 아니다.
- SSH 계정은 `/usr/local/sbin/bc250-studio-coordinated-deploy`의 sudo 권한을 받았지만, 해당 명령은 서버에 **설치되어 있지 않다**. sudo 목록에서 해당 명령 뒤 `""`가 표시되어 인자 없는 실행으로 제한됨을 확인했다. root 소유 실행 파일이 준비·설치되기 전에는 사용할 수 없다.

## 구현 및 검증에 필요한 경계

운영 모델 전환 경로와 별도 gate는 현재 사용 중이므로, 시험용 coordinator나 항상 참을 반환하는 콜백을 운영 명령으로 취급하지 않는다. 이 저장소의 [모델 전환 배포 진행 자료](LLM_MODEL_SWITCH_DEPLOYMENT_TASKS.md)는 직접 호출자 차단, gate 보류의 소유권과 복구, 실제 배포 통합이 미완료임을 기록한다.

1. **후보 고정:** 검증된 커밋과 릴리스 해시를 고정하고, root 소유 staging에서 아카이브의 경로·링크·파일 종류를 검사한다. 운영 모델 설정과 조율 코드, 의존성 불일치는 실패로 처리한다. 업로드 파일의 해시만으로 출처가 인증되었다고 판단하지 않는다.
2. **경합 차단:** 이미지 작업 접수·실행, model worker의 신규 전환, gate의 신규 LLM 요청 및 직접 호출 경로를 배포 전체에 걸쳐 차단하고 기존 작업을 drain한다. 순간적인 유휴 조회만으로 안전을 판단하지 않는다. 중단·응답 유실 시 어떤 hold/lock이 남는지와 소유권·복구 방법을 정한다.
3. **일관 백업:** 모든 쓰기·전환이 확실히 정지한 뒤 실행 파일·설정·SQLite와 WAL 등 일관된 백업을 root 전용 경로에 보관한다. 신규 코드로 쓰인 DB를 구 코드로 재해석해야 하는 경우를 포함해 복구 호환성을 확인한다.
4. **설치와 시작:** 동일 릴리스의 backend와 frontend를 함께 교체한다. gate·worker의 공유 파일과 가상환경을 임의 수정하지 않는다. 서비스 정지·시작과 장애 중단 순서를 저널에 기록한다.
5. **확인과 해제:** Studio 인증·health와 P4 capability, gate/Client 및 worker 상태를 검증한다. 배포자가 소유한 hold만 확인 후 해제하며 불명확하면 자동 해제하지 않고 차단·복구한다. 고장 시 백업 복구와 결과 재검증을 수행한다.
6. **권한·검증:** root 소유이면서 쓰기 불가인 명령과 경로, 인자 거부, 아카이브 공격, 예외·프로세스 종료·재시작·경합·롤백 실패를 별도 Linux VM에서 검증한 뒤 운영 설치한다. 운영 중인 Studio·LLM의 실제 사용 상황을 확인하고 적용한다.

위는 요구사항이며 현재 구현·검증된 절차가 아니다. 스크립트가 준비되기 전 sudo 권한만으로 안전한 조율 배포가 가능하다고 주장하지 않는다.

## 준비 진행 기록

- `deploy/model-control/audit-p4-release.py`에 릴리스 해시와 허용된 P4 코드 차이 및 설정 파일 일치를 비교하는 **읽기 전용 시험 후보**를 추가했다. 아카이브 링크·중복·크기 제한과 예상 밖 GPU/설정 변경 거절을 단위 시험했다. 이 함수는 root 진입점이 아니며 출처 인증, TOCTOU 방지, 운영 안전 승인 또는 배포를 수행하지 않는다.
- 기존 조율 후보의 로컬 단위 시험 17건(추가 subtest 3건)과 새 검사 후보 3건·Ruff가 통과했다. 실제 gate/worker/Studio 통합이나 중단 후 복구는 이 결과로 입증되지 않는다.
- 운영 서버에서 QEMU 실행 파일과 과거 Fedora 시험 VM 자료의 존재를 확인했다. VM 상태·기동 가능성·격리성은 아직 검증하지 않았다. 운영 서비스나 sudo 규칙은 변경하지 않았다.

## Client 저장소 확인 (2026-11-15)

- 오류 문자열과 판정은 이 저장소의 `deploy/deploy-release.sh`에서 발생한다. `/Users/monoless/Works/bc250-llm-client`의 `deploy/deploy-release.sh`는 Client 배포용이며 이 Studio 검사를 수행하지 않는다.
- Client의 `backend/app/model_control/origin_deployment_barrier.py`는 별도의 origin 변경 보호 구성요소다. gate 보류의 지속적 일관성이 보장되지 않아 `origin_deployment_guard()`가 명시적으로 실패하도록 되어 있고, 해당 진단만으로 배포를 승인하지 않는다. 이를 이 Studio 배포 검사와 동일하다고 가정하거나 무조건 통과하도록 바꾸지 않는다.
- Client 모델 전환 worker는 Studio와 같은 GPU 락·gate hold·journal 계약을 사용한다. 따라서 Studio 배포 중 worker와 Studio의 실행 경합과 복구를 별도로 해결해야 한다. Client 저장소의 관련 barrier 테스트는 로컬 32건 통과했다. 이는 실제 운영 배포 검증이 아니다.
- P4 사전 비교 시험은 `backend/app` 밖의 Alembic 등 backend 변경도 허용 목록 밖이면 거절하도록 수정했고 관련 후보 시험 20건(추가 subtest 3건)이 통과했다. 여전히 읽기 전용 시험이며 배포 허용 조건이 아니다.
- 사용자가 제공한 GitHub Actions job 링크는 이 환경에서 열리지 않았고 `gh` CLI도 없으므로 해당 실행 로그는 직접 확인하지 못했다. 앞서 SSH에서 확인한 배포 오류 문자열과 업로드 아티팩트 기준의 분석이다.

## 남은 구현 작업과 완료 기준

1. **T1 입력·릴리스 고정:** Actions 아티팩트와 커밋을 식별하고, root가 신뢰하는 방식으로 받은 해시·파일 목록을 검증한다. 아카이브를 root로 추출하기 전에 경로 이탈, 링크, 중복, 크기를 거절한다. 기존 읽기 전용 비교 후보는 시작점이며 출처 인증·경합 차단·안전한 압축 해제 구현이 필요하다.
2. **T2 지속적인 작업 차단:** Studio 신규 작업, worker socket 활성화·요청, gate 신규 요청 및 직접 호출자의 차단 경계를 설치한다. 진행 중 작업은 안전한 경계까지 기다린다. 실행 중 switch의 journal/operation이 해결되지 않거나 종료 상태를 확정할 수 없으면 설치 전에 중단한다. 단일 유휴 조회나 worker SIGTERM만으로 drain 성공으로 취급하지 않는다.
3. **T3 백업·교체·복구:** 차단을 유지한 상태에서 Studio DB의 일관된 백업과 현재 코드·설정을 보존한다. 모델 설정·공유 조율 경계·의존성은 검증된 범위만 허용한다. 이미지 작업 재시도 및 기존 P4 metadata의 구 버전 호환성을 점검한다. 정지·교체·재기동 중 실패 또는 프로세스 종료 시 기록을 남기고 자동 hold 해제 없이 복구할 수 있어야 한다.
4. **T4 Linux 격리 시험:** 정상 배포 외에도 작업 중단·동시 switch·신규 요청·비정상 아카이브·이전 릴리스·백업 실패·SIGKILL·서비스 시작 실패·롤백 실패를 시험한다. 실제 gate·Studio·worker 및 SQLite를 사용하고 GPU는 별도 시험 범위로 명시한다. root 명령의 인자·소유권·권한도 확인한다.
5. **T5 설치·운영 적용:** 검토한 root 소유 명령과 해시를 관리자가 설치하고 sudo 범위를 재확인한다. 검증된 Actions 경로를 연결한 후 실제 서비스 상태와 인증된 P4 capability 및 테스트 job 이력을 확인한다. 서버가 운영 중인 모델 설정·버전이 시험 전제와 다르면 중단한다.

현재 T1의 일부 읽기 전용 감사 함수와 단위 테스트만 작성했다. T2~T5는 미완료이고, 특히 Client 측 `origin_deployment_guard`는 gate 일관성 보장이 없어 fail-closed 상태다. 이를 단순히 제거하거나 `true`로 바꾸지 않는다. 관리자 권한으로 수행하는 일회성 유휴 조회는 진단 자료일 뿐 T2의 지속 차단이나 배포 허가가 아니다.

## 2026-11-15 운영 진단과 종료 경로

- 관리자가 읽은 순간 상태는 switch journal `clear`, 작업 `failed: 1`, `succeeded: 13`이었다. 이후 상태 변경 가능성이 있으므로 이것은 지속적인 차단이나 배포 직전 유휴 증거가 아니다.
- Client worker의 `runtime.py`, `bridge.py`, `worker.py`는 로컬 Client 저장소와 서버 설치본의 SHA-256이 각각 일치했다. 코드상 SIGTERM은 리스너를 닫고 bridge의 추적된 작업을 기다리며 worker의 `close()`는 `inflight`가 남아 있으면 실패한다. 접속·요청과 종료 경계, systemd 30분 timeout, 응답 유실 및 강제 종료 후 journal 상태는 별도 통합 시험이 필요하다. Studio scheduler의 정상 종료는 현재 이미지 경계까지 기다리고 LLM 복구를 시도하며 systemd timeout은 15분이다.
- 로컬 Client worker 관련 테스트 81건 통과·1건 건너뜀, Studio 관련 테스트 130건 통과. 이것은 실제 systemd, socket activation, 운영 중인 GPU·gate 간 지속 차단 검증이 아니다.
- 운영 서버에는 QEMU와 Fedora 원본 이미지가 있으나 `/dev/kvm` 접근은 확인되지 않았고, 조사 시 `MemAvailable`은 약 3.3 GiB였다. 기존 격리 VM 후보는 TCG 및 1.5 GiB를 사용하므로 이미지를 중복 생성하거나 VM을 기동하기 전에 운영 LLM의 메모리 여유와 다른 사용자 작업을 고려해야 한다. VM은 아직 기동하지 않았다.

## GitHub Actions 실패 원인 확정 (2026-11-15)

- 실행 `43662091366`(`86a0d46`)과 `43663332156`(`8c9159c`)은 `Test backend`(130건 통과)·`Check and build frontend`·`Package release`·`Configure SSH`가 모두 성공하고 `Deploy and check service`만 12~14초 만에 exit 1로 실패했다. 같은 커밋에서 `scripts/test-studio.sh`, `scripts/test_studio_static_deploy.py`, `ruff check backend`를 로컬로 재실행해 모두 통과함을 확인했다. 즉 실패는 테스트나 빌드가 아니라 원격 실행 단계다.
- 서버 `/usr/local/sbin/bc250-ai-studio-deploy`의 SHA-256은 저장소 `deploy/deploy-release.sh`(`8fa3c384…e911`)와 일치한다. 따라서 워크플로의 업로드 전 해시 비교는 통과하며 실패 지점이 아니다.
- 서버에 `/opt/bc250-model-control`, `/etc/bc250-model-control`, `/var/lib/bc250-model-control`, `/var/lib/bc250-llm-gate`, `/run/bc250-gpu`가 모두 존재하고 네 서비스(Studio·gate·worker·socket)가 active다. 그래서 `deploy-release.sh`의 `model_control=true`가 되고 정적 전용 분기로 들어간다.
- 그 분기의 `pyproject.toml`, `uv.lock`, `config/models.yaml` 비교는 세 항목 모두 일치했다. backend 비교에서만 차이가 나 `Model-control is active and backend changed; coordinated backend deployment required.`로 exit 1 한다. 서버 설치본과 릴리스 아티팩트를 파일별 해시로 대조한 실제 차이는 `backend/app/api/routes.py`, `backend/app/models/schemas.py`, `backend/app/services/registry.py`, `backend/tests/test_api.py` 변경과 `backend/tests/test_prompt_composition.py` 신규뿐이었다. 서버에만 있는 파일은 없었고(egg-info·pycache 흔적 없음), 허용 목록 밖 변경이나 설정 불일치는 없었다.
- 설치된 backend는 마지막 성공 배포(`43348227137`, `cd1bc4b`)와 파일 목록·내용 해시가 완전히 동일했다. 서버 `routes.py`의 mtime이 11-09 20:12인 것도 이와 일치한다. 즉 릴리스가 앞선 것은 `86a0d46`의 P4 변경 때문이고, 그 외 드리프트는 없다.
- 같은 조건을 로컬에서 재현했다. 설치본을 `cd1bc4b` 트리로 두고 저장소 스크립트의 해당 분기를 그대로 실행하면 동일 문자열로 exit 1 한다. 그러므로 이 실패는 회귀가 아니라 의도된 보호이며, 정적 전용 경로가 backend 변경을 조용히 버리지 않도록 막은 결과다. `Test backend` 실패로 끝난 `7db18d6`·`8633955` 실행과는 다른 원인이고, 그 두 건은 `cd1bc4b`에서 해소됐다.
- 워크플로는 `sudo -n /usr/local/sbin/bc250-ai-studio-deploy`만 호출한다. 조율 배포 후보 `deploy/bc250-studio-coordinated-deploy.sh`는 아직 커밋되지 않았고 서버에도 설치되어 있지 않다. `sudo -l`에는 `(root) NOPASSWD: /usr/local/sbin/bc250-studio-coordinated-deploy ""` 규칙만 있고 파일은 없다. 따라서 현재 Actions 경로로는 backend가 바뀐 이 릴리스를 배포할 수단이 없다.
- 후보 스크립트의 허용 목록 검사는 설치본과 `8c9159c` 스테이지를 비교할 때 3개 파일만 다르므로 통과한다. 그러나 그 스크립트가 고정한 `expected` 해시(`9a603d22…a52c7`)는 지금 서버 홈에 남은 업로드 아카이브에만 맞는다. 동일 트리를 다시 `tar -czf`하면 gzip 헤더 시각 때문에 해시가 달라지는 것을 로컬 2회 생성으로 확인했으므로, 이후 실행의 아티팩트는 이 고정값과 맞지 않는다. 해시 고정 방식 자체를 재검토해야 한다.
- 운영 프런트엔드는 11-13 빌드 그대로이며 P4 프롬프트 UI는 아직 배포되지 않았다. 새 프런트엔드는 `/system/capabilities`에 `prompt_composition`이 없으면 경고만 표시하고 `body.prompt_composition`을 보내지 않도록 되어 있어 구 backend와 공존 가능하다. 따라서 지금 막고 있는 것은 코드 호환이 아니라 위 배포 경계다.
- 정리: 차단 원인은 ① 모델 제어가 활성인 서버에 backend가 바뀐 릴리스를 정적 전용 배포기로 보낸 것, ② 조율 배포기가 미설치이고 워크플로에 연결되지 않은 것, ③ 아카이브 해시 고정이 재현 불가능한 것이다. T2~T5 완료 전에는 검사를 우회하거나 정적 분기를 넓혀 통과시키지 않는다.

## 결정: 단일 운영자 고속 경로로 전환 (2026-11-15)

이 호스트는 한 사람이 Studio와 LLM client만 운영하는 개인 시스템이다. 무중단·다중 사용자 조율을 요구하지 않으므로, T2~T5의 지속 차단·백업·복구 체계를 먼저 완성하는 대신 **같은 릴리스의 backend와 frontend를 한 번에 교체**하는 고속 경로를 택했다. P4 문서의 T1~T5는 폐기하지 않고 다중 사용자·무중단이 필요해질 때의 후보로 보존한다.

- `deploy/deploy-release.sh`에서 `model_control` 감지와 정적 전용 분기를 제거했다. backend·frontend·설정·의존성을 한 주기로 교체하므로 `coordinated backend deployment required` 거절이 발생하지 않는다.
- 남긴 검사는 복구 불가능한 실패만 막는다. `switch.json`이 비어 있지 않으면 서비스 정지 전에 중단하고, 교체 전 코드·설정·DB 일관 스냅샷을 root 전용 백업에 남기고, 교체 후 서비스 active와 인증 401을 확인한다.
- `uv sync`는 `pyproject.toml`/`uv.lock`이 실제로 바뀐 경우에만 수행한다. 코드만 바뀐 릴리스는 의존성 동기화를 건너뛴다. gate가 같은 가상환경을 공유하면 그 환경에서 sync하지 않는다.
- 모델 worker·gate·llama는 배포 대상이 아니며 재시작하지 않는다. journal이 비어 있으므로 전환 중 경합을 새로 만들지 않는다.
- `scripts/package-release.py`로 아카이브 바이트를 고정했다. gzip 헤더와 mtime을 정규화해 같은 커밋이 항상 같은 해시가 되므로, 해시 고정 검사를 실제로 쓸 수 있다. 로컬 2회 생성이 동일 해시임을 시험으로 확인했다.
- 의도적으로 받아들이는 손실: 배포 중 수 초의 Studio 중단, 중단 시점 이미지 작업의 `interrupted` 처리, 실패 시 자동 롤백 없음. 이는 단일 운영자·개인 사용 전제에서만 허용한다.
- 검증: `scripts/test_studio_static_deploy.py` 12건, `backend/tests/test_studio_deploy.py` 포함 Studio 129건, ruff, frontend lint/build 통과. 실제 배포 흐름은 systemd·curl·uv를 대체한 샌드박스에서 종단 재현해 backend+frontend 동시 교체, DB 백업 내용, 미완료 journal 시 정지 전 중단, lock 변경 시에만 sync를 확인했다. 운영 서비스는 아직 변경하지 않았다.
