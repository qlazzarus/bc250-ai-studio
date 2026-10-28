# BC-250 배포 및 외부 접속 테스트

이 문서는 **Fedora BC-250에 새 API 서비스를 설치하고 외부 PC에서 테스트하는 절차**입니다.
명령은 사용자가 서버에서 실행하는 예시이며, 이 문서 작성 중 실제 서버에 배포하지 않았습니다.
명령 블록의 **실행 위치**를 확인하세요. 서버/외부 PC의 명령은 Bash 기준입니다.

## 1. 현재 테스트할 수 있는 범위

| 항목 | 현재 상태 |
| --- | --- |
| 인증, 모델 조회, 영속 큐, 배치, SSE, PNG·메타데이터 조회 | Fake Engine으로 즉시 테스트 가능 |
| React 웹 화면·갤러리 | Phase 2 구현 완료. SSH 터널 개발 실행 또는 Caddy 정적 배포 필요 |
| Pixel Art 처리·Phaser Export | Phase 3 예정 |
| BC-250 실제 이미지 생성 | Klein Q4 512×512·4 steps 실제 API 작업 검증 완료. 모델별 추가 검증은 별도 필요 |
| 기존 LLM 자동 전환 | 프로젝트에 포함된 별도 LLM admission gate와 모든 클라이언트의 gate 전환 필요 |

**먼저 Fake Engine으로 배포·외부 접속 경로를 검증합니다.** 이 모드는 CPU로 테스트 PNG를
만들며, 기존 llama.cpp·sd-cli·모델·출력 파일을 사용하거나 변경하지 않습니다.
단순히 `STUDIO_ENGINE=sdcpp`만 바꾸면 실제 GPU 테스트가 되는 상태는 아닙니다.

접속 구성은 다음 두 가지입니다. A를 먼저 완료한 뒤 필요하면 B로 진행하세요.

- **A — SSH 터널:** 외부 PC → 기존 SSH 연결 → BC-250의 `127.0.0.1:8090`.
  도메인·HTTPS 인증서·추가 API 포트 개방 없이 테스트합니다. 외부에서 SSH 접속은 가능해야 합니다.
- **B — 공개 HTTPS:** 외부 PC → `https://ai.example.com:443` → Caddy → `127.0.0.1:8090`.
  실제 도메인, DNS, 공인 주소와 방화벽/공유기 설정이 필요합니다.

두 방식 모두 Studio는 **loopback 8090, Uvicorn worker 1개**를 유지합니다.
기존 LLM의 8080, Studio의 8090, Caddy 관리 포트 2019는 인터넷에 포워딩하지 않습니다.

## 2. 사전 확인과 소스 전송

준비할 정보: BC-250 SSH 주소·사용자·포트, sudo 가능한 배포 계정,
Fedora/Python 버전, 여유 디스크. B를 쓰면 추가로 도메인과 공유기 관리 권한이 필요합니다.
`BC250_HOST`, `DEPLOY_USER`, `ai.example.com`은 실제 값으로 바꿉니다.
현재 저장소에는 원격 Git 주소가 없으므로 tar/scp 전송을 예로 듭니다.

**개발 Mac, 프로젝트 루트에서:** macOS의 `.venv`를 Linux로 복사하지 않습니다.

```bash
COPYFILE_DISABLE=1 tar \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='*.egg-info' \
  --exclude='.DS_Store' --exclude='config/settings.yaml' --exclude='frontend/node_modules' \
  -czf /tmp/bc250-ai-studio.tar.gz \
  pyproject.toml uv.lock backend config scripts docs systemd examples deploy frontend README.md
scp /tmp/bc250-ai-studio.tar.gz DEPLOY_USER@BC250_HOST:~/bc250-ai-studio.tar.gz
ssh DEPLOY_USER@BC250_HOST
```

SSH가 기본 22 포트가 아니면 `scp -P 포트`, `ssh -p 포트`를 추가합니다.

**BC-250, 최초 설치용 비대화형 Bash 블록:** 오류가 나면 블록의 다음 설치 명령을 진행하지 않습니다.
대화형 로그인 셸에 직접 `set -u`를 켜면 프롬프트 설정의 미정의 변수와 충돌할 수 있으므로
strict mode는 아래 별도 프로세스에만 적용합니다.
이미 `/opt/bc250-ai-studio`가 있다면 이 최초 설치 절차 대신 11절을 사용합니다.

```bash
bash -euo pipefail <<'BASH'
cat /etc/fedora-release
python3 --version
df -h /opt
sudo ss -lntp
sudo mkdir /opt/bc250-ai-studio
sudo tar -xzf "$HOME/bc250-ai-studio.tar.gz" -C /opt/bc250-ai-studio
sudo chown -R root:root /opt/bc250-ai-studio
sudo chmod -R a+rX /opt/bc250-ai-studio
cd /opt/bc250-ai-studio
python3 scripts/probe_server.py > "$HOME/bc250-inventory.json"
BASH
```

이미 이전 안내의 `set -euo pipefail` 실행 후 `PROMPT_START: unbound variable`이 발생했다면
현재 대화형 셸에서 `set +u; set +e`로 해제합니다. 프롬프트 초기화 파일 자체는 수정하지 않습니다.
소스 압축 해제와 인벤토리 생성까지 완료했다면 `mkdir`/압축 해제를 반복하지 말고 3절부터 진행합니다.
[Bash set 옵션 문서](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)

Python은 3.11 이상이어야 합니다. 8090 충돌이 있으면 해당 프로세스를 임의 종료하지 말고
새 포트를 정해 unit, 프록시, 터널, 테스트 URL을 함께 변경합니다.
인벤토리에서 실제 LLM 서비스명을 확인한 뒤에만 다음 읽기 전용 검사를 실행합니다.

```bash
python3 scripts/probe_server.py --llm-service llama-server.service --inspect-cli \
  > "$HOME/bc250-verified.json"
```

스크립트는 OS·모델 경로·서비스 상태·프로세스 이름·포트·Vulkan 장치와 선택적으로
`sd-cli --help`/해시를 조사합니다. 서비스 정지나 이미지 추론은 하지 않습니다.
출력에는 호스트 경로가 포함되므로 공개 저장소에 올리지 않습니다.

## 3. 의존성·서비스 계정·설정 설치

**BC-250:** Fedora 패키지의 uv와 시스템 Python으로 Linux 가상환경을 새로 만듭니다.
uv 패키지가 없는 Fedora 버전이면 설치를 멈추고 [uv 설치 문서](https://docs.astral.sh/uv/getting-started/installation/)를
확인하세요. 기존 AI용 Python 가상환경은 사용하지 않습니다.

```bash
sudo dnf install -y python3 uv curl jq
getent passwd ai-studio || sudo useradd --system --user-group \
  --home-dir /opt/ai-studio-data --no-create-home --shell /usr/sbin/nologin ai-studio
sudo install -d -m 0700 -o ai-studio -g ai-studio /opt/ai-studio-data
cd /opt/bc250-ai-studio
sudo env UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
  /usr/bin/uv sync --locked --no-dev --python /usr/bin/python3
sudo chmod -R a+rX /opt/bc250-ai-studio/.venv
```

기존 `ai-studio` 계정이 있으면 이 프로젝트 전용인지 확인합니다. API는 해당 비특권 계정으로
실행하며 sudo 권한을 받지 않습니다. 코드·가상환경은 root 소유, 데이터만 서비스 계정 소유입니다.
시스템 Python을 지정하는 이유는 `ProtectHome=true`인 서비스가 `/home` 아래의
사용자용 Python 설치를 따라가다 실행에 실패하지 않도록 하기 위해서입니다.

다음 명령은 템플릿에서 **서로 다른 두 키를 생성**하고 `/etc/bc250-ai-studio.env`에
root 전용 0600 권한으로 저장합니다. 키를 화면에 출력하지 않으며, 기존 파일이 있으면
실패합니다. 재배포 시 키를 덮어쓰지 마세요.

```bash
sudo python3 - <<'PY'
import os
import secrets
from pathlib import Path
text = Path('/opt/bc250-ai-studio/deploy/studio.env.example').read_text()
text = text.replace('GENERATE_CLIENT_KEY', secrets.token_urlsafe(32))
text = text.replace('GENERATE_ADMIN_KEY', secrets.token_urlsafe(32))
fd = os.open('/etc/bc250-ai-studio.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write(text)
PY
```

기본 서버 템플릿은 `fake + image_priority`라서 제출한 작업이 자동 실행됩니다.
설정은 `STUDIO_*` 환경변수만 읽습니다. `settings.example.yaml`이나 `.env`는 자동 로드하지 않습니다.
`STUDIO_CORS_ORIGINS=[]`는 curl/Postman·SSH 터널 테스트에 문제없습니다.
나중에 별도 웹 UI를 연결할 때만 정확한 UI origin 목록을 지정하세요. CORS는 인증을 대신하지 않습니다.

## 4. 새 systemd 서비스 실행

**BC-250:** 아래는 새 Studio unit만 설치합니다. 기존 llama unit은 수정하지 않습니다.

```bash
sudo install -m 0644 systemd/bc250-ai-studio.service /etc/systemd/system/bc250-ai-studio.service
sudo systemd-analyze verify /etc/systemd/system/bc250-ai-studio.service
sudo systemctl daemon-reload
sudo systemctl enable --now bc250-ai-studio.service
sudo systemctl status bc250-ai-studio.service --no-pager
sudo journalctl -u bc250-ai-studio.service -n 80 --no-pager
sudo ss -lntp 'sport = :8090'
```

기대 결과: 서비스 `active (running)`, 리슨 주소 `127.0.0.1:8090`.
키 없이 접속하면 **401**이어야 합니다.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/api/v1/system/health
```

일반 키를 현재 셸 변수로 읽어 서버 자체의 인증 요청을 확인합니다. `set -x`는 사용하지 않습니다.

```bash
STUDIO_API_KEY=$(sudo sed -n 's/^STUDIO_API_KEY=//p' /etc/bc250-ai-studio.env)
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  http://127.0.0.1:8090/api/v1/system/status | jq
```

`engine: fake`, `simulated: true`, `scheduler_running: true`, `recovery_required: false`를 확인합니다.
기존 데이터가 있으면 정책은 DB의 값이 우선합니다. 환경변수만 바꿔도 기존 정책이 바뀌지는 않습니다.

## 5. A: SSH 터널로 외부 테스트 — 첫 접속 권장

**외부 PC의 터미널 1:** 기존에 접근 가능한 SSH 주소를 사용합니다.
외부 SSH가 불가능한 네트워크라면 먼저 기존 VPN/SSH 경로를 확보해야 합니다.

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:18090:127.0.0.1:8090 DEPLOY_USER@BC250_HOST
```

이 터미널을 열어둡니다. 18090은 외부 PC의 로컬 포트입니다.
API를 공유기에서 별도로 포트포워딩하거나 서버의 8090을 열 필요는 없습니다.

**BC-250의 SSH 셸:** 일반 키만 확인해 자신의 암호 관리 도구 등으로 외부 PC에 전달합니다.
키를 채팅·스크린샷·공개 로그에 붙이지 않습니다. 관리자 키는 서버에 둡니다.

```bash
sudo sed -n 's/^STUDIO_API_KEY=//p' /etc/bc250-ai-studio.env
```

**외부 PC의 터미널 2, Bash에서:** 아래 입력은 화면에 표시되지 않으며 셸 명령 기록에
키 자체가 남지 않습니다. 위에서 확인한 일반 키를 붙여넣고 Enter를 누릅니다.

```bash
bash
export STUDIO_URL=http://127.0.0.1:18090
read -r -s -p 'Studio client API key: ' STUDIO_API_KEY
printf '\n'
export STUDIO_API_KEY
```

이후 7절의 같은 테스트 명령을 실행합니다. 터널 종료는 터미널 1에서 `Ctrl+C`입니다.

## 6. B: 도메인과 HTTPS로 외부 접속

이 절은 공개 URL이 필요한 경우에만 실행합니다. 이미 80/443을 쓰는 프록시가 있다면
기존 프록시에 새 도메인 라우트만 추가하세요. 별도의 Caddy를 같은 포트에 중복 실행하지 않습니다.

### 6-1. DNS·공유기

- `ai.example.com`의 DNS A 레코드를 서버/공유기의 실제 공인 IPv4로 지정합니다.
- AAAA 레코드는 IPv6로도 해당 서버에 도달할 수 있을 때만 설정합니다.
- 공유기 뒤라면 BC-250 내부 IP를 고정하고 TCP 80 → BC-250:80, TCP 443 → BC-250:443을 전달합니다.
- 클라우드 보안 그룹이 있으면 동일한 포트를 허용합니다. 외부에서 8090/8080은 열지 않습니다.
- CGNAT/이중 NAT로 인바운드 연결이 불가능하면 포트포워딩만으로 해결되지 않습니다.
  A의 기존 VPN/SSH 경로를 이용하거나 별도 터널 구성이 필요합니다.
- 외부 확인은 같은 Wi-Fi 대신 휴대폰 테더링 등 다른 네트워크에서도 수행합니다.

Caddy는 유효한 도메인과 외부 연결 조건을 갖추면 HTTPS 인증서 발급·갱신과 HTTP 리다이렉트를
처리합니다. [공식 HTTPS 안내](https://caddyserver.com/docs/automatic-https)

### 6-2. Caddy 설정

**BC-250:** Fedora에서 Caddy 패키지를 설치하고 템플릿의 도메인을 실제 값으로 바꿉니다.

```bash
sudo dnf install -y caddy
sudoedit /etc/caddy/Caddyfile
```

추가할 사이트 블록은 [deploy/Caddyfile.example](../deploy/Caddyfile.example)입니다.
기존 설정이 있으면 보존하고 해당 블록만 추가합니다.

```caddyfile
ai.example.com {
    reverse_proxy 127.0.0.1:8090 {
        flush_interval -1
    }
}
```

이 프록시는 Authorization 헤더를 API에 전달하고 SSE가 지연되지 않도록 flush를 설정합니다.
파일 출력 디렉터리를 `file_server`로 공개하지 않습니다. 이미지 다운로드도 API 인증을 거칩니다.
[reverse_proxy 공식 설정](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo journalctl -u caddy -n 80 --no-pager
```

### 6-3. Fedora 방화벽

이미 firewalld가 동작하는 서버 기준입니다. 다른 방화벽을 쓰는 서버에 firewalld를 새로
덧씌우지 말고 기존 규칙을 사용하세요. 먼저 NIC에 연결된 활성 zone을 확인합니다.

```bash
sudo firewall-cmd --state
sudo firewall-cmd --get-active-zones
```

다음 `public`은 예시입니다. 실제 외부 NIC의 zone으로 바꿉니다.
기존 허용 상태를 먼저 기록해 두면 테스트 종료 후 자신이 추가한 규칙만 제거할 수 있습니다.

```bash
STUDIO_ZONE=public
sudo firewall-cmd --zone="$STUDIO_ZONE" --list-services
sudo firewall-cmd --zone="$STUDIO_ZONE" --add-service=http
sudo firewall-cmd --zone="$STUDIO_ZONE" --add-service=https
sudo firewall-cmd --permanent --zone="$STUDIO_ZONE" --add-service=http
sudo firewall-cmd --permanent --zone="$STUDIO_ZONE" --add-service=https
```

런타임·영구 설정을 각각 적용하여 다른 런타임 규칙을 reload로 잃지 않도록 합니다.
[firewalld 공식 서비스 개방 절차](https://firewalld.org/documentation/howto/open-a-port-or-service)

SELinux가 프록시 연결을 차단하면 `sudo ausearch -m AVC -ts recent`와 Caddy 로그에서
실제 거부 원인을 확인합니다. SELinux를 끄거나 광범위한 허용 규칙을 자동 생성하지 말고
설치된 Caddy 패키지 정책·라벨에 맞게 조정합니다.

**외부 PC:** 5절과 같이 일반 키를 준비하고 URL만 바꿉니다.

```bash
export STUDIO_URL=https://ai.example.com
curl -sS -o /dev/null -w '%{http_code}\n' "$STUDIO_URL/api/v1/system/health"
```

HTTPS 인증서 검증은 성공하고 HTTP 응답은 **401**이어야 합니다. `curl -k`로 인증서 오류를
우회하지 마세요. 다음 7절에서 인증 요청을 검사합니다.

## 7. 외부에서 API → 큐 → SSE → PNG 검증

**외부 PC, Bash:** curl과 jq가 필요합니다. Mac에 jq가 없으면 `brew install jq`.
`STUDIO_URL`은 A의 `http://127.0.0.1:18090` 또는 B의 `https://실제도메인`입니다.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/system/health" | jq
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/models" | jq

STUDIO_JOB_ID=$(curl --fail-with-body -sS \
  -H "Authorization: Bearer $STUDIO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model_id":"fake","prompt":"A blue chicken on a farm","seed":42,"source":"rp"}' \
  "$STUDIO_URL/api/v1/jobs" | jq -er '.job_id')
printf 'job_id=%s\n' "$STUDIO_JOB_ID"

curl --fail-with-body -N -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/jobs/$STUDIO_JOB_ID/events"
```

접수 응답은 HTTP **202**와 `job_id`입니다. SSE에서 `id:`, `event: job`, 상태별 `data:`가
나오고 최종 `completed` 이후 연결이 종료됩니다. 빠른 Fake 작업은 이미 완료되었더라도
DB에 저장된 이벤트가 재생됩니다. `queued`에서 계속 기다리면 8절에서 정책을 확인하세요.

```bash
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/jobs/$STUDIO_JOB_ID" | jq

STUDIO_ASSET_ID=$(curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/jobs/$STUDIO_JOB_ID" | jq -er '.output_asset_ids[0]')
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/assets/$STUDIO_ASSET_ID/file" -o bc250-test.png
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_API_KEY" \
  "$STUDIO_URL/api/v1/assets/$STUDIO_ASSET_ID/metadata" | jq
```

다운로드한 PNG에 `FAKE ENGINE / seed 42`가 표시되고, 메타데이터에 `simulated: true`와
`seed: 42`가 있으면 기본 검증 완료입니다. 일반 키로 정책 변경 시 **403**도 확인하세요.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X PUT -H "Authorization: Bearer $STUDIO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"mode":"manual"}' "$STUDIO_URL/api/v1/system/policies"
```

SSE 재접속은 수신한 마지막 `id`를 `Last-Event-ID` 헤더로 전달합니다.
OpenAPI 스키마는 인증 헤더로 `/openapi.json`을 다운로드해 Postman 등에서 사용할 수 있습니다.
`/docs`도 페이지와 스키마 요청에 인증이 필요하므로 브라우저 주소창만으로 열면 401입니다.
현재 키를 입력하는 로그인 UI는 없습니다. 키를 URL 쿼리 문자열에 붙이지 않습니다.

## 8. 관리자 정책 변경과 로그 확인

**BC-250의 SSH 셸에서만 관리자 키를 읽어 실행:**

```bash
STUDIO_ADMIN_KEY=$(sudo sed -n 's/^STUDIO_ADMIN_KEY=//p' /etc/bc250-ai-studio.env)
curl --fail-with-body -sS -H "Authorization: Bearer $STUDIO_ADMIN_KEY" \
  http://127.0.0.1:8090/api/v1/system/policies | jq
# Fake Engine 자동 테스트를 허용할 때:
curl --fail-with-body -sS -X PUT -H "Authorization: Bearer $STUDIO_ADMIN_KEY" \
  -H 'Content-Type: application/json' -d '{"mode":"image_priority"}' \
  http://127.0.0.1:8090/api/v1/system/policies | jq
sudo journalctl -u bc250-ai-studio.service -f
```

`manual` 모드를 유지하려면 자동 정책 변경 대신 `POST /api/v1/system/manual-grant`로
한 작업 실행권을 부여합니다. 정책은 DB에 저장되며 실행 중인 이미지를 강제로 죽이지 않습니다.
일반 키 소유자끼리는 작업·이미지를 공유하는 단일 Studio 구조입니다. 다중 사용자 격리는 아닙니다.

## 9. 실제 BC-250 GPU 테스트로 전환할 때

**여기부터는 외부 API 접속 테스트와 별개의 하드웨어 통합 단계입니다.**
Studio에는 별도 `bc250-llm-gate.service`가 포함됩니다. 이 서비스는 llama.cpp의
8080을 변경하지 않고 8081에서 요청을 프록시하며, pause 동안 새 요청을 upstream에
전달하지 않습니다. **기존 RP/LLM 클라이언트가 모두 8081로 전환되기 전에는** 실제 자동
전환을 켜지 않습니다. 8080을 계속 쓰는 클라이언트는 gate를 우회하므로 안전한 전환을
보장할 수 없습니다.

실행 전 확인할 사항:

1. 모델·해상도·시드·한 장의 테스트와 LLM 중단 시간을 정하고 명시적으로 승인합니다.
2. 실제 LLM unit, `KillMode=control-group`, 서비스 계정의 render-node 접근,
   LLM `/health`와 `/slots` 스키마를 확인합니다. 기존 설치/unit을 임의 변경하지 않습니다.
3. **모든** LLM 클라이언트가 admission gate를 경유해야 합니다. `/slots` 유휴 확인만으로는
   새 요청과 서비스 정지 사이의 경쟁 상태를 막지 못합니다.
4. 포함된 게이트는 Gate 전용 `GATE_API_KEY`로 `/control` GET 및 PUT
   `{"paused":true|false}`를 인증합니다. Studio는 동일 값을
   `STUDIO_ADMISSION_KEY`에 보관하여 `http://127.0.0.1:8081/control`을 제어합니다.
   pause는 신규 요청 전달을 원자적으로 막고, Studio는 이후 llama `/slots`로 진행 중 요청이
   끝났는지 확인합니다. Gate는 upstream 응답 전체가 끝날 때까지 요청을 active로 계산합니다.
5. `STUDIO_LLM_SERVICE`와 JSON `STUDIO_ALLOWED_SERVICES`에 실제 서비스 하나만 등록합니다.
   ai-studio 계정에 그 unit의 start/stop만 허용하는 최소 polkit 규칙을 운영자가 검토합니다.
   광범위한 sudo나 root API를 사용하지 않습니다.
6. `sd-cli --help`로 모델별 옵션을 검증하고 파일 접근 권한을 확인합니다. Realistic Vision의
   정확한 경로를 찾기 전에는 등록된 disabled 상태를 유지합니다. 모델을 새로 다운로드하지 않습니다.

검증 후 `/etc/bc250-ai-studio.env`에 아래 실제 값을 설정합니다. 아래 블록은 템플릿이며,
빈 값·예시 서비스명을 그대로 사용하지 않습니다.

```ini
STUDIO_ENGINE=sdcpp
STUDIO_GPU_TEST_APPROVED=true
STUDIO_LLM_SERVICE=llama-server.service
STUDIO_ALLOWED_SERVICES=["llama-server.service"]
STUDIO_LLM_URL=http://127.0.0.1:8080
STUDIO_LLM_API_KEY=ACTUAL_LLM_KEY_IF_REQUIRED
STUDIO_ADMISSION_URL=http://127.0.0.1:8081/control
STUDIO_ADMISSION_KEY=GATE_CONTROL_KEY
STUDIO_SD_CLI=/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli
STUDIO_GPU_LOCK_PATH=/run/bc250-ai-studio/gpu.lock
```

**엔진을 바꾸기 전에** 관리자 API로 정책을 `manual`로 바꾸고 큐의 남은 Fake 작업을
완료/취소합니다. 기존 DB 정책은 환경변수의 `STUDIO_POLICY=manual`보다 우선하기 때문입니다.
그 뒤 새 설정으로 Studio만 재시작하고, 승인된 실제 모델 작업 한 건을 접수한 후 관리자
`manual-grant`를 호출합니다. 모델별 경로·CLI 스냅샷·시간·결과·LLM 복구 증거를 기록한 뒤에만
레지스트리의 검증 상태와 CLI 스냅샷을 기록합니다. 현재 Klein Q4의 지정 단일 테스트는
이미 `tested`로 기록되어 있습니다.

GPU 메모리 측정은 검증된 sysfs 카운터가 있을 때만 설정합니다. 없으면 상태의
`gpu_memory.verified: false`는 측정 불가를 뜻하며 메모리가 비었다는 보장이 아닙니다.
새 Studio unit의 `TimeoutStopSec`는 worker + drain + LLM 복구 시간보다 충분히 길게 유지합니다.

## 10. Art Studio 웹 UI

브라우저 UI는 API 키를 탭의 `sessionStorage`에만 저장하고, 모든 API·이미지 요청에
Bearer 헤더를 붙입니다. 따라서 `/api`를 Studio API와 **같은 origin**으로 프록시하는 구성이
가장 단순하며 CORS 설정이 필요하지 않습니다.

### SSH 터널을 통한 Mac 개발 테스트

**Mac:** 기존 터널을 유지하거나 새로 엽니다.

```bash
ssh -N -L 18090:127.0.0.1:8090 USER@BC250_HOST
```

그 다음 프로젝트의 `frontend`에서 실행합니다.

```bash
cp .env.example .env.local
npm ci
npm run lint
npm run build
npm run dev
```

`http://127.0.0.1:5173`을 열어 API 주소에 `/api/v1`, API 키에 `STUDIO_API_KEY`를 입력합니다.
Vite는 `/api`를 `http://127.0.0.1:18090`으로 전달합니다. 실제 엔진의 manual 정책에서는
작업 접수 뒤 BC-250의 관리자가 별도로 manual grant해야 합니다.

### Caddy 정적 배포

정적 빌드는 민감한 키를 포함하지 않습니다. Mac에서 빌드한 뒤 `frontend/dist/`를 Studio 소스의
동일 경로로 전송하고, [Caddy 템플릿](../deploy/Caddyfile.example)의 사이트 블록을 기존
`Caddyfile`에 병합합니다. 템플릿은 `/api/*`만 loopback Studio로 전달하고 나머지는
`frontend/dist`에서 제공합니다. 검증과 reload 후 도메인을 열어 `/api/v1`을 API 주소로 사용합니다.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

## 11. 업데이트·백업·복구·테스트 종료

### 업데이트

다른 배포본을 실행 중인 코드 위에 덮어쓰지 않습니다. 관리자 정책을 manual로 바꾸고 현재
이미지 완료를 기다린 뒤 Studio만 중지합니다. 새 소스는 별도 디렉터리에 풀어 먼저 확인합니다.

```bash
sudo systemctl stop bc250-ai-studio.service
# 기존 코드와 DB/출력을 같은 시점으로 보관 (용량을 먼저 확인):
STUDIO_BACKUP=/var/backups/bc250-ai-studio/$(date +%Y%m%d-%H%M%S)
sudo install -d -m 0700 "$STUDIO_BACKUP"
sudo cp -a /etc/bc250-ai-studio.env "$STUDIO_BACKUP/"
sudo cp -a /opt/bc250-ai-studio "$STUDIO_BACKUP/source"
sudo cp -a /opt/ai-studio-data "$STUDIO_BACKUP/data"
```

정지된 DB를 백업하므로 WAL 누락 문제를 피할 수 있습니다. 새 코드는 기존과 같은
`/opt/bc250-ai-studio` 경로에 배치하고 `uv sync --locked --no-dev --python /usr/bin/python3`로
가상환경을 재구성합니다. 기존 env와 데이터는 보존합니다. unit 변경 시에만 daemon-reload 후
Studio를 시작하고 4·7절을 재검증합니다. 스키마 마이그레이션은 시작 시 적용됩니다.
롤백이 필요하면 Studio를 중지하고 **호환되는 코드와 DB/출력 백업을 함께** 복원합니다.
다른 위치에 복사한 `.venv`를 그대로 실행하지 마세요. 백업 이후 생성된 데이터는 별도로 보존합니다.

### 장애 복구

LLM 정지나 Worker 실패 시 LLM 재기동·헬스체크·gate resume을 시도합니다. 복구 실패 시
오류를 저장하고 추가 GPU 실행을 차단합니다. API는 계속 살아 있어 상태를 조회할 수 있습니다.

프로세스가 비정상 종료되어 전환 journal이 남아 있으면 자동 실행하지 않습니다. 운영자가
실제 cgroup/프로세스를 확인해 **살아 있는 이미지 Worker가 없음을 확인한 뒤에만** 다음을 실행합니다.

```bash
curl --fail-with-body -sS -X POST -H "Authorization: Bearer $STUDIO_ADMIN_KEY" \
  -H 'Content-Type: application/json' -d '{"confirmed_no_image_worker":true}' \
  http://127.0.0.1:8090/api/v1/system/recover | jq
```

journal을 삭제해서 차단을 우회하지 않습니다. `interrupted` 작업은 명시적 retry로 새 작업을
만듭니다. 부분 성공한 이미지는 이전 작업에 보존됩니다. 이벤트·로그는 자동 삭제하지 않으므로
디스크 용량을 관찰합니다. 비정상 종료 직전에 기록된 미등록 파일은 임의 성공 처리하지 않습니다.

### 외부 테스트 종료

SSH 터널은 Ctrl+C로 닫습니다. 공개 HTTPS는 추가한 사이트 블록과 DNS/공유기 포워딩만
제거하고 Caddy 설정을 검증한 뒤 reload합니다. 공유 중인 Caddy 전체를 중지하지 않습니다.
방화벽 http/https 규칙은 다른 서비스가 쓰지 않고 이번에 추가한 경우에만 제거합니다.
Studio 자체도 중지하려면 `sudo systemctl disable --now bc250-ai-studio.service`를 실행합니다.
데이터·모델·기존 llama 서비스는 삭제하지 않습니다.

## 11. 증상별 확인

| 증상 | 확인할 내용 |
| --- | --- |
| `PROMPT_START: unbound variable` | 대화형 셸의 `set -u` 충돌. `set +u; set +e` 후 설치 블록에만 strict mode 적용 |
| 외부 연결 시간 초과 | SSH 주소/포트, DNS, 공유기 NAT·CGNAT, 활성 firewall zone, IPv6 AAAA |
| HTTPS 인증서 실패 | 실제 도메인 DNS, 80/443 도달성, 기존 프록시 충돌, Caddy 로그 |
| 502 | Studio 상태, 127.0.0.1:8090 리슨, SELinux AVC, 프록시 upstream |
| 401 | Bearer 헤더 누락·잘못된 키. `/docs`도 인증 필요 |
| 403 | 일반 키로 관리자 API 호출했는지 |
| `/`가 404 | 현재는 API만 제공, `/api/v1/system/health`로 확인 |
| 작업이 queued에 머묾 | 저장된 manual 정책, 실행권, recovery_required, 스케줄러 상태 |
| 모델 unavailable / 422 | fake 모드에서 실제 모델 사용, 경로·권한 누락, 미지원 크기·파라미터 |
| 서비스가 시작 직후 실패 | env 키 길이/중복, 데이터 경로, 가상환경 Linux 재생성, journalctl |
| SSE가 묶여서 도착 | curl `-N`, 프록시 flush/buffering, 상위 CDN 스트리밍 제한 |
| 브라우저에서만 실패 | 인증 헤더, CORS의 정확한 origin, 아직 미구현인 UI |
| `Another process owns lock` | 중복 Uvicorn/Studio 실행. workers=1, 단일 데이터 루트 |

## 참고 문서

- [Fedora uv 패키지](https://packages.fedoraproject.org/pkgs/uv/uv/)
- [Caddy 설치](https://caddyserver.com/docs/install)
- [Caddy HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [firewalld 포트·서비스 개방](https://firewalld.org/documentation/howto/open-a-port-or-service)

로컬 개발은 [README](../README.md), API 세부 계약은 [API.md](API.md),
기존 테스트 근거는 [TESTING.md](TESTING.md)를 참고하세요.
