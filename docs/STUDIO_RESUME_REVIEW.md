# AI Studio 개발·배포 재개 및 LLM 작업 분리 검토

기준: 2026-11-07. 아래 검토 이후 로컬 Studio 의존 분리와 수동 배포 후보를 준비했다. 운영 서버에서는 Studio/gate 실행 중, 모델 제어 서비스 미설치를 읽기 전용으로 확인했다. **서버 원복·배포는 아직 실행하지 않았다.** 현재 상세 진행 상황은 [Terra 작업 인계](TERRA_STUDIO_CLOSEOUT_PLAN.md)를 참고한다.

## 결론과 소유권

사용자 목표는 imagegen에서 AI Studio 작업을 계속하고, 모델 전환 UI/API·실행부 개발은 llm-client에서 이어가는 것이다. 이 방향으로 분리한다. 여기서 종료하는 것은 **imagegen의 모델 전환 개발/VM 시험 작업 흐름**이며, AI Studio 또는 gate 운영 서비스가 아니다.

Client의 후속 설계·구현은 시작할 수 있다. 그러나 문서 인계만으로 imagegen 정리와 기존 배포 복구가 완료되지는 않았다. imagegen에서는 아래 S0~S5를 한정된 마무리 작업으로 수행하고, 모델 전환 기능 개발은 재개하지 않는다.

## 확인된 배포 차단과 결합

| 위치 | 확인 사실 | 의미 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | push 트리거 제거. workflow_dispatch 후 항상 exit 1 | 현재 로컬 정의로 Studio 배포 불가. 단순 문서 정리로 복구되지 않음 |
| `deploy/deploy-release.sh` | model-control 설치·상태·unit·공유 잠금 경로 감지 시 Studio 정지 전 거절 | 호환되지 않는 부분 배포를 막는 조건부 검사. 모든 서버에서 무조건 차단하는 것은 아님 |
| 과거 서버 변경 기록 | 검사 추가 스크립트를 서버에 설치했고 이전 파일을 `/var/backups/bc250-ai-studio-deploy.oc2Mslhn`에 보존했다고 기록 | 서버 스크립트도 확인해야 함. 현재 파일과 백업의 존재/내용은 미확인 |
| `backend/app/services/gpu.py` | `model_switch`의 StudioSwitchBarrier와 예외를 모듈 로드 시 import | model_switch 파일만 옮기거나 삭제하면 옵션이 꺼져 있어도 Studio 시작 실패 가능 |
| `systemd/bc250-llm-gate.service` | Studio 설치 디렉터리와 `.venv` 사용 | Studio 코드/의존성 교체가 gate의 다음 재시작에 영향을 줄 수 있음. 실제 운영 unit 확인 필요 |
| 기존 배포 스크립트 | backend 전체와 `.venv`를 갱신하고 Studio만 재시작 | gate를 직접 restart하지 않는다는 사실만으로 gate 무영향을 보장하지 않음 |
| `.github/workflows/model-control-candidate.yml` | 수동 후보 패키지 빌드, 운영 배포 없음 | Studio 정규 배포와 별개. Client 인계 후 imagegen 활성 작업에서 분리 |
| 현재 작업 트리 | 후보 코드·문서·미추적 시험 파일 존재 | HEAD만 archive하거나 reset하면 인계 대상이 누락/소실될 수 있음 |

Git의 `f2a59f7` 시점에 기존 Studio workflow와 배포 스크립트가 있다. **복구 참고본이지 전체 저장소 원복 대상 커밋은 아니다.** 이후 이미지 기능 수정·복구 개선과 전환 후보가 섞여 있으므로 일괄 revert/reset은 하지 않는다.

## 권장하는 원복의 범위

목표는 과거 파일과 완전히 똑같아지는 것이 아니라 **Studio가 독립적으로 개발·검증·배포되는 상태**다.

- 유지: 이미지 생성 API/UI/큐·DB·모델 옵션, 이미지 사용 전 LLM pause/drain/정지/복구, 필요한 GPU 잠금 및 기존 오류 수정.
- Client로 인계: 모델 전환 API·작업자·CLI 공용 제어·전환 상태 저장·관련 시험과 설계.
- 의존 분리: Studio가 쓰는 복구 barrier/예외 등은 작고 명확한 Studio 쪽 공용 계약 모듈로 남기거나 기존 호환 경로로 정리한다. 원본 전환 모듈의 import가 남은 상태에서 삭제하지 않는다.
- 보존 후 활성 경로 제외: 통합 배포 조율기, DB/nft fence·유지보수 VM·후보 출처 시험. 기록과 미커밋 소스는 인계 자료로 남기고 매번 Studio 배포를 위해 실행할 요구로 두지 않는다.
- 배포 복구: 검증된 Studio workflow를 재구성한다. 첫 단계는 수동 배포로 확인하고 push 자동 배포는 그 후 복원한다. 기존 서버 조건부 검사는 실제 신규 구성 사용 여부를 확인하기 전 제거하지 않는다.

### 서버 상태에 따른 분기

1. **모델 전환 구성이 운영에 설치/활성화되지 않은 경우:** 현재 Studio/gate 설정·키·잠금 경로를 유지하는 호환 릴리스를 만든다. 기존 배포 검사를 유지해도 새 구성 경로가 없으면 통과할 수 있다. 서버 스크립트의 원복이 실제로 필요한지 파일 비교로 판단한다.
2. **신규 unit/drop-in·owned hold·journal이 운영에 적용된 경우:** 사용 중인 계약을 확인하고 유지하거나 제한된 이관/복구 절차를 만든다. 경로/상태 파일을 지워서 검사를 우회하거나 이전 gate로 바로 내리지 않는다.
3. **시험 VM에만 적용된 경우:** 운영 서비스와 별개로 시험 PID·디스크·unit·계정을 식별한다. 필요하면 VM을 종료하고 보관하지만, 확인 없이 QEMU 전체 종료/시험 디렉터리 일괄 삭제를 하지 않는다. 이번 검토에는 실행 중 VM 현황이 없다.

## 종료까지의 작업 목록

| 작업 | 상태 | 완료 조건 |
| --- | --- | --- |
| S0 인계 보존 | 완료: 원본 및 분리 후 스냅샷 검증 | tracked diff와 미추적 파일을 포함한 재현 가능한 스냅샷·파일 목록·기준 커밋 기록. 비밀/env/운영 데이터는 코드 자료에 넣지 않음 |
| S1 현재 배포 상태 확인 | 서버 조회 및 원격 main 확인, GitHub 실행 이력 미확인 | GitHub workflow/진행 중 배포, 서버 배포 스크립트, 실제 unit/drop-in, 신규 구성 사용 여부를 읽기 전용 확인 |
| S2 Studio 코드 경계 분리 | 로컬 구현 및 검증 완료 | 필요한 barrier/잠금/복구 기능 보존. Client 인계 후에도 Studio 시작·이미지 동작이 전환 실행부 설치 없이 가능 |
| S3 Studio 배포 후보 복구 | 로컬 후보 검증 및 서버 스크립트 설치 완료 | 실제 운영 구성에 맞는 아티팩트와 수동 workflow·서버 스크립트 변경안. gate 공유 코드/venv 영향 및 복구 절차 포함 |
| S4 필요한 검증·원격 반영 | 수동 배포 성공, 자동 push 트리거 복원 중 | Studio 관련 backend 테스트·frontend lint/build, 패키지/배포 검사 및 필요한 gate 호환 확인. 최종 검증된 workflow 반영 후 수동 배포 확인, 자동 트리거 복원 |
| S5 마무리 | Client 인계 보존, 운영 확인 대기 | Client 인계 경로 확보, 중복 작업자 설치 없음, 불필요한 후보 workflow/시험 작업의 활성 경로 제외, Studio 배포 가이드와 README 갱신 |

Client M1/M2 설계는 S 작업 전체 완료를 기다릴 필요가 없다. 실제 코드 이관 시 S0 보존과 S2 의존 분리를 함께 확인한다. Studio를 계속 쓸 수 있게 마무리하는 S 작업은 과거 T1~T6 통합 배포 연구의 재개가 아니다.

현 시점 판정: **작업 책임 분리 가능 / Client 설계 계속 가능 / Studio 개발 계속 가능 / Studio 배포 재개는 아직 준비 필요**. 이번에는 workflow·스크립트·운영 상태를 바꾸지 않았다.

## 로컬 작업 진행 기록

- `switch_barrier.py`와 Studio 전용 설정·파일 모듈을 분리했다. 운영 gate.py와 그 설정·파일 모듈은 서버의 기존 파일과 정확히 일치한다. 후보 gate는 `gate_candidate.py` 및 인계 스냅샷에 보존한다.
- 수동 배포 workflow와 기존 서버 호환 확인·공유 가상환경 보존 검사를 준비했다. 운영 서버의 root 소유 스크립트는 아직 교체하지 않았고 GitHub workflow도 아직 반영되지 않았다.
- 최종 검증과 서버 설치·수동 배포 확인 전까지 자동 push 배포는 비활성으로 유지한다.

- 2026-11-07 진행: 운영 서버에서 Studio/gate active, 모델 제어 unit/경로 없음, 배포 명령의 제한된 sudo 권한을 확인했다. 공유 gate 파일은 기준 커밋과 일치하며 로컬 릴리스도 동일하다. 공유 환경의 필수 모듈 import가 서버에서 성공했다.
- Studio 검증은 129개 통과, backend Ruff, frontend lint/build 및 shell 문법 검사 통과. macOS에서 Linux 전용 후보의 전체 회귀가 실패했으며 최종 전체 통과는 주장하지 않는다.
- 서버 사용자 홈에 SHA-256 `971b58e56b2385fb5e10873ebc3369e2e3cf6d9a47e10f22aa75f9bee51852d7`인 배포 스크립트 후보를 전달하고 확인했다. root 설치를 운영자가 완료했고 해시·root:root 0755를 확인했다. 이전 파일은 `/var/backups/bc250-studio-deploy.pmIRTzen`에 보존했다. 새 릴리스나 서비스를 아직 실행하지 않았다.
- Client `docs/handoff/imagegen-20261107`과 `imagegen-closeout-20261107`에 변경 전 및 분리 후 스냅샷을 검증해 보존했다. GitHub 현재 main은 `7e595b1`이며 변경은 아직 반영하지 않았다.

- 2026-11-07 운영 검증: GitHub Actions 실행 `42335504458`에서 커밋 `434167a`의 수동 배포가 성공했다. Studio/gate/Client/llama active, Studio 인증 401·Client health 200·gate health 200 및 기존 gate 파일 해시를 확인했다. 배포 백업 `/var/backups/bc250-ai-studio.HRzeOwTA`. 실제 이미지 생성은 실행하지 않았다.
