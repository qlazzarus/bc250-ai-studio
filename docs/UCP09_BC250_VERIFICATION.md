# UCP09 실환경 검증 절차 (BC-250)

이 문서는 **실제 BC-250 호스트에서 UCP09를 수행하기 위한 절차**다. 2026-11-23에 배포가 완료됐고, 그 상태에서 읽기 전용 점검으로 원인을 확정했다. **UCP09는 아직 완료가 아니다** — compose는 `STUDIO_LLM_MODEL` 미설정으로 광고되지 않는다. 아래 「차단 사유」가 해소되기 전에는 compose 단계를 실행할 수 없다.


## 현재 상태 (2026-11-23 13:45 읽기 전용 재확인, 배포 완료 후)

배포는 **완료됐다**(Studio `ActiveEnterTimestamp` 13:21:11, backend 107개 파일 HEAD와 sha256 전부 일치, 설치기 `8718137e…` 일치, 사전 배치됨). 그런데 **compose는 여전히 광고되지 않는다.** 원인은 사전 누락이 아니라 **`STUDIO_LLM_MODEL` 미설정**이다.

| 항목 | 실측값 | 판정 |
| --- | --- | --- |
| 호스트 | Fedora 43, `6.17.1-300.fc43.x86_64` | BC-250 실환경 확인 |
| GPU | `AMD Radeon Graphics (RADV GFX1013)`, Mesa 25.2.4 | 실제 GPU 인식 |
| LLM | `Qwen3.6-35B-A3B…IQ2_M.gguf`, `n_ctx` 16384 | `/health` = `{"status":"ok"}` |
| Studio | `sdcpp`, `simulated: false`, `policy: chat_priority` | 정상 |
| 배포 버전 | backend **107/107 파일 sha256 HEAD와 일치**, `config/` 3파일 | **배포 완료** |
| Studio 재시작 | `ActiveEnterTimestamp` 11:58 → **13:21:11** | 새 릴리스로 기동 |
| 설치기 | 호스트 = 저장소 = `8718137e164ab3…5cf4c364` | **hash guard 통과** |
| 사전 | `config/prompt_dictionary.json` 12,063 B, v1.2.0, 100 entries, `load_dictionary → True` | **배치·로딩 성공** |
| compose | `/api/v1/prompt/compose` → **503 `capability_not_advertised`** | **여전히 차단** |
| proposals | `/api/v1/prompt/proposals` → **200 `not_configured`**, capability 미광고 | **함께 미광고** |
| gate | `/health`·`/status` 409(설계), `/model-snapshot` 200 `ready: true` | 정상 |

> **2026-11-23 추가**: `x-model-epoch` 처리 코드가 **로컬에서 구현·검증됐다**(아래 「`x-model-epoch` 구현」 절). 다만 **서버에는 아직 배포되지 않았고** `STUDIO_LLM_MODEL`도 여전히 미설정이므로, 위 표의 호스트 상태는 그대로다. 배포하려면 사용자 승인이 필요하다.


### 차단 사유와 원인 (사전이 아니라 `llm_model`)

배포된 코드로 인프로세스 재현한 결과가 결정적이다(`/opt/bc250-ai-studio/.venv/bin/python`, 서비스 무변경):

```
dictionary loaded : True version: 1.2.0 entries: 100
proposals, llm_model empty: False
compose  , llm_model empty: False
proposals, llm_model set  : True
compose  , llm_model set  : True
```

두 capability는 **같은 마지막 조건**을 공유한다(`proposal_provider.py:120`, `prompt_compose.py:1253`):

```python
return (proposals_enabled(settings) and dictionary is not None
        and bool(getattr(settings, "llm_model", "")))
```

- `dictionary is not None` → **참**(사전 배치·로딩 확인).
- `admission_url` → **참**. 근거: gate 저널에 `PUT/DELETE /control/holds/studio-a08c75945bea4ff2b8a14a130a285ec7` **200 OK**(12:17). `studio-<uuid4hex>` 형식은 Studio만 만든다(`gpu.py:105`). 즉 Studio가 gate `/control`에 실제로 인증해 hold를 걸고 풀었다.
- `engine = sdcpp` → **참**.
- `llm_model` → **거짓(빈 문자열)**. 이 하나가 남은 원인이다.


**왜 비어 있나**: `STUDIO_LLM_MODEL` 요구는 `03a2fa5`(2026-11-18)에서 들어왔고, `deploy/model-control/prepare-secrets.py`가 만드는 `studio-gate.env`에는 이 항목이 **없다**. 호스트 `/etc/bc250-ai-studio.env`의 mtime은 **2026-10-24 19:51**로 그 이후 한 번도 갱신되지 않았다. 즉 오늘 배포가 만든 문제가 아니라 **처음부터 설정된 적이 없는 항목**이며, 이 때문에 `prompt_proposals`도 함께 광고되지 않는다.

두 번째 잠재 결함(별개 → **로컬에서 구현 완료, 운영 미배포**): gate 프록시는 `/v1/chat/completions`에 `x-model-epoch` 헤더를 **필수**로 요구한다(`gate.py:114`, `enter()`가 `not epoch → 409 model_epoch_mismatch`). 실측:

```
ready = True epoch = dc75b481
no epoch : 409 {"detail":"model_epoch_mismatch"}
with epoch: 200
```

`X-Model-Epoch`를 보내는 주체는 원래 **LLM 클라이언트**(`/opt/bc250-llm-client/backend/app/main.py:419`)뿐이었고, **이 저장소의 Studio 코드에는 `model-snapshot`/`epoch` 처리가 전혀 없었다**(구현 전 전체 grep 0건). 따라서 `llm_model`만 채워 광고를 켜면 compose 호출은 `upstream_status / http_409`로 실패했을 것이다. **이제 코드는 있으나 서버에는 아직 배포되지 않았다** — 아래 "`x-model-epoch` 구현" 절 참조.


### 이미 해소된 것 (다시 미완료로 취급하지 않는다)

- 설치기 hash guard 실패 → 검토된 설치기를 호스트에 설치해 **해소**(`8718137e…` 일치).
- `config/prompt_dictionary.json` 누락 → 복사 목록을 `config` 전체로 넓혀 **해소**(호스트 12,063 B, v1.2.0).
- 배포 테스트의 문자열 고정 결함(`IndexError`) → 복사 목록 파싱·동작 기반 검증으로 **해소**.

## 배포 전 기준점 (참고: 이제 과거 기록)


- 코드 기준점은 `9a6cf1e`(origin/main, tag `ucp08-baseline`)이었고, 배포는 `d736cb1`(origin/main)로 실행됐다.
- `c82bae5`·`9a6cf1e`는 설치기 수정·점검 스크립트·문서만 담는다(제품 런타임 코드 변경 없음). `b9dddc5`는 배포 테스트 수정, `d736cb1`은 설치 절차 스크립트·문서다.
- **해소된 이력**: `c82bae5` push 시 CI의 `pytest scripts/test_studio_static_deploy.py`가 `IndexError`로 실패해 배포가 막혔고, `b9dddc5`로 테스트를 고친 뒤 설치기 hash guard에 걸렸다가, 검토된 설치기를 설치한 뒤 **배포가 완료됐다**. 이 이력은 장애 기록으로만 유지한다.
- 롤백 재료: `/var/backups/bc250-ai-studio.{bmW32Fj2,Iwye5Waq,2MFoJsK8}` 등 릴리스 백업이 있고, 설치기는 code/config/DB 사본을 만든 뒤 교체한다. **백업 디렉터리는 `0700`이라 열람에 root가 필요하다.**
- 덮어쓰지 않는 것: `config/models.yaml`은 로컬·서버 sha256이 같아 교체해도 변화가 없다. `.env`·DB·이미지 자산·모델 파일은 설치기 대상이 아니다(`/etc/bc250-ai-studio.env`, `/opt/ai-studio-data`, `/opt/sd-models`).
- 배포 스테이지는 `git archive HEAD ... config`로 만들어지므로 **추적되는 파일만** 서버에 도달한다(`config/models.yaml`, `config/prompt_dictionary.json`, `config/settings.example.yaml`). `config/settings.yaml`은 gitignore 대상이라 애초에 포함되지 않는다.
- **실측 확인**: 이번 배포 후 `config/`에는 위 3개 파일만 남았다. 즉 서버에만 있던 `config/models.yaml.bak.20261113104948`는 제거됐고, 직전 사본은 `/var/backups/bc250-ai-studio.bmW32Fj2`(root 0700)에 있다.

### 배포 위험 (참고)

`.github/workflows/deploy.yml`은 **main push에 자동 배포**된다. 배포는 마지막 잡의 마지막 단계라, 그 앞의 테스트·패키징이 실패하면 배포까지 도달하지 않는다.

- push하면 CI를 통과한 경우에만 설치기가 돌아 **Studio가 재시작**된다(무중단 아님, 진행 중 작업은 `interrupted`로 전환될 수 있음). gate·llama·model-worker는 재시작 대상이 아니다.
- **설치기를 수정했다면 설치기가 CI의 hash guard에 걸린다.** `deploy/deploy-release.sh`를 바꾼 릴리스는 호스트의 설치기를 먼저 갱신해야 한다.
- push하기 전에 **CI와 동일한 명령을 로컬에서 먼저 통과시킨다**: `uv run pytest -q scripts/test_studio_static_deploy.py`, `uv run ruff check backend`, `bash -n deploy/deploy-release.sh`.
- push 자체는 사용자 승인 사항이다.


## 읽기 전용 점검

```sh
scripts/ucp09/inspect-bc250.sh          # 호스트 인벤토리, 변경 없음
scripts/ucp09/verify-tunnel.sh          # 터널 경로 검증, 변경 없음
scripts/ucp09/diagnose-advertise.sh     # 광고 조건을 배포된 코드로 재현, 변경 없음
```


`inspect-bc250.sh`는 `systemctl show/is-active`, `ss -lntp`, `find`, `vulkaninfo --summary`, `/proc/<pid>/cmdline`, loopback GET만 사용한다. sudo를 쓰지 않고, 서비스를 재시작·활성화하지 않으며, job을 넣지 않는다. root 없이 못 읽는 경로는 "unreadable"로 표시하고 권한 상승을 시도하지 않는다.

`diagnose-advertise.sh`는 호스트의 **배포된 venv와 배포된 코드**로 두 광고 술어만 실행한다. 사전을 읽고 불리언 두 개를 출력할 뿐 요청을 보내지 않으므로 서비스 상태에 영향이 없다. 실제 출력:

```
dictionary   : loaded | version: 1.2.0 | entries: 100
llm_model empty: proposals=False compose=False
llm_model set  : proposals=True compose=True
```

이 한 번의 실행이 "사전은 정상, `llm_model`만 비어 있다"를 확정한다. 다시 원인을 추론할 필요가 없도록 스크립트로 남긴다.


이번 실행에서 확인된 세 가지 한계:

- `sudo`는 **비밀번호가 필요**하다. NOPASSWD는 `systemctl restart bc250-llm-client.service`, `bc250-ai-studio-deploy`, `bc250-studio-coordinated-deploy ""` 세 개뿐이다. 따라서 `/opt/ai-studio-data`(0700 ai-studio)와 `/var/backups/*`(0700 root)는 사용자 세션에서 읽을 수 없다.
- gate의 `/health`·`/status`는 **409**를 돌려준다(게이트 자체 프로토콜). 200이 아니라고 해서 게이트가 죽은 것은 아니다.
- **배포 테스트가 복사 목록 문자열을 그대로 인용하고 있었다.** `test_backend_and_frontend_are_replaced_together`는 `"for item in backend config/models.yaml frontend/dist"`를 `split`해서 스크립트 일부를 떼어냈다. 목록을 `config` 전체로 넓히자 `split`이 빈 리스트를 돌려주어 **아무것도 검사하지 않고 `IndexError`로 죽었다.** 이는 "검사하는 척하는 테스트"의 전형이라, 복사 목록을 스크립트에서 **파싱**하고 결과 파일 트리로 판정하도록 고쳤다(`scripts/test_studio_static_deploy.py`). 사전이 호스트에 도달하는지 확인하는 테스트도 추가했다.

## 설치기 배포 (hash guard) — 2026-11-23 해소

CI는 릴리스 업로드 **전에** `/usr/local/sbin/bc250-ai-studio-deploy`의 sha256이 저장소의 `deploy/deploy-release.sh`와 같은지 확인하고, 다르면 다음 메시지로 멈춘다.

```
Install the reviewed deploy/deploy-release.sh on the server first.
```

당시 실측 차이:

| 위치 | sha256 | 대응 커밋 |
| --- | --- | --- |
| 호스트 (수정 전) | `f1400e90…ab442775` | `14439eb` (2026-11-15) |
| 저장소 | `8718137e…cf4c364` | `c82bae5` |

차이는 의도한 2개 hunk뿐이다(+10/−2): `config` 디렉터리 전체 복사, 사전 파일 전제조건.

**현재 상태: 일치.** 호스트 = 저장소 = `8718137e164ab342bc4974f8ade8d8c383b755ef4b6ebeb3fb7dc8cd5cf4c364`. hash guard는 통과했고 배포가 완료됐다.

```sh
scripts/ucp09/install-deployer.sh            # 스테이징 + 해시 검증, 설치 명령만 출력
scripts/ucp09/install-deployer.sh --apply    # 스테이징 후 설치 (sudo 비밀번호 필요)
```

설치기가 root 소유이므로 **sudo 암호가 필요**하다. 이 경로에는 NOPASSWD 규칙이 없다(`sudo -n true`도 실패). 그래서 스크립트는 스테이징·해시 검증까지만 무권한으로 수행하고, 마지막 `install`만 사람이 승인하게 나눠 두었다. root로 실행되는 헬퍼는 **자기가 해시를 다시 검증**하므로 전송이 변조되면 설치하지 않는다(`Refusing: staged installer is …`로 실패, 아무것도 쓰지 않음 — 실측 확인).

기존 설치기는 `bc250-ai-studio-deploy.prev-<timestamp>`로 보존되고, `restorecon`으로 SELinux 컨텍스트(`bin_t`)를 복원한다. 스테이징 파일은 성공 후 호스트에서 삭제된다.

이 검사는 **설치기 자체를 보호하는 장치**이므로 우회하지 않는다(CI에서 검사를 빼거나 `--force`를 추가하지 않는다). 설치기를 바꿀 때마다 이 순서가 필요하다.


## SSH 터널

`~/yeppyshiba-tunnel.sh`는 다음 한 줄이다.

```sh
ssh -p 2222 -N -T -o ExitOnForwardFailure=yes \
    -L 127.0.0.1:18080:127.0.0.1:80 yeppyshiba@yeppyshiba.iptime.org
```

포트 18080(loopback) → 호스트 Caddy(:80). **새 공개 포트를 열지 않는다.** 브라우저·API·SSE·갤러리·이미지가 모두 이 한 origin을 지난다.

이번 실행 결과(`verify-tunnel.sh`): **12 checks, 0 failed**. 터널 루트 200, `Server: Caddy`, 해시된 번들·CSS 200, 비인증 health 401(프록시가 FastAPI까지 도달), 인증 capabilities/models/jobs 200, **SSE 실작업 스트림 200 `text/event-stream` 16,644 bytes**(존재하는 job id 사용 — 없는 id의 404는 스트리밍을 증명하지 못하므로 이렇게 바꿨다), **이미지 다운로드 200 · 497,221 bytes PNG 512×512**, Studio/gate/llama 포트 loopback 전용.

추가 확인: `prompt_composition`(v1~3)은 광고되지만 `prompt_compose`·`prompt_proposals`는 광고되지 않는다. 사전이 배치된 뒤에도 같다 — 원인은 아래 `llm_model` 항목이다. `prompt_proposals`가 함께 꺼져 있다는 사실이 원인을 좁히는 단서다(둘은 같은 마지막 조건을 공유한다).



주의: 클라이언트 키는 설계상 브라우저 번들에 포함된다(`VITE_STUDIO_API_KEY`). 스크립트는 이 키를 번들에서 읽어 쓰되 출력하지 않는다. **admin/gate 키를 쓰지 않는다.**

## UCP09 검증 순서

각 단계는 **실제 출력**과 **Mock 결과**를 구분해 기록한다. Mock 통과를 실연결 성공으로 대체하지 않는다.

| # | 단계 | 현재 가능 여부 |
| --- | --- | --- |
| 1 | 실제 llama-server 연결 확인 | **완료** — `/health` `{"status":"ok"}`, `n_ctx` 16384, gate `/model-snapshot` 200 |
| 2 | 고정 평가 사례 4건 Compose 요청 | **차단** — `prompt_compose` 미광고(503). 원인 `llm_model` 미설정 |
| 3 | 1~3개 후보 생성·JSON 계약 검증 | **차단** — 2에 종속 |
| 4 | 의미 보존·인물 귀속·제외 조건 평가 | **차단** — 사람 판정 필요 |
| 5 | 실패·timeout·GPU Gate 복구 | 부분 가능 — gate 409/epoch 동작은 실측 완료, compose timeout은 2 이후 |
| 6 | SD1.5 이미지 생성 | **가능** — `realistic-vision-v6` exec=True, available |
| 7 | 나머지 설치 모델별 생성 | 가능 — 8개 모델 exec=True (flux2 3, z-image 2, sd15 1, moss-image 2) |
| 8 | 성능·품질 정리 | 6~7 이후 |

### 차단 해소 절차 (사전이 아니라 `llm_model`)

배포는 끝났고 사전도 있다. 남은 것은 **환경설정 한 항목**이다. `sudoedit`로 root만 수정할 수 있으므로 사람이 승인해야 한다.

```sh
# 1) /etc/bc250-ai-studio.env 에 한 줄 추가 (root 전용 파일, 0600)
#    값은 llama-server가 실제로 서빙하는 모델 이름과 일치해야 한다.
sudoedit /etc/bc250-ai-studio.env
# STUDIO_LLM_MODEL=/opt/models/qwen36-35b-a3b-uncensored/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf

# 2) 광고를 켜려면 Studio만 재시작한다 (gate·llama는 건드리지 않는다).
sudo systemctl restart bc250-ai-studio.service

# 3) 광고 확인
curl -sS -H "Authorization: Bearer $CLIENT_KEY" \
  http://127.0.0.1:18080/api/v1/system/capabilities | grep -o '"prompt_compose"'
```

**주의 1 — 전역 LLM 설정 금지**: `STUDIO_LLM_MODEL`은 Studio 프로세스의 환경변수일 뿐 llama-server 설정을 바꾸지 않는다. 모델 파일·llama 유닛은 수정하지 않는다.

**주의 2 — 광고만 켜지고 호출은 실패할 수 있다**: gate 프록시가 `x-model-epoch`를 요구한다(실측: 헤더 없으면 409, 있으면 200). 이 헤더를 보내는 코드는 **로컬에는 구현됐지만 이 절차를 실행하는 서버에는 아직 배포되지 않았다.** 따라서 `STUDIO_LLM_MODEL`만 설정하고 재시작하면 광고는 켜지나 2단계 compose가 `upstream_status / http_409`로 실패한다. **epoch 코드 배포와 환경변수 설정은 함께 적용해야 하며, 둘 다 별도 승인 사항이다.** 광고 여부만 보고 UCP09를 완료 처리하지 않는다.

**주의 3 — `models.yaml` 백업**: 이번 배포로 서버에만 있던 `models.yaml.bak.20261113104948`는 제거됐다. 필요하면 `/var/backups/bc250-ai-studio.bmW32Fj2`(root 0700)에서 꺼낸다.


### 2단계 실행 (광고 확인 후)

```sh
# 1) 광고 여부를 먼저 확인한다. 여기서 아무것도 안 나오면 2단계를 시작하지 않는다.
curl -sS -H "Authorization: Bearer $CLIENT_KEY" \
  http://127.0.0.1:18080/api/v1/system/capabilities | grep -o '"prompt_compose"'

# 2) 고정 사례 4건은 이미 저장소에 있다.
python3 -c "import json;d=json.load(open('backend/tests/fixtures/ucp04_eval_cases.json'));print(len(d['cases']))"
```


사례별로 **요청 원문, 응답 JSON, 후보 수, 지연(ms), 사전·프로필 버전, token usage·`finish_reason`, GPU 점유/해제**를 기록한다. `ucp04_eval_cases.json`의 선언 용어 검사는 **규칙 기반이며 의미 보존의 증거가 아니다**(`test_prompt_compose_meaning.py`의 `test_the_server_cannot_tell_drift_from_a_paraphrase`가 서버가 drift를 구별하지 못함을 고정한다). 인물별 귀속·관계·부정 조건은 **사람이 판정**하고 근거를 남긴다.

### 6~7단계 주의

- GPU는 `chat_priority`이고 `gpu.lock`을 공유한다. compose는 **GPU를 빌리지 않는다**(`availability_failure`: blocked→`gpu_unavailable`, leased→`image_running`). 이미지 생성 중 compose 호출이 503인 것은 정상이다.
- 동일 seed·동일 설정으로 기존 결과와 비교하되 **의미 재현과 시각 품질을 분리**해 기록한다.
- 평가용 job은 기록에 남긴다. **점검·계약 확인용 job을 평가 데이터와 섞지 않는다**(이번 세션의 `contract probe` 2건이 그 예).

## UCP09 완료 판정 기준 (증거 없이는 완료 처리하지 않는다)

UCP09를 완료로 표시하려면 **아래가 모두 실제 출력으로** 남아 있어야 한다. 문서에 절차를 썼다는 사실, 테스트가 통과했다는 사실, 광고가 켜졌다는 사실은 각각 완료 근거가 아니다.

| # | 요건 | 현재 |
| --- | --- | --- |
| 1 | `prompt_compose` **와** `prompt_proposals` 광고 확인 | **미충족** — 둘 다 미광고 |
| 2 | 고정 4사례 실제 요청/응답 JSON 원문 | **미수집** — 1 미충족 |
| 3 | 사례별 후보 수·JSON 스키마 유효성·지연·`finish_reason`·token usage(제공 시) | **미수집** |
| 4 | timeout·5xx·`invalid_reply`·clarification 여부 | **미수집** |
| 5 | 의미 보존 사람 판정(인물 수·귀속·관계·부정·고정 속성)과 판정 근거 | **미수집** |
| 6 | GPU Gate 점유/반환 실측(요청 전후 `/control` 상태) | **부분** — gate 409/epoch 동작만 실측 |
| 7 | SD1.5 실생성 1건 + 적용 prompt·CFG·profile·소요·메모리·Gate 상태 | **미수행** |
| 8 | 나머지 모델 실행 가능성 확인 및 순차 결과 | **미수행** |

**금지되는 완료 처리**: ① 광고만 켜지고 호출이 409로 실패하는 상태, ② Mock/스텁으로 4사례를 통과시킨 결과, ③ 자동 계약 테스트 통과를 의미 보존 증거로 대체, ④ 서버가 주지 않은 토큰 사용량·메모리·`finish_reason` 추정값.

## `STUDIO_LLM_MODEL` 값 확정 (추정 없이)

llama-server 기동 인자에 `--alias`가 **없다**(실측 cmdline). 따라서 API가 노출하는 모델 이름은 별칭이 아니라 **파일 경로 전체**다. `/model-snapshot`의 `data[].id`가 유일한 권위 값이다:

```
'/opt/models/qwen36-35b-a3b-uncensored/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf'
```

| 후보 | 근거 | 판정 |
| --- | --- | --- |
| 위 경로 전체 | `/model-snapshot` `data[].id`, `GET /v1/models` `id` | **사용** |
| `qwen3.6-35b-a3b` 등 짧은 이름 | 어디에도 정의 없음 | 쓰지 않음(추정) |
| `qwen2.5-7b-instruct` | `deploy/studio.env.example`의 **예시 placeholder** | 쓰지 않음 |

주의사항:

- `--alias`는 llama.cpp가 지원하지만 지금 인자에 없으므로, 별칭을 만들려면 llama-server 재시작이 필요하다. 그것은 **금지 범위(전역 LLM 설정)** 이므로 하지 않는다. 경로를 그대로 쓴다.
- `STUDIO_` 접두사는 pydantic이 붙인다(`env_prefix="STUDIO_"`, `extra="forbid"`). 변수명이 `STUDIO_LLM_MODEL`이 아니면 기동이 실패한다.
- Studio는 응답 `model` 필드를 설정값과 **비교하지 않는다**(`_envelope_model`은 기록용). 따라서 값이 틀려도 오류로 드러나지 않고 llama가 무시할 뿐이다. 조용한 실패를 피하려면 정확한 id를 넣는다.
- 값에 `/opt/models/...` 경로가 들어가지만 **모델 파일을 바꾸는 것이 아니라** Studio가 요청에 실어 보내는 이름일 뿐이다.

## `x-model-epoch` 구현 (로컬 완료, 운영 미배포)

### 참조 구현: `/opt/bc250-llm-client/backend/app/main.py`

| 요소 | 구현 |
| --- | --- |
| snapshot 조회 | `GET {gate}/model-snapshot`, `ready is True`, `epoch`가 `[0-9a-f]{32}`, `models.data` 비어있지 않음 |
| 요청 헤더 | `X-Model-Epoch: <snapshot epoch>` (`gate_headers`) |
| epoch 불일치 | `409` → `model_epoch_mismatch`로 사용자에게 반환. **자동 재시도 없음**(대화형). 백그라운드 준비 작업만 `sleep` 후 재확인 |
| stale 방지 | 호출 직전 snapshot → 호출 → 필요 시 재확인. `after_epoch != epoch`면 실패 처리 |
| 409 식별 | 게이트가 `X-BC250-Admission: rejected` 헤더를 붙임 |

### 설계상 결정적 제약: epoch는 캐싱할 수 없다

게이트 `mutate()` 135행:

```python
if hold not in holds and hold.startswith(('switch-', 'studio-')): epoch = secrets.token_hex(16)
```

**Studio의 이미지 생성 hold(`studio-*`)도 epoch을 올린다.** 즉 epoch은 "모델이 바뀌었다"가 아니라 **"GPU 소유권이 바뀌었다"**의 표식이다. Studio가 이미지 job을 시작/종료할 때마다 값이 바뀌므로, 프로세스 시작 시 한 번 받아 캐싱하면 곧 409가 된다. → **매 호출 직전에 `/model-snapshot`을 조회해야 한다.**

### GPU Gate 점유와의 정합성

- `/model-snapshot`은 **hold를 잡지 않는다.** 게이트가 `enter()` 없이 `status()`만 읽고 llama `/v1/models`를 프록시한다. 그래서 조회 자체가 GPU를 점유하지 않는다.
- paused 상태에서는 `/model-snapshot`이 `409 {"ready": false, "epoch": ...}`를 준다. 현재 Studio는 이미 `_gate_state`로 paused를 먼저 확인해 `admission_paused`로 끝내므로, epoch 조회는 그 뒤에 두면 된다.
- ⚠️ **알려진 경합**: 이미지 job 시작과 LLM compose가 겹치면 클라이언트가 받은 epoch이 hold 획득 직후 무효가 되어 409가 날 수 있다. 이것이 **정확히 의도된 동작**이다(모델/소유권 전환 중 호출 금지). 재시도로 덮지 말고 사용자에게 알린다.
- Studio compose는 이미지 생성 중 `leased=True`면 애초에 `image_running`으로 거절하므로, 실제 경합 창은 좁다.

### 변경 범위 (구현 완료, 로컬)

| 파일 | 변경 |
| --- | --- |
| `backend/app/services/gate_epoch.py` (신규, 154줄) | `read_snapshot()` — `/model-snapshot` 조회·검증(`ready is True`, `epoch` = `[0-9a-f]{32}`, `models.data` 비어있지 않음). `epoch_for()` — 위 검증 + 설정 모델 ID가 `data[].id`에 있는지 대조. `snapshot_url()` — `proposal_provider.data_base_url` 재사용(중복 없음). `rejection_detail()` — 게이트 자신의 409만 식별 |
| `backend/app/services/proposal_provider.py` | `_headers(epoch)`로 epoch 헤더 추가, `_post(..., epoch)`. `_call()`은 paused 확인 **후** snapshot 조회 → 실패 시 `SnapshotError.failure`로 즉시 반환 → 헤더 전송. 409는 `rejection_detail()`로 갈라 `upstream_status` + `detail=model_epoch_mismatch` |
| `backend/app/services/prompt_compose.py` | 동일한 3줄 변경(중복 통합은 하지 않음 — 요청대로 최소 범위) |
| `backend/app/api/*` | **변경 없음.** 기존 `Failure` 어휘를 그대로 쓰므로 매핑 테이블(`FAILURE_MESSAGES`/`PROVIDER_MESSAGES`)과 프론트의 `FAILURE_BY_CODE` 계약이 그대로 유지된다 |
| `backend/tests/conftest.py` | 게이트를 흉내내는 모든 transport가 `/model-snapshot`을 답하도록 `snapshot()` 헬퍼 추가 |
| `backend/tests/test_gate_epoch.py` (신규, 24 테스트) | 승인된 8개 시나리오 전부 |

**API 오류 매핑** — 새 상태 코드를 만들지 않았다. 이유: `api/proposals.py:73`이 `FAILURE_MESSAGES[failure]`로 **직접 인덱싱**하므로 코드 추가는 두 dict + 프론트 매핑을 동시에 건드려야 하고, 프론트는 미지의 `why`를 이미 `provider_error`로 안전하게 떨어뜨린다. 따라서 `why`는 기존 값을 유지하고 `detail`로 원인을 구분한다:

| 상황 | `why` | `detail` | HTTP |
| --- | --- | --- | --- |
| snapshot paused / 409 | `admission_paused` | `snapshot_not_ready` | 200 (compose는 503) |
| snapshot 연결·타임아웃·형식 오류 | `gate_unreachable` | `snapshot_<예외명>` / `snapshot_not_json` / `snapshot_invalid_epoch` / `snapshot_invalid_models` / `snapshot_no_model` / `snapshot_http_<n>` | 200 |
| 설정 모델 ≠ 서빙 모델 | `not_configured` | `configured_model_unavailable: served=<게이트가 실제로 서빙하는 id>` | 503 |
| 호출 직후 게이트가 409 | `upstream_status` | `model_epoch_mismatch` | 200 (재시도 없음) |

**하지 않는 것(구현에도 반영)**: epoch 하드코딩, 409 자동 재시도, `/model-snapshot` 결과 캐싱, 게이트 코드 수정, `--alias` 추가.

### 실제 `/model-snapshot` 응답 계약 (운영 관측 기준)

```json
{
  "ready": true,
  "epoch": "<32 hex>",
  "models": { "object": "list", "data": [ { "id": "<weights path>", "object": "model" } ] }
}
```

구현이 **가정하지 않는** 것: `epoch`는 32자 소문자 hex만 인정(`secrets.token_hex(16)`), `models.data`는 배열이어야 하고 각 항목의 `id`가 비어있지 않은 문자열이어야 한다. 그 외 필드는 읽지 않는다. paused일 때는 `409`, 그 외 오류는 `ready: false` 또는 비정상 status로 관측됐고 두 경우 모두 "보내지 않음"으로 처리한다.

### 검증 결과 (로컬)

```
ruff check backend                         → All checks passed!
pytest backend                             → 620 passed, 96 skipped   (구현 전 596)
pytest backend/tests/test_gate_epoch.py    → 24 passed
```

승인된 8개 필수 시나리오 대응: ①정상 snapshot→헤더 전송 ②paused/409→차단 ③epoch 누락·형식 오류 5종 ④모델 ID 불일치→차단 ⑤chat 409→재시도 없음 ⑥snapshot timeout/connect 실패 3종 ⑦snapshot 후 epoch 변경→409 ⑧기존 인증 헤더·요청 계약 유지. MockTransport 결과이며 **실제 추론 성공의 증거가 아니다**.

### 운영 적용 시 필요한 환경변수

`STUDIO_LLM_MODEL=/opt/models/qwen36-35b-a3b-uncensored/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf` — 한 줄 추가뿐이다. 이 값이 `/model-snapshot`의 `data[].id`와 **정확히** 같아야 한다(다르면 `not_configured / configured_model_unavailable`로 즉시 실패한다 — 조용한 통과는 이제 없다).

### 배포·재시작 영향

- 변경 파일: `backend/app/services/gate_epoch.py`(신규), `proposal_provider.py`, `prompt_compose.py` + 테스트 4개. **API 계약·프론트 변경 없음.**
- 재시작: `bc250-ai-studio.service` 하나. gate·llama-server·모델 파일·전역 LLM 설정은 건드리지 않는다.
- 순서: epoch 코드 배포 → `STUDIO_LLM_MODEL` 설정 → **한 번의** 재시작으로 둘 다 반영. 환경변수만 먼저 넣고 재시작하지 않으면 아무 효과가 없다.
- 추가 지연: 호출당 `GET /model-snapshot` 1회(루프백, hold 미획득). 60초 예산에 영향 없음.

### 롤백 절차

1. 직전 릴리스 백업(`/var/backups/bc250-ai-studio.*`, root `0700`)에서 code를 복원한다.
2. `STUDIO_LLM_MODEL`을 제거하면 광고가 다시 꺼져 기존 동작(503 `capability_not_advertised`)으로 돌아간다 — 코드를 되돌리지 않아도 기능은 안전하게 비활성된다.
3. gate·모델 전환 journal을 삭제해 검사를 우회하지 않는다.
4. 재시작은 Studio 하나만.



## 롤백



1. 실패 시 출력된 backup 경로를 확인한다. **root 필요**(`0700`).
2. 호환되는 code·config·DB를 그 경로에서 복원한다. 이미지 자산은 백업에 없으므로 별도 정책을 따른다.
3. gate·모델 전환 journal을 삭제해 검사를 우회하지 않는다.
4. `/system/recover`는 admin 키가 필요하고 이미지 worker 생존 확인 후에만 호출한다.

## 하지 않은 것

- **`/etc/bc250-ai-studio.env` 변경·Studio 재시작**: 하지 않았다. `sudoedit`과 `systemctl restart`가 필요한 단계라 **사용자 승인 대기**다. 값만 확정해 두었다.
- **운영 Compose 호출**: 하지 않았다. 실제 추론과 GPU 점유가 발생하므로 승인 후에 한다.
- **epoch 코드 수정**: **로컬에서 구현·검증 완료**(`gate_epoch.py` + 두 provider + 24 테스트). 운영 배포는 하지 않았다.
- **push·배포**: 하지 않았다. 로컬 커밋 `630db8a`, `bb9e6ea`, `aecf4d9`만 있으며 `origin/main`보다 3커밋 앞선다.
- **llama-server 설정 변경**: 하지 않았다. `--alias`도 추가하지 않았고(재시작 필요), 모델·컨텍스트·reasoning 인자를 건드리지 않았다.
- **모델 파일·DB·이미지 자산 변경**: 하지 않았다. GPU job도 새로 만들지 않았다.
- **모바일 실기기 검증**: 계속 미완료다. 이번 작업은 데스크톱 터널 경로만 확인했다.
- **UCP09 완료 처리**: 하지 않았다. compose 단계가 503이므로 완료가 아니다.




