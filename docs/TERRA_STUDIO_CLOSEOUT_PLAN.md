# Terra medium 실행 인계: AI Studio 정리 후 Client로 전환

작성: 2026-11-07. 사용자 최신 지시: **현재 에이전트는 계획만 작성하고, 실제 작업은 gpt-6.1-terra / medium에서 진행한다.** 이 문서 작성 단계에서 실행 에이전트를 시작하거나 추가 코드 수정·원격 변경을 하지 않았다.

## 목표와 종료 조건

imagegen은 AI Studio 개발·배포용으로 정리하고, llama 모델 전환 개발은 llm-client에서 이어간다. 운영 Studio/gate 서비스를 철거하거나 과거 T1~T6 연구를 재개하지 않는다.

종료 조건: 기존 작업 인계 보존, Studio와 전환 작업자 의존 분리, 운영 gate 호환성을 보존한 Studio 릴리스, 검증된 배포 경로, 실제 반영/미반영 상태의 명확한 기록, Client 다음 작업 지정. 서버 접근이 된다는 이유만으로 sudo 권한이나 배포 완료를 가정하지 않는다.

## 확인한 운영 상태 — 2026-11-07 읽기 전용 조회

- SSH 성공: `ssh -i ~/.ssh/bc250_studio_maintenance -o IdentitiesOnly=yes -p 2222 yeppyshiba@yeppyshiba.iptime.org`. 호스트 키 검증을 유지한다.
- `bc250-ai-studio.service`, `bc250-llm-gate.service`: active, 계정 ai-studio, 작업 디렉터리 `/opt/bc250-ai-studio`. 조회된 drop-in은 시스템 기본 `10-timeout-abort.conf`다.
- `bc250-model-worker.service`, `bc250-model-api.service`: not-found.
- `/opt/bc250-model-control`, `/etc/bc250-model-control`, `/var/lib/bc250-model-control`, `/var/lib/bc250-llm-gate`, `/run/bc250-gpu`: 조회 계정 기준 부재.
- 운영 `pyproject.toml`, `uv.lock`은 로컬과 SHA-256 일치.
- 운영 `backend/app/gate.py`, `core/config.py`, `core/files.py`는 **기준 커밋 f2a59f7의 해당 파일과 SHA-256 일치**, 현재 로컬과는 불일치.
- 운영 배포 스크립트 SHA-256: `9c7b93e2f7fc32c56cd2ec232065e6c212ca78b7da9136d2ffa2007e89cb5cd2`. 로컬 새 후보와 다르다.
- 일반 `sudo -n true`는 비밀번호 요구로 실패했다. 특정 배포 명령에 대한 NOPASSWD 허용 여부는 별도로 확인해야 한다. sudo 비밀번호를 채팅으로 받거나 저장하지 않는다.
- GitHub 원격 workflow 상태·실행 이력·Secrets 유효성은 이번에 확인하지 않았다.

## 이미 수행한 로컬 작업 — 다시 만들지 말 것

1. Client `docs/handoff/imagegen-20261107/`에 분리 직전 소스 455개, HEAD, tracked diff, status, 파일별 해시를 저장하고 검증했다. ignored 환경/DB/venv/node_modules는 제외했다. 이후 변경은 아직 이 스냅샷에 포함되지 않는다.
2. `services/switch_barrier.py`로 Studio의 읽기 전용 journal 계약·예외를 분리했다. gpu.py는 이 모듈을 사용한다. 기존 model_switch.py는 호환 import 및 decoder 위임을 유지한다.
3. `.github/workflows/deploy.yml`은 수동 Studio 배포 후보로 복원했다. push 트리거는 아직 없다. 서버 설치 스크립트의 해시 일치를 먼저 요구한다.
4. 모델 제어 후보 workflow를 `deploy/model-control/model-control-candidate.workflow.yml`로 옮겨 자동 탐색 경로에서 제외했다. 원본 삭제가 아니라 위치 이동이다.
5. `deploy/deploy-release.sh`에 Studio/gate 공유 파일 변경을 서비스 정지 전에 거절하는 검사를 추가했다. **현재 운영 기준으로 이 검사는 실제 배포를 거절한다. 아래 2단계 해결 전 배포하지 않는다.**
6. `scripts/test-studio.sh`, `test_studio_independence.py`, `test_studio_deploy.py`, 읽기 전용 `scripts/inspect-studio-resume.sh`를 추가했다.

검증: Studio 선택 suite 128 passed, backend Ruff 통과, frontend lint/build 통과, shell 문법 및 diff 공백 검사 통과. 전체 과거 pytest는 macOS의 GNU chmod/확장속성·Linux socket 관련 실패가 발생했고 중단 시 48 failed / 252 passed / 6 skipped였다. 전체 회귀 통과로 표현하지 않는다. 전체 Ruff는 보존된 연구 scripts/deploy의 기존 문제 3건이 있어 실패했고 Studio workflow는 backend 범위를 검사한다. 선택 suite는 전체 suite를 대체하는 증거가 아니라 **Studio 릴리스 범위**의 검사다.

## 실행 순서

### 1. 현 작업 보존과 인계 확인

- 두 저장소 git status 및 이 문서·통합 계획을 읽는다. 사용자 변경과 이번 변경이 섞여 있으며 아직 commit/push하지 않았다.
- 기존 스냅샷을 덮어쓰지 말고 현재 closeout 변경 파일/patch를 추가 보존한다. 신규 barrier와 tests/scripts/workflow도 누락 없이 인계한다.
- GitHub SSH 인증과 저장소 현재 ref·workflow를 읽기 전용 확인한다. 배포 트리거를 켜기 전에 진행 중 실행을 확인한다.

### 2. 운영 gate를 보존하는 Studio 릴리스 경계 확정

선호안은 **운영 gate의 기존 동작과 공유 런타임 파일을 유지하면서 Studio 전용 확장 의존성을 분리**하는 것이다. 현재 설치본과 일치하는 f2a59f7 파일은 선별 기준으로만 사용한다. 전체 reset/revert는 금지한다.

- gate.py 및 gate가 사용하는 core/config.py, core/files.py의 운영 기준을 보존할 수 있도록, Studio 전용 설정·잠금 확장은 별도 모듈로 추출하고 Studio import를 갱신하는 방식을 우선 검토한다.
- owned-hold gate 후보와 관련 시험은 Client 인계 자료에 보존한다. 운영 gate 복원을 이유로 관련 후보를 소실시키지 않는다. 실제 배포 대상과 후보 테스트 대상을 명확히 분리한다.
- Studio 이미지 큐·DB·이미지 모델 기능과 기존 LLM pause/drain/복구는 유지한다. 모델 전환 서비스 설치 없이 Studio가 실행돼야 한다.
- 의존 분리 비용이 커서 다른 구조가 더 적합하면 구체적인 파일 변경 목록·운영 영향·검증 기준을 먼저 갱신한다. 공유 파일 검사 삭제나 무조건 성공 반환으로 해결하지 않는다.
- 완료 조건: 설치본 gate import 경로와 의존성의 보존이 확인되고, Studio 패키지 변경으로 gate가 다음 재시작 시 뜻하지 않게 후보 모드로 바뀌지 않는다. 현재 검사와 충돌 없는 릴리스가 만들어진다.

### 3. 검증·문서의 최종 정리

- 변경된 경계에 맞춰 Studio test manifest를 검토한다. 운영 gate 호환과 복구 barrier 보호를 실제로 검사한다. 후보 시험 제외 이유를 명시하며 실패를 숨기기 위해 검사를 줄이지 않는다.
- `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh`, backend Ruff, frontend lint/build, shell 및 패키징 검사를 수행한다. 관련 없는 VM 연구를 반복하지 않는다.
- `ACTIONS_DEPLOYMENT.md`, `STUDIO_RESUME_REVIEW.md`, README에는 아직 이전 “원복 미실행/비활성” 설명이 남아 있으므로 실제 최종 상태로 갱신한다. 이 계획 문서가 현재 중간 상태의 최신 기록이다.
- 배포·복구 변경안을 리뷰할 수 있게 파일 diff와 검증 결과를 정리한다. 기존 데이터·키·모델 설정을 배포 아티팩트에 넣지 않는다.

### 4. 서버 배포 스크립트와 GitHub 반영

- 서버 배포 스크립트 내용·소유·권한·특정 sudo 허용을 확인한다. 일반 sudo가 안 된다는 사실과 특정 배포 명령 권한을 구별한다.
- root 설치가 필요하면 검증된 파일의 경로/해시와 기존 파일 백업·복구 명령을 준비한 뒤 사용자에게 서버 터미널에서 실행할 정확한 명령을 제공한다. 비밀번호는 사용자가 터미널에 직접 입력한다.
- 필요한 코드·workflow를 확인 가능한 commit으로 정리하고, 요청 범위 및 repository 규칙에 맞춰 원격 반영한다. 미추적 파일 누락과 사용자 작업의 불필요한 묶음을 피한다.
- 첫 검증은 수동 workflow로 한다. 실제 서비스 상태와 인증된 Studio 응답, 기존 gate/Client 정상 동작을 확인한다. 이미지 생성 성공 검증은 사용자 작업/실제 GPU 실행 조건을 확인한 뒤 수행한다.
- 수동 배포 성공 후 push 트리거 복원을 처리한다. 서버 원복·배포가 실패하거나 권한 확인이 끝나지 않으면 자동 배포를 켜지 않는다.

### 5. Imagegen 마무리와 Client 전환

- S0~S5를 완료/부분 완료/외부 대기로 정확히 갱신한다. 운영에 적용한 파일·백업 경로·검증 결과와 원복 방법을 남긴다.
- imagegen에서 모델 전환 기능 개발과 과거 T1~T6 실행은 종료한다. 보존 후보를 즉시 대량 삭제할 필요는 없다.
- llm-client 통합 계획에 최종 Studio/gate 계약, 인계 경로, 남은 M1/M2를 반영한다.
- 이후 기능 개발 작업 디렉터리는 `/Users/monoless/Works/bc250-llm-client`다. 실제 ai-model 원본 분석은 완료됐고 llama unit/시작 스크립트·CLI/API 공용 실행부 설계를 이어간다.

## 실행 에이전트 지정

실제 작업을 시작할 때 모델은 **gpt-6.1-terra**, reasoning effort **medium**을 사용한다. 별도 실행 세션에는 이 문서와 두 저장소 경로, Client 통합 계획 경로를 전달한다. 계획만 요청된 현재 턴에서는 Terra 실행을 시작하지 않는다.
