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
