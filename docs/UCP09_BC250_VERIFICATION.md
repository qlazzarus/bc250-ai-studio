# UCP09 실환경 검증 절차 (BC-250)

이 문서는 **실제 BC-250 호스트에서 UCP09를 수행하기 위한 절차**다. 2026-11-23에 읽기 전용 점검만 수행했고, **UCP09는 아직 완료가 아니다.** 아래 「차단 사유」가 해소되기 전에는 compose 단계를 실행할 수 없다.

## 현재 상태 (2026-11-23 읽기 전용 확인)

| 항목 | 실측값 | 판정 |
| --- | --- | --- |
| 호스트 | Fedora 43, `6.17.1-300.fc43.x86_64`, uptime 2일 | BC-250 실환경 확인 |
| GPU | `AMD Radeon Graphics (RADV GFX1013)`, Mesa 25.2.4, `amdgpu` 로드 | 실제 GPU 인식 |
| LLM | `Qwen3.6-35B-A3B…IQ2_M.gguf`, `-c 16384`, `n_ctx` 16384, `--reasoning auto` | `/health` ok |
| 이미지 엔진 | `sd-cli` 83,416,008 bytes, sha256 `810d7659…7ef3b` | 설치됨 |
| Studio | `sdcpp`, `simulated: false`, `policy: chat_priority` | 기존 코드가 배포됨 |
| 배포 버전 | `a2d9038`(운영)와 backend 54개 파일 **sha256 전부 일치** | 코드 기준점 = 운영 |
| compose | `/api/v1/prompt/compose` → **503 `capability_not_advertised`** | **차단** |
| 사전 | `/opt/bc250-ai-studio/config/prompt_dictionary.json` **없음** | 차단 원인 |
| 설치기 | 호스트 `f1400e90…` ≠ 저장소 `8718137e…` | **배포 차단 (hash guard)** |

### 차단 사유와 원인

`prompt_compose`는 세 조건이 모두 참일 때만 광고된다(`prompt_compose.py:1253`): gate(`admission_url`) 존재, engine ≠ `fake`, **사전 로드 성공**. 앞의 두 조건은 충족하지만 사전 파일이 서버에 없다.

파일은 `config/prompt_dictionary.json`으로 **git에 커밋되어 있고 배포 tarball에도 들어 있다**(`git archive` 결과 확인). 그러나 설치기 `deploy/deploy-release.sh`의 복사 목록이 `config/models.yaml` 하나뿐이라 **디렉터리에서 그 파일만 빠진 채 배포**된다. 사전이 없으면 `load_dictionary`가 `None`을 돌려주고 서버는 "이 배포는 compose 불가"로 정상 응답한다 — 오류가 아니라 **조용한 기능 상실**이다.

이번 세션에서 설치기 복사 목록을 `config` 전체로 넓히고 사전 파일 존재를 배포 전제조건으로 추가했다. 다만 **아직 서버에 배포하지 않았으므로 운영은 여전히 차단 상태**다.

## 배포 전 기준점

- 코드 기준점은 `9a6cf1e`(origin/main, tag `ucp08-baseline`)이다. 그 조상 `a2d9038`은 backend가 운영과 바이트 단위로 같아서 **지금 운영에서 관찰되는 동작이 곧 `a2d9038`의 동작**이다.
- `c82bae5`·`9a6cf1e`는 설치기 수정·점검 스크립트·문서만 담는다(제품 런타임 코드 변경 없음). `b9dddc5`는 배포 테스트 수정이다.
- **push는 이미 발생했고, 배포는 CI가 막았다.** `c82bae5`가 push되자 CI의 `pytest scripts/test_studio_static_deploy.py` 단계가 실패했고(`IndexError`), 이후 단계(패키징·배포)가 실행되지 않았다. 확인: 서버 `config/`에 사전이 여전히 없고 Studio `ActiveEnterTimestamp`도 11:58 그대로다. 즉 **테스트가 배포 게이트로 실제 작동했다.**
- 롤백 재료: `/var/backups/bc250-ai-studio.Iwye5Waq` 등 릴리스 백업이 있고, 설치기는 code/config/DB 사본을 만든 뒤 교체한다. **백업 디렉터리는 `0700`이라 열람에 root가 필요하다.**
- 덮어쓰지 않는 것: `config/models.yaml`은 로컬·서버 sha256이 같아 교체해도 변화가 없다. `.env`·DB·이미지 자산·모델 파일은 설치기 대상이 아니다(`/etc/bc250-ai-studio.env`, `/opt/ai-studio-data`, `/opt/sd-models`).
- 배포 스테이지는 `git archive HEAD ... config`로 만들어지므로 **추적되는 파일만** 서버에 도달한다(`config/models.yaml`, `config/prompt_dictionary.json`, `config/settings.example.yaml`). `config/settings.yaml`은 gitignore 대상이라 애초에 포함되지 않는다.
- **주의**: 설치기가 `config` 디렉터리를 통째로 교체하므로 서버에만 있는 `config/models.yaml.bak.20261113104948` 같은 과거 파일은 사라진다. 교체 직전 `$app/config`가 백업에 `cp -a`되므로 복구는 가능하지만, 이 파일을 계속 두려면 배포 전에 `/var/backups` 밖으로 옮긴다.

### 배포 위험 (반드시 먼저 확인)

`.github/workflows/deploy.yml`은 **main push에 자동 배포**된다. 다만 배포는 마지막 잡의 마지막 단계라, 그 앞의 테스트·패키징 단계가 실패하면 **배포까지 도달하지 않는다**. 이번에 실제로 그렇게 막혔다(서버 `config/`에 사전 없음, Studio 11:58 그대로).

- 수정을 **커밋만 하고 push하지 않으면** 운영은 바뀌지 않는다(기준점 보존).
- push하면 CI를 통과한 경우에만 설치기가 돌아 **Studio가 재시작**된다(무중단 아님, 진행 중 작업은 `interrupted`로 전환될 수 있음). gate·llama·model-worker는 재시작 대상이 아니다.
- **설치기를 수정했다면 설치기가 CI의 hash guard에 걸린다.** `deploy/deploy-release.sh`를 바꾼 릴리스는 호스트의 설치기를 먼저 갱신해야 한다(「설치기 배포」 항목).
- push하기 전에 **CI와 동일한 명령을 로컬에서 먼저 통과시킨다**: `uv run pytest -q scripts/test_studio_static_deploy.py`, `uv run ruff check backend`, `bash -n deploy/deploy-release.sh`.
- 즉 "커밋과 배포를 분리할 수 없다"는 것은 **push까지 했을 때**의 이야기이고, push 자체는 사용자 승인 사항이다.

## 읽기 전용 점검

```sh
scripts/ucp09/inspect-bc250.sh          # 호스트 인벤토리, 변경 없음
scripts/ucp09/verify-tunnel.sh          # 터널 경로 검증, 변경 없음
```

`inspect-bc250.sh`는 `systemctl show/is-active`, `ss -lntp`, `find`, `vulkaninfo --summary`, `/proc/<pid>/cmdline`, loopback GET만 사용한다. sudo를 쓰지 않고, 서비스를 재시작·활성화하지 않으며, job을 넣지 않는다. root 없이 못 읽는 경로는 "unreadable"로 표시하고 권한 상승을 시도하지 않는다.

이번 실행에서 확인된 세 가지 한계:

- `sudo`는 **비밀번호가 필요**하다. NOPASSWD는 `systemctl restart bc250-llm-client.service`, `bc250-ai-studio-deploy`, `bc250-studio-coordinated-deploy ""` 세 개뿐이다. 따라서 `/opt/ai-studio-data`(0700 ai-studio)와 `/var/backups/*`(0700 root)는 사용자 세션에서 읽을 수 없다.
- gate의 `/health`·`/status`는 **409**를 돌려준다(게이트 자체 프로토콜). 200이 아니라고 해서 게이트가 죽은 것은 아니다.
- **배포 테스트가 복사 목록 문자열을 그대로 인용하고 있었다.** `test_backend_and_frontend_are_replaced_together`는 `"for item in backend config/models.yaml frontend/dist"`를 `split`해서 스크립트 일부를 떼어냈다. 목록을 `config` 전체로 넓히자 `split`이 빈 리스트를 돌려주어 **아무것도 검사하지 않고 `IndexError`로 죽었다.** 이는 "검사하는 척하는 테스트"의 전형이라, 복사 목록을 스크립트에서 **파싱**하고 결과 파일 트리로 판정하도록 고쳤다(`scripts/test_studio_static_deploy.py`). 사전이 호스트에 도달하는지 확인하는 테스트도 추가했다.

## 설치기 배포 (hash guard)

CI는 릴리스 업로드 **전에** `/usr/local/sbin/bc250-ai-studio-deploy`의 sha256이 저장소의 `deploy/deploy-release.sh`와 같은지 확인하고, 다르면 다음 메시지로 멈춘다.

```
Install the reviewed deploy/deploy-release.sh on the server first.
```

이번에 설치기를 고쳤으므로 이 검사에 걸렸다. 실측 차이:

| 위치 | sha256 | 대응 커밋 |
| --- | --- | --- |
| 호스트 `/usr/local/sbin/bc250-ai-studio-deploy` | `f1400e90…ab442775` | `14439eb` (2026-11-15) |
| 저장소 `deploy/deploy-release.sh` | `8718137e…cf4c364` | `c82bae5` (현재) |

차이는 의도한 2개 hunk뿐이다(+10/−2): `config` 디렉터리 전체 복사, 사전 파일 전제조건.

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

이번 실행 결과(`verify-tunnel.sh`): **12 checks, 0 failed**. 터널 루트 200, `Server: Caddy`, 해시된 번들·CSS 200, 비인증 health 401(프록시가 FastAPI까지 도달), 인증 capabilities/models/jobs 200, SSE 경로 404(터널 통과), **이미지 다운로드 200 · 497,221 bytes**, Studio/gate/llama 포트 loopback 전용.

주의: 클라이언트 키는 설계상 브라우저 번들에 포함된다(`VITE_STUDIO_API_KEY`). 스크립트는 이 키를 번들에서 읽어 쓰되 출력하지 않는다. **admin/gate 키를 쓰지 않는다.**

## UCP09 검증 순서

각 단계는 **실제 출력**과 **Mock 결과**를 구분해 기록한다. Mock 통과를 실연결 성공으로 대체하지 않는다.

| # | 단계 | 현재 가능 여부 |
| --- | --- | --- |
| 1 | 실제 llama-server 연결 확인 | **가능** — `/health` ok, `n_ctx` 16384 |
| 2 | 고정 평가 사례 4건 Compose 요청 | **차단** — 사전 없음(503) |
| 3 | 1~3개 후보 생성·JSON 계약 검증 | **차단** — 2에 종속 |
| 4 | 의미 보존·인물 귀속·제외 조건 평가 | **차단** — 사람 판정 필요 |
| 5 | 실패·timeout·GPU Gate 복구 | 부분 가능 — gate busy는 재현 가능, compose timeout은 2 이후 |
| 6 | SD1.5 이미지 생성 | **가능** — `realistic-vision-v6`이 `tested` |
| 7 | 나머지 설치 모델별 생성 | 가능 — `klein-4b-q4`·`pornmaster-klein-9b`·`moss-image-nsfw` tested, `-q8`·`z-image-*`는 configured |
| 8 | 성능·품질 정리 | 6~7 이후 |

### 사전 배치 절차 (차단 해소 순서)

세 단계이며, 앞 단계가 끝나야 다음이 가능하다.

```sh
# 1) 설치기를 호스트에 설치한다 (sudo 비밀번호 필요, hash guard 해소)
scripts/ucp09/install-deployer.sh --apply

# 2) CI를 통과시켜 배포한다. 설치기가 config 전체를 복사하므로 사전이 함께 도착한다.
#    push 전에 CI와 같은 검사를 로컬에서 먼저 돌린다.
uv run pytest -q scripts/test_studio_static_deploy.py
uv run ruff check backend
git push origin main

# 3) 배포 후 광고 여부를 확인한다.
curl -sS -H "Authorization: Bearer $CLIENT_KEY" \
  http://127.0.0.1:18080/api/v1/system/capabilities | grep -o '"prompt_compose"'
```

1단계를 건너뛰면 CI가 `Install the reviewed deploy/deploy-release.sh on the server first.`로 멈춘다(배포 없음, 운영 무변경).

### 2단계 실행 (사전 배치 후)

```sh
# 1) 사전이 배포되면 광고 여부를 먼저 확인한다.
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

## 롤백

1. 실패 시 출력된 backup 경로를 확인한다. **root 필요**(`0700`).
2. 호환되는 code·config·DB를 그 경로에서 복원한다. 이미지 자산은 백업에 없으므로 별도 정책을 따른다.
3. gate·모델 전환 journal을 삭제해 검사를 우회하지 않는다.
4. `/system/recover`는 admin 키가 필요하고 이미지 worker 생존 확인 후에만 호출한다.

## 하지 않은 것

- **모바일 실기기 검증**: 계속 미완료다. 이번 작업은 데스크톱 터널 경로만 확인했다.
- **Push·배포**: 하지 않았다. 수정은 커밋하지 않았고, 배포는 승인 후에 한다.
- **전역 LLM 설정 변경**: 하지 않았다. llama-server의 모델·컨텍스트·reasoning 설정을 건드리지 않았고 `bc250-llm-client.service` 재시작 권한도 쓰지 않았다.
- **UCP09 완료 처리**: 하지 않았다. compose 단계가 503이므로 완료가 아니다.


