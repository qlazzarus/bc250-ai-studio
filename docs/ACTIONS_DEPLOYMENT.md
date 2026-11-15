# AI Studio GitHub Actions 배포

2026-11-07 커밋 `434167a`의 수동 Studio 배포가 성공했고 Studio·gate·Client·llama 상태와 gate 파일 일치를 확인했다. `.github/workflows/deploy.yml`은 main push 및 수동 실행을 지원한다. 모델 전환은 별도 llm-client 작업이며 Studio 배포의 선행 조건이 아니다.

변경 영역별 배포 시간 개선 가능성과 안전 조건은 [최적화 검토](ACTIONS_DEPLOY_OPTIMIZATION.md)에 정리했다. 현재 workflow와 서버 설치기는 여전히 전체 릴리스 경로다.

## 현재 범위와 보호

- Studio 테스트·lint·프런트엔드 빌드 후 Git에 기록된 소스와 빌드 결과를 패키징한다. **커밋되지 않은 변경은 포함되지 않는다.**
- 아카이브는 `scripts/package-release.py`로 만든다. gzip 헤더 시각과 파일 mtime을 고정하므로 같은 커밋은 항상 같은 바이트가 되고, 해시를 고정해 비교할 수 있다.
- GitHub `production` 환경의 SSH Secrets와 검증된 호스트 키를 사용하며, root 소유 서버 배포 스크립트가 저장소의 검증된 스크립트와 해시가 다르면 업로드 전에 중단한다.
- 단일 운영자·전용 호스트 전제로, 모델 제어가 활성인 서버에서도 **backend와 frontend를 함께 교체**한다. 정적 전용 분기와 "coordinated backend deployment required" 거절은 제거했다. `backend`, `config/models.yaml`, `frontend/dist`, `pyproject.toml`, `uv.lock`을 한 번에 바꾼다.
- 남겨 둔 안전장치는 복구 불가능한 상황을 막는 것뿐이다. ① `switch.json`이 비어 있지 않으면(미완료 모델 전환) 서비스 정지 전에 중단한다. ② 교체 전 코드·설정·Studio DB의 일관 스냅샷을 root 전용 백업에 남긴다. ③ 교체 후 `systemctl is-active`와 인증 응답 401을 확인하고, 실패하면 백업 경로를 출력한다.
- `pyproject.toml`/`uv.lock`이 바뀐 경우에만 `uv sync`를 실행한다. 코드만 바뀐 릴리스는 의존성 동기화 없이 수 초 안에 끝난다. gate가 같은 체크아웃·가상환경을 쓰면 그 환경 아래에서 sync하지 않고 경고만 남긴다.
- 백업은 코드·설정·DB(`sqlite3` backup API)만 담는다. 생성된 이미지 자산은 append-only 사용자 콘텐츠라 매 배포마다 복사하지 않는다.
- 배포는 여전히 gate와 llama-server를 재시작하지 않는다. 모델 worker도 건드리지 않는다. journal이 비어 있으므로 진행 중 전환이 없고, 남아 있는 퇴역 상태만 재기동되면 된다는 전제다.
- 이 경로는 시스템 전체 gate 업그레이드나 모델 제어 이전용이 아니다. gate 파일이나 의존성을 바꿔야 하면 호환성과 별도 이전·복구 절차를 준비한다.

## 실행 전 확인

1. Studio 이미지 작업이 유휴이고 기존 gate·Client가 정상인지 확인한다. Studio 정지 시 이미지 작업은 중단될 수 있다.
2. 서버의 설치 경로와 drop-in, 모델 제어 구성 유무, 스크립트 소유권과 해시를 확인한다. `scripts/inspect-studio-resume.sh`는 해당 정보를 비밀값 없이 조회한다.
3. `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh`, `.venv/bin/ruff check backend`, 프런트엔드 `npm run lint && npm run build`, `bash -n deploy/deploy-release.sh`, `pytest -q scripts/test_studio_static_deploy.py`를 확인한다. 후보 모델 제어·VM 연구 테스트는 별도로 보존하며 이 Studio 배포 검증의 완료로 주장하지 않는다.
4. 서버 root 소유 `/usr/local/sbin/bc250-ai-studio-deploy`를 검증된 후보와 일치시켜야 한다. 기존 파일을 백업하고 해시를 검증한 뒤 운영자가 설치한다. 임의 경로 파일이나 원격 업로드물을 확인 없이 root로 실행하지 않는다.
5. GitHub 저장소의 `production` 환경에 `BC250_STUDIO_API_KEY`와 `BC250_SSH_HOST`, `BC250_SSH_PORT`, `BC250_SSH_USER`, `BC250_SSH_PRIVATE_KEY`, `BC250_SSH_KNOWN_HOSTS`가 설정되어야 한다. 저장소의 SSH 키는 Studio 배포에 한정된 서버 sudo 권한이 필요하다.

## 수동 검증과 이후 자동화

검증된 변경을 GitHub 기본 브랜치에 반영한 후 `Deploy BC-250 AI Studio`를 수동 실행한다. 배포 후 Studio 서비스 및 인증 응답, gate와 Client 상태를 확인한다. 실제 GPU 이미지 생성은 별도 사용 상황을 확인한 후 진행한다.

수동 검증의 배포 백업은 `/var/backups/bc250-ai-studio.HRzeOwTA`, 이전 서버 배포 스크립트 백업은 `/var/backups/bc250-studio-deploy.pmIRTzen`이다. 원격 반영되지 않은 로컬 파일은 운영 배포가 활성화됐다는 뜻이 아니다. 모델 제어 후보 workflow는 `deploy/model-control/model-control-candidate.workflow.yml`에 연구 자료로 보존되며 Actions 활성 경로가 아니다.

실제 서버에 오류가 있으면 Studio 재시작을 반복하기 전에 배포 출력의 백업 경로와 현재 서비스·gate 상태를 확인하고, 대응하는 코드·데이터 백업과 환경을 함께 복원한다. 미완료 모델 전환 journal을 임의로 삭제해 검사를 우회하지 않는다.

## 단일 운영자 전제 (2026-11-15)

이 호스트는 한 사람이 Studio와 LLM client만 운영한다. 그 전제로 아래를 **의도적으로** 받아들인다.

- 배포 중 수 초의 Studio 중단. 정지 시점에 실행 중이던 이미지 작업은 `interrupted`로 남을 수 있다.
- 모델 전환이 진행 중이 아닐 때만 배포한다. 실행 중 전환은 journal 검사로 거절한다.
- 배포 실패 시 자동 롤백하지 않는다. 백업 경로를 남기고 수동 복구한다.
- 모델 제어 worker와 gate/llama는 배포 대상이 아니며 재시작하지 않는다.

이 완화는 다중 사용자·무중단 요구에는 적합하지 않다. 그 경우 `deploy/model-control/*`의 지속 차단·백업·복구 후보를 검증해 별도 경로로 사용한다.
