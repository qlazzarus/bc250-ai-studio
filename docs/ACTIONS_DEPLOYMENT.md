# GitHub Actions 배포

활성 workflow는 [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)이며 main push와 수동 실행을 지원한다. 서버 설치기는 [deploy-release.sh](../deploy/deploy-release.sh)다. 모델 전환 후보 workflow는 활성 Studio 배포와 별개다.

## 현재 릴리스 경로

1. Python/Node 설정, Studio 테스트·설치기 테스트·backend lint.
2. frontend npm ci·lint·build. production 환경의 `BC250_STUDIO_API_KEY`를 빌드에 전달하며 없으면 실패.
3. Git에 기록된 backend/config/pyproject/uv.lock과 frontend/dist를 패키징. 미커밋 소스는 포함하지 않음.
4. 검증된 SSH host key로 서버 설치기의 SHA-256이 저장소 후보와 같은지 확인한 뒤 업로드.
5. root 소유 `/usr/local/sbin/bc250-ai-studio-deploy`를 제한된 sudo로 실행.

패키저는 archive 시간 metadata를 고정한다. 동일 입력 파일의 패키징 재현성과 frontend 빌드 입력의 동일성은 별개다. 현재는 변경 영역과 무관하게 전체 검증·빌드·패키징·설치 경로를 사용한다.

## 설치기 동작

단일 운영자·전용 호스트를 전제로 backend와 frontend를 함께 교체한다. 비어 있지 않은 `switch.json`은 서비스 정지 전에 거절한다. 코드·설정·SQLite backup API로 만든 일관 DB 사본을 root 전용 백업에 남긴다. 생성 이미지 자산은 매 배포 백업에 포함하지 않는다.

pyproject/uv.lock 변경 때만 의존성을 동기화한다. gate가 같은 checkout/가상환경을 쓰는 경우 그 환경에서 sync하지 않고 안내한다. gate·llama·모델 worker는 배포 대상이나 재시작 대상이 아니다.

설치 후 systemd active와 비인증 요청의 401을 확인한다. 이미지 생성·LLM 품질 검증까지 수행하는 health check는 아니다. 실패하면 백업 경로를 출력하며 자동 롤백하지 않는다. 배포 중 Studio 중단과 진행 작업의 interrupted 전환이 가능하다.

## 설정과 운영 확인

production 환경에 `BC250_STUDIO_API_KEY`, `BC250_SSH_HOST`, `BC250_SSH_PORT`, `BC250_SSH_USER`, `BC250_SSH_PRIVATE_KEY`, `BC250_SSH_KNOWN_HOSTS`를 설정한다. 서버 root 설치기의 소유권·해시와 제한 sudo를 준비한다. 설치기 자체 변경은 검토한 파일로 서버와 일치시킨 뒤 릴리스를 진행한다.

배포 전 이미지 큐 유휴·전환 journal·서비스 정상 여부를 확인한다. `scripts/inspect-studio-resume.sh`는 설치와 서비스 구성을 읽는 보조 도구다. 배포 뒤 Studio 인증 요청·UI·gate/Client 상태를 확인하고 실패 시 호환되는 코드·DB·환경 백업으로 복원한다.

단일 운영자 전제를 다중 사용자·무중단 운영으로 확대하지 않는다. 변경 영역별 최적화와 추가 운영 검증은 [TODO](TODO.md)에서 관리한다.
