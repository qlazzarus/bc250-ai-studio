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

### 차단 사유와 원인

`prompt_compose`는 세 조건이 모두 참일 때만 광고된다(`prompt_compose.py:1253`): gate(`admission_url`) 존재, engine ≠ `fake`, **사전 로드 성공**. 앞의 두 조건은 충족하지만 사전 파일이 서버에 없다.

파일은 `config/prompt_dictionary.json`으로 **git에 커밋되어 있고 배포 tarball에도 들어 있다**(`git archive` 결과 확인). 그러나 설치기 `deploy/deploy-release.sh`의 복사 목록이 `config/models.yaml` 하나뿐이라 **디렉터리에서 그 파일만 빠진 채 배포**된다. 사전이 없으면 `load_dictionary`가 `None`을 돌려주고 서버는 "이 배포는 compose 불가"로 정상 응답한다 — 오류가 아니라 **조용한 기능 상실**이다.

이번 세션에서 설치기 복사 목록을 `config` 전체로 넓히고 사전 파일 존재를 배포 전제조건으로 추가했다. 다만 **아직 서버에 배포하지 않았으므로 운영은 여전히 차단 상태**다.

## 배포 전 기준점

- 코드 기준점은 `c82bae5`(로컬 `main`, tag `ucp08-baseline`)이다. 그 부모 `a2d9038`은 origin/main과 동기이며 backend가 운영과 바이트 단위로 같아서 **지금 운영에서 관찰되는 동작이 곧 `a2d9038`의 동작**이다.
- `c82bae5`는 설치기 수정·점검 스크립트·문서만 담는다(제품 런타임 코드 변경 없음). **아직 push하지 않았으므로 운영에는 반영되지 않았다.**
- 롤백 재료: `/var/backups/bc250-ai-studio.Iwye5Waq` 등 릴리스 백업이 있고, 설치기는 code/config/DB 사본을 만든 뒤 교체한다. **백업 디렉터리는 `0700`이라 열람에 root가 필요하다.**
- 덮어쓰지 않는 것: `config/models.yaml`은 로컬·서버 sha256이 같아 교체해도 변화가 없다. `.env`·DB·이미지 자산·모델 파일은 설치기 대상이 아니다(`/etc/bc250-ai-studio.env`, `/opt/ai-studio-data`, `/opt/sd-models`).
- **주의**: 설치기가 `config` 디렉터리를 통째로 교체하므로 서버에만 있는 `config/models.yaml.bak.20261113104948` 같은 과거 파일은 사라진다. 교체 직전 `$app/config`가 백업에 `cp -a`되므로 복구는 가능하지만, 이 파일을 계속 두려면 배포 전에 `/var/backups` 밖으로 옮긴다.

### 배포 위험 (반드시 먼저 확인)

`.github/workflows/deploy.yml`은 **main push에 자동 배포**된다. 이전 커밋 `a2d9038`이 이미 push되어 11:58에 배포되었다. 즉 커밋과 배포를 분리할 수 없다.

- 수정을 **커밋만 하고 push하지 않으면** 운영은 바뀌지 않는다(기준점 보존).
- push하면 설치기가 돌아 **Studio가 재시작**된다(무중단 아님, 진행 중 작업은 `interrupted`로 전환될 수 있음). gate·llama·model-worker는 재시작 대상이 아니다.
- 따라서 **push 시점에 사용자 승인이 필요하다.**

## 읽기 전용 점검

```sh
scripts/ucp09/inspect-bc250.sh          # 호스트 인벤토리, 변경 없음
scripts/ucp09/verify-tunnel.sh          # 터널 경로 검증, 변경 없음
```

`inspect-bc250.sh`는 `systemctl show/is-active`, `ss -lntp`, `find`, `vulkaninfo --summary`, `/proc/<pid>/cmdline`, loopback GET만 사용한다. sudo를 쓰지 않고, 서비스를 재시작·활성화하지 않으며, job을 넣지 않는다. root 없이 못 읽는 경로는 "unreadable"로 표시하고 권한 상승을 시도하지 않는다.

이번 실행에서 확인된 두 가지 한계:

- `sudo`는 **비밀번호가 필요**하다. NOPASSWD는 `systemctl restart bc250-llm-client.service`, `bc250-ai-studio-deploy`, `bc250-studio-coordinated-deploy ""` 세 개뿐이다. 따라서 `/opt/ai-studio-data`(0700 ai-studio)와 `/var/backups/*`(0700 root)는 사용자 세션에서 읽을 수 없다.
- gate의 `/health`·`/status`는 **409**를 돌려준다(게이트 자체 프로토콜). 200이 아니라고 해서 게이트가 죽은 것은 아니다.

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


