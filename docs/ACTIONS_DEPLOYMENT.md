# GitHub Actions 배포

`main` push 또는 수동 실행 시 백엔드 테스트와 프런트엔드 빌드 후 SSH로 배포합니다.
기존 `bc250-llm-client`와 같은 GitHub `production` 환경과 다음 Secrets를 사용합니다.
해당 저장소의 Secrets는 자동 공유되지 않으므로 이 저장소 또는 조직에서 설정해야 합니다.

- `BC250_SSH_HOST`, `BC250_SSH_PORT`, `BC250_SSH_USER`
- `BC250_SSH_PRIVATE_KEY`, `BC250_SSH_KNOWN_HOSTS` (서버의 검증된 host key)

서버의 기존 설치가 `/opt/bc250-ai-studio`, 데이터가 `/opt/ai-studio-data`, 서비스가
`bc250-ai-studio.service`인 경우에만 제공된 스크립트를 사용합니다. 서버에 Python 3,
`uv`, curl과 충분한 백업 공간이 필요합니다. 서버에 배포 스크립트를 root 소유로 설치하고,
배포 계정에 이 명령만 암호 없이 실행하는 sudo 권한을 부여해야 합니다. 배포 계정은
애플리케이션 코드를 root로 설치할 수 있으므로 신뢰할 수 있어야 합니다. 서버에 맞는
권한과 경로를 확인한 뒤 관리자가 다음을 수행합니다.

```sh
sudo install -o root -g root -m 0755 deploy/deploy-release.sh /usr/local/sbin/bc250-ai-studio-deploy
sudo visudo -f /etc/sudoers.d/bc250-ai-studio-deploy
```

sudoers에는 실제 계정명으로 다음 한 줄을 추가합니다.

```text
DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/bc250-ai-studio-deploy
```

스크립트는 업로드한 압축 파일을 배포 계정의 홈에서 읽습니다. 실행 중인 이미지의 경계까지
정상 종료를 기다리지만 배치 작업은 중단 상태가 될 수 있고 systemd의 `TimeoutStopSec`이
적용됩니다. 서비스 중지 후 코드, 데이터, 환경 파일 전체를 `/var/backups`에 백업하며,
새 코드 설치와 DB 마이그레이션 후 401 응답으로 서비스 및 인증 경로를 확인합니다.
환경 파일과 데이터는 덮어쓰지 않습니다. 실패 시 자동 롤백하지 않습니다. 마이그레이션이
있을 수 있으므로 백업된 코드와 데이터의 호환 쌍을 함께 복구해야 합니다. 백업 용량과
보관 주기는 운영자가 관리합니다. 기존 LLM 및 gate 서비스는 변경하지 않습니다.

이 스크립트 자체를 변경한 경우 관리자가 서버에 다시 설치해야 합니다. 실제 서버의 경로,
권한, 기존 서비스 및 Secrets를 확인하기 전까지 자동 배포 성공을 가정하지 마세요.
