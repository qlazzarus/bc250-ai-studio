# AI Studio GitHub Actions 배포

2026-11-07 커밋 `434167a`의 수동 Studio 배포가 성공했고 Studio·gate·Client·llama 상태와 gate 파일 일치를 확인했다. `.github/workflows/deploy.yml`은 main push 및 수동 실행을 지원한다. 모델 전환은 별도 llm-client 작업이며 Studio 배포의 선행 조건이 아니다.

## 현재 범위와 보호

- Studio 테스트·lint·프런트엔드 빌드 후 Git에 기록된 소스와 빌드 결과를 패키징한다. **커밋되지 않은 변경은 포함되지 않는다.**
- GitHub `production` 환경의 SSH Secrets와 검증된 호스트 키를 사용하며, root 소유 서버 배포 스크립트가 저장소의 검증된 스크립트와 해시가 다르면 업로드 전에 중단한다.
- 서버에서 모델 제어 구성 경로가 감지되면 백엔드·모델 설정·의존성이 운영 파일과 동일한 경우에만 프런트엔드 정적 파일을 백업 후 교체한다. Studio와 모델 제어 서비스는 재시작하지 않는다. 백엔드 등이 다르면 조율된 배포가 필요하므로 중단한다. 같은 설치 경로를 쓰는 gate의 구현·설정·의존성 파일이 릴리스와 다르면 Studio 중지 전에 거절한다. 동일한 공유 가상환경을 쓰는 경우 `uv sync`를 건너뛰어 실행 중 gate의 패키지를 교체하지 않는다. 대신 설치된 환경의 필수 import를 사전 확인한다.
- 서버 스크립트는 Studio를 중지한 후 앱·데이터·환경 파일을 root 전용 백업에 보존하고 설치한다. 실패 시 자동 롤백하지 않는다. DB 마이그레이션이 있을 수 있으므로 코드와 데이터 백업을 같은 세대로 복원한다. gate와 llama-server는 재시작하지 않는다.
- 이 경로는 시스템 전체 gate 업그레이드나 모델 제어 이전용이 아니다. gate 파일이나 의존성을 바꿔야 하면 호환성과 별도 이전·복구 절차를 준비한다.

## 실행 전 확인

1. Studio 이미지 작업이 유휴이고 기존 gate·Client가 정상인지 확인한다. Studio 정지 시 이미지 작업은 중단될 수 있다.
2. 서버의 설치 경로와 drop-in, 모델 제어 구성 유무, 스크립트 소유권과 해시를 확인한다. `scripts/inspect-studio-resume.sh`는 해당 정보를 비밀값 없이 조회한다.
3. `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh`, `.venv/bin/ruff check backend`, 프런트엔드 `npm run lint && npm run build`, `bash -n deploy/deploy-release.sh`를 확인한다. 후보 모델 제어·VM 연구 테스트는 별도로 보존하며 이 Studio 배포 검증의 완료로 주장하지 않는다.
4. 서버 root 소유 `/usr/local/sbin/bc250-ai-studio-deploy`를 검증된 후보와 일치시켜야 한다. 기존 파일을 백업하고 해시를 검증한 뒤 운영자가 설치한다. 임의 경로 파일이나 원격 업로드물을 확인 없이 root로 실행하지 않는다.
5. GitHub 저장소의 `production` 환경에 `BC250_STUDIO_API_KEY`와 `BC250_SSH_HOST`, `BC250_SSH_PORT`, `BC250_SSH_USER`, `BC250_SSH_PRIVATE_KEY`, `BC250_SSH_KNOWN_HOSTS`가 설정되어야 한다. 저장소의 SSH 키는 Studio 배포에 한정된 서버 sudo 권한이 필요하다.

## 수동 검증과 이후 자동화

검증된 변경을 GitHub 기본 브랜치에 반영한 후 `Deploy BC-250 AI Studio`를 수동 실행한다. 배포 후 Studio 서비스 및 인증 응답, gate와 Client 상태를 확인한다. 실제 GPU 이미지 생성은 별도 사용 상황을 확인한 후 진행한다.

수동 검증의 배포 백업은 `/var/backups/bc250-ai-studio.HRzeOwTA`, 이전 서버 배포 스크립트 백업은 `/var/backups/bc250-studio-deploy.pmIRTzen`이다. 원격 반영되지 않은 로컬 파일은 운영 배포가 활성화됐다는 뜻이 아니다. 모델 제어 후보 workflow는 `deploy/model-control/model-control-candidate.workflow.yml`에 연구 자료로 보존되며 Actions 활성 경로가 아니다.

실제 서버에 오류가 있으면 Studio 재시작을 반복하기 전에 배포 출력의 백업 경로와 현재 서비스·gate 상태를 확인하고, 대응하는 코드·데이터 백업과 환경을 함께 복원한다. 미완료 모델 전환 journal이나 새 구성 경로를 임의 삭제해 보호 검사를 우회하지 않는다.
