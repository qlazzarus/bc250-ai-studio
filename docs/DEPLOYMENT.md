# 설치와 운영

현재 Studio는 단일 Uvicorn worker, loopback API, 별도 데이터 디렉터리로 실행한다. 기본 소스 설정은 fake/manual이며 [서버 환경 템플릿](../deploy/studio.env.example)은 초기 테스트를 위한 fake/image_priority다. 실제 호스트 상태는 적용 전에 확인한다.

## 파일과 설정

| 항목 | 기본 또는 서버 예시 |
| --- | --- |
| 코드·가상환경 | `/opt/bc250-ai-studio`, root 소유 |
| 서비스 계정·데이터 | `ai-studio`, `/opt/ai-studio-data` |
| 환경 파일 | `/etc/bc250-ai-studio.env`, root 0600 |
| unit | [bc250-ai-studio.service](../systemd/bc250-ai-studio.service) |
| API | `127.0.0.1:8090`, worker 1 |
| gate / llama | 기본 loopback 8081 / 8080 |
| 웹 | Caddy 정적 `frontend/dist` + `/api/*` 프록시 |

[studio_config.py](../backend/app/core/studio_config.py)가 `STUDIO_*` 환경변수를 읽는다. YAML settings 예시나 `.env`를 자동 로드하지 않는다. client/admin 키는 각각 24자 이상이며 서로 달라야 한다. 데이터 경로는 checkout 밖이어야 한다. DB에 저장된 정책은 초기 환경변수보다 우선하므로 정책 변경은 관리자 API를 사용한다.

## 최초 설치

검토한 release 소스를 `/opt/bc250-ai-studio`에 준비한다. macOS 가상환경을 복사하지 말고 서버 Python 3.11 이상으로 새로 만든다. 기존 설치가 있으면 [Actions 배포](ACTIONS_DEPLOYMENT.md)의 업데이트 경로를 사용한다.

서버에서:

```sh
sudo dnf install -y python3 uv curl jq
getent passwd ai-studio || sudo useradd --system --user-group --home-dir /opt/ai-studio-data --no-create-home --shell /usr/sbin/nologin ai-studio
sudo install -d -m 0700 -o ai-studio -g ai-studio /opt/ai-studio-data
cd /opt/bc250-ai-studio
sudo env UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy /usr/bin/uv sync --locked --no-dev --python /usr/bin/python3
sudo chmod -R a+rX /opt/bc250-ai-studio/.venv
```

코드·가상환경은 root 소유, 데이터만 서비스 계정 소유로 둔다. 기존 계정이 있다면 다른 서비스와의 공유 여부를 확인한다. `ProtectHome=true`인 unit에서 접근 가능한 시스템 Python을 사용한다.

환경 파일은 템플릿에서 생성하되 기존 키를 덮어쓰지 않는다.

```sh
sudo python3 - <<'PYENV'
import os
import secrets
from pathlib import Path
text = Path('/opt/bc250-ai-studio/deploy/studio.env.example').read_text()
text = text.replace('GENERATE_CLIENT_KEY', secrets.token_urlsafe(32))
text = text.replace('GENERATE_ADMIN_KEY', secrets.token_urlsafe(32))
fd = os.open('/etc/bc250-ai-studio.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
PYENV
sudo install -m 0644 systemd/bc250-ai-studio.service /etc/systemd/system/bc250-ai-studio.service
sudo systemd-analyze verify /etc/systemd/system/bc250-ai-studio.service
sudo systemctl daemon-reload
sudo systemctl enable --now bc250-ai-studio.service
sudo systemctl status bc250-ai-studio.service --no-pager
```

키 없는 `/api/v1/system/health` 요청은 401이어야 한다. 일반 키를 안전하게 주입한 요청으로 health/status, 모델 목록, fake job, SSE, PNG와 metadata를 확인한다. 키를 명령 출력·로그·URL에 기록하지 않는다.

## 웹 접속

외부 PC에서 `ssh -N -L 18090:127.0.0.1:8090 USER@BC250_HOST`로 터널을 열고 [프런트 실행](../frontend/README.md)을 따른다. Vite의 기본 proxy target은 18090이며 로컬 API 8090을 쓰면 `VITE_STUDIO_TARGET`을 변경한다.

서버 정적 웹은 [Caddy 예시](../deploy/Caddyfile.example)를 기존 사이트 구성에 맞춰 사용한다. `/api/*`는 Studio로, 나머지는 SPA로 전달한다. 별도 origin을 쓰면 정확한 CORS origin을 설정한다. llama/gate 제어 경로를 공개 프록시하지 않는다.

`VITE_STUDIO_API_KEY`는 브라우저 번들에 들어가 사이트 접근자가 읽을 수 있다. 관리자/gate 키를 넣지 않는다. 이 구성은 단일 신뢰 사용자 접근을 전제로 하며 계정별 로그인·격리는 구현되지 않았다.

## 실제 이미지 엔진

1. `scripts/probe_server.py --llm-service llama-server.service --inspect-cli`로 설치 binary·모델·서비스를 확인한다. 조사 결과의 호스트 경로는 비공개로 관리한다.
2. [LLM gate](LLM_GATE.md)의 새 요청 차단·drain과 최소 systemd 권한을 준비한다. 모든 실제 호출자가 gate를 경유하는지 확인한다.
3. 관리자 API로 manual 정책을 설정하고 기존 fake 큐를 정리한다.
4. 환경 파일에 `STUDIO_ENGINE=sdcpp`, GPU 승인, CLI 경로, 허용 LLM 서비스, LLM/admission 주소·키를 설정한다. 요구 조건은 studio_config.py의 validator를 따른다.
5. Studio를 재시작하고 허용된 단일 모델 작업을 manual-grant로 실행한다. PNG·metadata와 LLM 정상 복구를 함께 확인한다.

메모리 카운터 미설정 시 `verified: false`는 측정 불가이며 GPU가 비었다는 뜻이 아니다. 다른 프로세스가 사용하는 잠금 경로를 임의로 바꾸지 않는다. owned hold의 protocol 호환은 별도 확인한다.

## 업데이트와 복구

활성 업데이트 방식은 [Actions 배포](ACTIONS_DEPLOYMENT.md)다. code/config/DB의 일관 백업과 현재 실행 서비스 구성을 함께 보존한다. 이미지 자산은 릴리스 백업에 포함되지 않으므로 별도 데이터 백업 정책이 필요하다.

`config/`는 커밋된 설정 전체가 배포된다. `models.yaml`만 복사하던 이전 설치기에서는 `prompt_dictionary.json`이 누락되어 `prompt_proposals`·`prompt_compose`가 광고되지 않았다(사전 미로드 시 서버는 오류 대신 "미구성"으로 응답하므로 조용히 사라진다). 배포 후 `/api/v1/system/capabilities`에서 `prompt_compose` 존재를 확인한다.

설치기(`deploy/deploy-release.sh`)를 수정한 릴리스는 **호스트 설치기를 먼저 갱신해야 한다**. workflow는 업로드 전에 서버 `/usr/local/sbin/bc250-ai-studio-deploy`의 sha256을 저장소 후보와 비교하고, 다르면 `Install the reviewed deploy/deploy-release.sh on the server first.`로 멈춘다. 이 검사는 설치기 자체를 보호하므로 우회하지 않는다. `scripts/ucp09/install-deployer.sh`가 스테이징·해시 검증을 하고(`--apply`로 설치), root 소유이므로 sudo 암호가 필요하다. 기존 파일은 `.prev-<timestamp>`로 보존된다.

복구가 필요하면 재시작을 반복하기 전에 Studio 상태·journal·생존 이미지 프로세스·gate hold·llama health를 확인한다. 배포 실패는 출력된 백업 경로에서 호환되는 코드·설정·DB를 복원한다. gate나 모델 전환 journal을 삭제해 검사를 우회하지 않는다. `/system/recover`는 이미지 worker 생존 여부 확인 후 실행하며 중단 작업을 다시 시작하는 API가 아니다.

| 증상 | 확인할 항목 |
| --- | --- |
| 401/403 | client/admin 키, 빌드 키와 서버 키 일치 |
| waiting_for_gpu | 정책/manual grant, gate 요청, 공유 lock, recovery 상태 |
| 모델 unavailable | 모델·encoder·VAE·tokenizer·LoRA 파일과 권한 |
| 웹에서만 실패 | `/api` proxy, 빌드 키, CORS origin |
| systemd 기동 실패 | 환경 파일, Python 경로, unit 쓰기 경로, journalctl |
| 이미지 후 LLM 복구 실패 | 서비스 allowlist/권한, gate·health, transition journal |
