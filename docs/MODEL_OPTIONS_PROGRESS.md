# 모델 옵션 작업 진행 기록

## T01 — 설치된 sd-cli 옵션 조사

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `docs/SDCLI_OPTIONS_AUDIT.md` — 사용자가 제공한 BC-250 `sd-cli --help`와 저장된
  인벤토리를 바탕으로 옵션·기본값·선택지·미확인 범위를 정리했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T01 진행 기록을 생성했다.

### 확인 결과

- 전달된 실제 help는 `/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli`의
  `master-1000-95ff762`, commit `95ff762`임을 보인다.
- CFG, negative prompt, sampler, scheduler, distilled guidance, CLIP skip, flow shift,
  VAE tiling/tile size와 보조 sampler 인자가 설치 바이너리 help에 있다.
- sampler와 scheduler의 전체 enum, CLI 기본값, VAE tile 형식은 감사 문서에 기록했다.
- `--cfg-scale`과 `--guidance`는 서로 다른 옵션이다.
- Studio는 현재 steps/CFG/seed/negative prompt를 argv로 전달할 수 있으나,
  Registry가 모델별 `supported_parameters`로 변경을 제한한다.

### 검증

- 사용자가 제공한 299줄 `sd-cli --help` 출력과 `bc250-verified.json`,
  `docs/BC250_ENVIRONMENT.md`, 엔진/레지스트리 코드를 읽어 대조했다.
- 실제 이미지 생성, GPU 호출, 서비스 재시작, 배포, 코드 구현은 수행하지 않았다.
- 이 태스크는 문서 조사이므로 pytest/ruff/frontend 빌드는 실행하지 않았다.

### 후속 확인

- 사용자가 2026-10-26에 제공한 `sha256sum` 결과가
  `810d7659c064afab8bacf9b88176d24c82d73561926b79ae610b3b8fa037ef3b`와 일치했다.
  현재 설치 바이너리와 T01 help 출력의 결속은 확인됐다.

### 남은 불확실성

- 저장소에 설치 commit `95ff762`의 stable-diffusion.cpp 소스가 없어 옵션 파서와
  체크포인트별 적용 로직을 직접 검증하지 못했다.
- CLI가 옵션을 인식한다는 사실은 PornMaster Klein, Klein, Z-Image, Realistic Vision에서
  해당 옵션이 효과적이거나 변경 가능하다는 증거가 아니다.

### 다음 태스크 입력

T02를 수행할 수 있다. `docs/SDCLI_OPTIONS_AUDIT.md`를 출발점으로, 각 체크포인트의
제작자 자료와 현재 `config/models.yaml`을 대조해 모델별 capability·기본값·허용 범위,
API 요청/응답 계약, `cli_args` 충돌 규칙을 확정해야 한다. 실제 GPU 추론은 수행하지 않는다.

## T02 — 체크포인트별 적용 표와 API 계약 확정

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `docs/MODEL_OPTIONS_CONTRACT.md` — 모델별 capability, 1차 API/UI 범위,
  argv 충돌 규칙, queue/metadata 호환성 계약을 정의했다.
- `docs/SDCLI_OPTIONS_AUDIT.md` — 사용자가 제공한 SHA-256 재확인으로 현재 help와
  설치 바이너리의 결속 상태를 갱신했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T02 결과를 기록했다.

### 확정한 계약

- PornMaster FLUX.2 Klein v4 Turbo Q4_K는 CFG `1.0`, `1.5`, `2.0`만
  `experimental`로 노출한다. 비어 있지 않은 negative prompt는 CFG `2.0`에서만
  수락한다. sampler는 Euler 고정, scheduler는 생략한다.
- Klein 4B Q4/Q8, Z-Image Turbo/NSFW v2는 기존 CFG 1/Euler를 고정으로 유지한다.
  Z-Image Turbo의 공식 Diffusers guidance 0을 sd-cli CFG 0으로 번역하지 않는다.
- Realistic Vision V6는 기존 CFG/negative prompt/Euler 조합을 유지한다. 모델 카드의
  DPM++/Karras 추천을 sd-cli enum으로 자동 매핑하지 않는다.
- 다음 API 후보 필드는 optional `sampling_method`, `scheduler`다. 현 계약에서는
  사용자 변경을 허용하는 모델이 없으며, 필드 생략은 기존 argv/CLI 기본값을 보존한다.
- `/models`에 추가할 optional `generation_options` 응답 구조와 fixed/experimental/
  verified 상태, 과거 job/retry/metadata fallback을 정의했다.

### 검증

- BC-250 `sd-cli` SHA-256은 이전 인벤토리와 일치하는 것으로 사용자가 재확인했다.
- 현재 `config/models.yaml`, Registry, schema, sd-cli adapter, BC-250 실행 기록과
  공식/배포 모델 카드를 대조했다.
- 구현, pytest/ruff/frontend build, 실제 GPU 추론, 서비스 재시작, 배포는 수행하지 않았다.

### 남은 불확실성

- PornMaster의 CFG 조합은 배포자 근거는 있지만 BC-250 `sd-cli` 실기 검증이 없다.
- Z-Image NSFW v2의 정확한 제작자 모델 카드와 권장 옵션은 미확인이다.
- Realistic Vision의 DPM++ SDE / Karras 명칭을 설치 sd-cli의 정확한 sampler/scheduler
  조합으로 매핑할 근거가 없다.
- 설치 commit `95ff762`의 source tree는 로컬에 없어 모델별 내부 적용 코드는 직접
  검증하지 못했다.

### 다음 태스크 입력

T03은 `docs/MODEL_OPTIONS_CONTRACT.md`의 `generation_options` 구조를
`config/models.yaml` 및 Registry 타입으로 구현하고 `/models`에 additive 응답으로
노출한다. API 요청 schema나 sd-cli argv 변환은 T04까지 구현하지 않는다.

## T03 — 모델 capability 레지스트리 구현

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `config/models.yaml` — 모든 등록 모델에 타입 검증 가능한 `generation_options`를
  추가했다. PornMaster는 CFG `1.0`/`1.5`/`2.0`과 CFG 2.0에서만 가능한 experimental
  negative prompt 조건을 기록했다. 나머지 sdcpp 모델은 현재의 fixed CFG/Euler 및
  scheduler 생략을 명시했고, Fake/Realistic Vision은 기존 CFG/negative prompt
  범위를 verified로 표시했다.
- `backend/app/services/registry.py` — capability Pydantic 모델과 구형 YAML용 보수적
  fallback을 추가했다. `/models`와 단건 모델 조회가 기존 필드를 유지한 채
  `generation_options`를 반환한다.
- `backend/tests/test_api.py` — capability 응답, PornMaster의 아직 비활성인 CFG
  admission 상태, 레거시 YAML fallback, 잘못된 capability 상태의 타입 거절 회귀
  테스트를 추가했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T03 결과를 기록했다.

### 구현 결과

- `generation_options`는 `cfg_scale`, `negative_prompt`, `sampling_method`,
  `scheduler` 각각에 mode/default/allowed_values/조건/note를 담는다. 연속 CFG 범위가
  이미 존재하는 Fake와 Realistic Vision에는 `minimum`/`maximum`을 함께 사용한다.
- `supported_parameters`와 `Registry.resolve()`는 변경하지 않았다. 따라서 PornMaster의
  experimental capability가 `/models`에 보이더라도 CFG 변경이나 negative prompt가
  T04 전에 요청 실행 경로로 새롭게 허용되지는 않는다.
- capability가 없는 이전 운영자 YAML은 현재 preset과 `cli_args`에서 읽은 보수적 fixed
  기본 capability로 정규화되어, 기존 YAML 로딩과 배열형 `/models` 응답을 유지한다.

### 검증

- `.venv/bin/pytest` — **60 passed**.
- `.venv/bin/ruff check backend/app/services/registry.py backend/tests/test_api.py` — 통과.
- 실제 GPU 추론, systemd 서비스 조작, 재시작, 배포는 수행하지 않았다.
- 운영 API 키가 없는 로컬 셸에서 별도 `Settings()` 기반 수동 Registry 확인은 설정 검증에서
  중단됐다. 테스트 fixture는 명시적인 테스트 키를 제공하며 동일 Registry 및 `/models`
  경로를 검증한다.

### 남은 불확실성

- PornMaster의 experimental CFG/negative prompt 조합은 API/argv 연결(T04) 및 명시적인
  BC-250 GPU 검증(T08) 전까지 실행 가능 또는 품질 검증 완료를 뜻하지 않는다.
- sampler/scheduler 변경 capability는 어떤 sdcpp 모델에도 아직 노출하지 않았다.
- Z-Image NSFW v2 제작자 권장 옵션 및 Realistic Vision의 DPM++/Karras `sd-cli` 매핑은
  여전히 미확인이다.

### 다음 태스크 입력

T04는 `JobRequest`에 계약상 optional 요청 필드를 추가하고, `Registry.resolve()`에서
PornMaster CFG/negative prompt 조건과 sampler/scheduler 고정값을 검증한 뒤, sdcpp argv에
중복 없이 연결해야 한다. 구형 queue spec/model snapshot의 `cli_args` fallback을 유지하고,
GPU 실행은 하지 않는다.

## T04 — API 검증과 sd-cli 인자 전달 구현

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `backend/app/models/schemas.py` — optional `sampling_method`, `scheduler`를 설치된
  `sd-cli`의 정확한 enum으로 추가했다. `normal` 같은 CLI alias 및 임의 문자열은 request
  schema에서 거절한다.
- `backend/app/services/registry.py` — capability를 단일 옵션 정책으로 사용해 CFG,
  negative prompt 조건, sampler, scheduler를 resolve 시점에 검증하고 정규화한다.
- `backend/app/engines/sdcpp.py` — 새 spec의 sampler/scheduler가 모델 `cli_args`와
  중복되지 않게 기존 같은 옵션을 제거하고 정확히 한 번 argv로 추가한다. 키가 없는 과거
  spec은 기존 `cli_args`를 그대로 사용한다.
- `backend/tests/test_api.py`, `backend/tests/test_sdcpp.py` — enum/fixed-option 거절,
  PornMaster 허용·거절 조건, argv 단일 출력 및 legacy spec fallback 회귀 테스트를 추가했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T04 결과를 기록했다.

### 구현 결과

- PornMaster는 CFG `1.0`, `1.5`, `2.0`을 수락하고, 비어 있지 않은 negative prompt는
  CFG `2.0`에서만 수락한다. 그 외 CFG 및 조건 위반은 작업 enqueue 전에 422로 반환된다.
- 모든 현재 모델은 capability의 fixed sampler/scheduler 정책을 적용한다. sampler가
  생략되면 해당 모델의 resolved default(Euler)를 spec에 동결하고, scheduler 생략은
  `null`로 유지해 `--scheduler`를 출력하지 않는다.
- `sampling_method`/`scheduler`가 새 spec에 있으면 엔진 argv에는 각 flag가 최대 한 번만
  존재한다. 과거 queue spec에 키가 없으면 model snapshot의 기존 `cli_args` 의미를 보존한다.
- request 전체가 기존과 같이 job spec에 저장되고 retry는 spec deepcopy를 사용하므로,
  새로 resolve된 옵션도 queue 및 retry의 동결 경로를 따른다. metadata는 runner가 job spec을
  그대로 복사하는 기존 경로를 사용한다.

### 검증

- `.venv/bin/pytest` — **63 passed**.
- `.venv/bin/ruff check backend/app backend/tests` — 통과.
- 테스트는 PornMaster production 파일을 요구하지 않도록 fake engine으로 registry
  admission/argv 정책만 검증했다. 실제 BC-250 GPU 추론, systemd 서비스 조작, 재시작,
  배포는 수행하지 않았다.

### 남은 불확실성

- PornMaster CFG/negative prompt 조합은 API·argv까지 연결됐지만 BC-250 `sd-cli` 실기
  결과 및 품질 검증은 T08의 명시적 GPU 승인 전까지 없다.
- sampler/scheduler 변경 capability는 현재 어떤 모델에도 없으므로, enum은 향후 호환을
  위한 schema 검증 범위일 뿐 사용자가 다른 sampler/scheduler를 선택할 수는 없다.
- 구형 DB job/asset metadata의 실제 마이그레이션·조회·설정 재사용 흐름은 T05에서
  전용 회귀 테스트로 추가 확인해야 한다.

### 다음 태스크 입력

T05는 request → resolved spec → job 조회 → asset metadata → retry 경로에서
`cfg_scale`, `negative_prompt`, `sampling_method`, `scheduler`, `model_snapshot`이
보존되는지 전용 회귀 테스트로 추적한다. 누락이 확인된 경우에만 최소 보완하고, 과거 DB
레코드의 키 누락은 안전하게 읽도록 해야 한다. 실제 GPU 실행은 하지 않는다.

## T05 — 큐·결과 메타데이터·재시도 호환 검증 및 보완

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `backend/app/api/routes.py` — asset metadata 조회에서 T04 이전 record에 없는
  `sampling_method`와 `scheduler`를 읽기 전용 응답상 `null`로 정규화했다. 기존 DB 및
  JSON metadata 파일을 변경하지 않는다.
- `backend/tests/test_api.py` — resolved option이 job 조회, model snapshot, asset metadata,
  실패 후 retry에 유지되는지와 키가 없는 구형 job/asset record의 조회·retry 호환성을
  추가 검증했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T05 결과를 기록했다.

### 확인 결과

- `enqueue()`는 resolve된 spec 전체를 Job JSON에 저장하고, scheduler는 그 spec 전체를
  asset details/sidecar metadata에 복사한다. retry는 동일 spec을 deepcopy하므로 현재
  레지스트리 또는 새 기본값으로 재해석하지 않는다.
- dedicated fake-engine test에서 CFG, negative prompt, sampler, scheduler, model snapshot이
  실패 job → retry job → 생성 asset metadata까지 동일하게 보존됐다.
- 구형 spec에서 새 키를 의도적으로 제거해도 `JobView`는 `null` 기본값으로 조회되고,
  retry는 누락 상태와 기존 model snapshot을 유지한다. 구형 asset metadata도 API에서
  두 키를 `null`로 반환한다.
- DB schema 변경이나 migration은 필요하지 않았다. 신규 값은 기존 JSON `spec`/`details`
  컬럼에 저장된다.

### 검증

- `.venv/bin/pytest` — **65 passed**.
- `.venv/bin/ruff check backend/app backend/tests` — 통과.
- 실제 GPU 추론, systemd 서비스 조작, 재시작, 배포는 수행하지 않았다.

### 남은 불확실성

- 프런트엔드는 아직 capability를 사용하거나 metadata의 sampler/scheduler를 표시·재사용하지
  않는다. 이는 T06 범위다.
- PornMaster experimental 조합의 BC-250 품질/안정성 실기 검증은 여전히 T08의 별도 명시적
  GPU 승인 대상이다.

### 다음 태스크 입력

T06은 `/models` capability를 기반으로 프런트엔드의 모델별 옵션 UI를 구현해야 한다.
PornMaster CFG와 조건부 negative prompt만 편집 가능하게 하고, 고정 모델은 값과 사유를
표시하며 미지원 sampler/scheduler를 전송하지 않아야 한다. metadata 상세와 ‘이 설정으로
다시 생성’에도 저장된 option을 연결하고, 구형 metadata의 null 값을 안전하게 처리한다.
backend/frontend lint·build는 T06 범위에서 실행하되 GPU 작업은 제출하지 않는다.

## T06 — 모델별 프런트엔드 옵션 구현

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `frontend/src/api.ts` — `/models`의 optional `generation_options` 및 job/asset metadata의
  optional sampler/scheduler 타입을 추가했다. 구형 서버/metadata의 누락 또는 `null`을
  허용한다.
- `frontend/src/App.tsx` — capability 기반으로 CFG·negative prompt를 표시·검증하고,
  모델/프리셋 변경 때 모델 전용 값을 초기화했다. 고정 sampler/scheduler는 표시만 하며
  변경 불가 값을 payload에 전송하지 않는다. metadata 상세와 ‘이 설정으로 다시 생성’도
  sampler/scheduler를 읽고 재사용한다.
- `frontend/src/styles.css` — capability 상태와 고정 옵션 설명을 위한 스타일을 추가했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T06 결과를 기록했다.

### 구현 결과

- PornMaster에서는 CFG가 `1.0`/`1.5`/`2.0` 선택 UI로 표시된다. non-empty negative prompt는
  CFG 2.0일 때만 활성화되며, 다른 CFG로 바꾸면 입력을 비워 유효하지 않은 조합을 전송하지
  않는다. experimental 상태와 BC-250 실기 미검증 문구를 함께 표시한다.
- Realistic Vision 및 Fake의 verified CFG 범위는 수치 입력을 유지하고, Klein/Z-Image의
  fixed CFG는 비활성화된 현재 값과 이유를 표시한다.
- 모델 전환은 negative prompt, sampler, scheduler 등 모델 전용 값을 초기화한다. preset
  전환은 preset CFG를 적용하고 조건을 만족하지 않는 negative prompt를 제거한다.
- fixed sampler/scheduler는 현재 값 또는 CLI 기본값(생략)을 표시한다. 현재 capability에는
  사용자 변경 가능한 sampler/scheduler가 없으므로 해당 필드는 API payload에 보내지 않는다.
- 구형 metadata의 null sampler/scheduler는 상세 화면에서 각각 ‘기록 없음 · 모델 기본값’과
  ‘CLI 기본값 (생략)’으로 보이며, 재사용 시 null로 안전하게 처리된다.

### 검증

- `npm --prefix frontend run lint` — 통과.
- `npm --prefix frontend run build` — 통과 (`tsc -b`, Vite production build).
- `.venv/bin/pytest` — **65 passed**.
- `.venv/bin/ruff check backend/app backend/tests` — 통과.
- 별도 React UI 테스트 러너는 프로젝트에 구성되어 있지 않다. capability 타입과 조건부
  payload는 TypeScript build로, API/metadata 동결 경로는 fake-engine backend 회귀 테스트로
  확인했다.
- 실제 GPU 추론, systemd 서비스 조작, 재시작, 배포는 수행하지 않았다.

### 남은 불확실성

- PornMaster experimental CFG/negative prompt 조합은 실제 BC-250에서 아직 생성·품질·메모리
  검증을 하지 않았다.
- sampler/scheduler 사용자 변경 UI는 capability가 검증된 모델이 생길 때까지 의도적으로
  추가하지 않았다.

### 다음 태스크 입력

T07은 backend 전체 테스트·Ruff와 frontend lint/build를 다시 실행하고, `/models` → UI →
request → resolved spec → argv → metadata/retry의 값 보존 근거를 통합 기록해야 한다.
`docs/API.md`, `docs/MODELS.md`, `docs/TESTING.md`를 실제 구현에 맞게 갱신한다. 실제 GPU
검증, 서비스 재시작, 번들 배포는 수행하지 않는다.

## T07 — 통합 검증과 인계 문서 마무리

상태: 완료  
완료일: 2026-10-26

### 변경 파일

- `docs/API.md` — optional sampler/scheduler request enum, `/models`
  `generation_options`, PornMaster 조건부 CFG/negative prompt, spec/snapshot/metadata/retry
  동결 및 구형 record `null` 호환성을 문서화했다.
- `docs/MODELS.md` — 모델별 generation capability와 fixed/experimental/verified 의미,
  실기 미검증 경계를 현재 YAML/Registry 정책에 맞춰 갱신했다.
- `docs/TESTING.md` — 2026-10-26 통합 검사 결과와 capability → request → argv →
  metadata/retry 회귀 테스트 매핑을 추가했다.
- `docs/MODEL_OPTIONS_PROGRESS.md` — T07 완료 기록을 추가했다.

### 통합 값 추적 근거

| 경로 | 구현 및 회귀 근거 |
| --- | --- |
| `/models` → UI | Registry가 typed `generation_options`를 additive 응답으로 제공하고, frontend가 이를 사용해 editable/fixed/unsupported 상태를 판정한다. `test_models_publish_typed_generation_capabilities`와 frontend TypeScript build가 이를 검증한다. |
| UI → request | UI는 편집 가능한 CFG와 조건을 충족한 negative prompt만 전송하며 fixed sampler/scheduler는 전송하지 않는다. enum/고정값 API 거절은 `test_job_option_enums_reject_sd_cli_aliases_and_fixed_scheduler`가 검증한다. |
| request → resolved spec | Registry는 PornMaster CFG 및 negative prompt 조건을 resolve 전에 검증하고 resolved 값과 model snapshot을 동결한다. `test_pornmaster_cfg_and_negative_prompt_contract_is_resolved_before_execution`이 검증한다. |
| spec → argv | sdcpp adapter는 새 sampler/scheduler flag를 하나만 출력하고 구형 spec은 legacy `cli_args`를 보존한다. `test_dynamic_sampler_and_scheduler_are_emitted_once_and_legacy_specs_keep_cli_args`가 검증한다. |
| spec → metadata/retry | scheduler가 spec을 asset metadata에 복사하고 retry가 spec deepcopy를 사용한다. 신규·구형 경로는 `test_generation_options_survive_job_metadata_and_retry` 및 `test_legacy_job_and_metadata_default_new_option_fields_without_reinterpretation`이 검증한다. |

### 검증

- `.venv/bin/pytest` — **65 passed** (Starlette TestClient의 기존 httpx deprecation warning 1건).
- `.venv/bin/ruff check backend/app backend/tests` — 통과.
- `npm --prefix frontend run lint` — 통과.
- `npm --prefix frontend run build` — 통과 (`tsc -b`, Vite production build).
- 실제 GPU 추론, systemd 서비스 조작, 재시작, 배포는 수행하지 않았다.

### 인계 상태 및 남은 불확실성

- T01~T07 구현·문서·회귀 테스트는 완료됐다. backend와 frontend는 함께 반영해야 한다.
- PornMaster experimental CFG/negative prompt 조합은 API/UI/argv 단위에서만 검증됐다.
  BC-250의 실제 이미지·품질·처리 시간·메모리·LLM 전환 영향은 아직 확인하지 않았다.
- sampler/scheduler 변경은 어떠한 production 모델에도 열지 않았다. Realistic Vision의
  DPM++/Karras 매핑과 Z-Image NSFW v2 제작자 권장값도 미확인이다.

### 다음 태스크 입력

T08은 사용자가 명시적으로 BC-250 GPU 검증을 승인한 경우에만 수행한다. 실행 전에는 모델,
해상도, seed, 옵션 조합, 이미지 수 및 LLM 전환 범위를 구체적으로 확정하고, 옵션 하나씩의
실제 argv·결과·시간·메모리 증거를 기록해야 한다. 이 기록만으로 GPU 실행, 서비스 재시작,
번들 배포 권한이 생기지는 않는다.

## T08 — 승인된 BC-250 GPU 검증

상태: 완료  
준비·완료일: 2026-10-26

### 확정 범위

- 대상은 `pornmaster-klein-9b`, 512×512, steps 4, seed 4242, Euler 고정, scheduler 생략이다.
- 순차 실행 조합은 CFG 1.0/1.5/2.0(negative prompt 없음), CFG 2.0 + benign negative prompt
  한 건으로 제한한다. 작업당 이미지 한 장이며 최대 네 장이다.
- 테스트 중 정책은 `manual`로 두고, 각 작업을 명시적으로 grant한다. 각 image job은 기존
  GPU ownership/admission/LLM pause-stop-start-resume 절차를 그대로 사용한다.
- 배포와 원격 명령은 사용자가 직접 수행한다. 자세한 중단 조건·수집 항목은
  `docs/MODEL_OPTIONS_T08_RUNBOOK.md`에 기록했다.

### 준비 단계에서 확인한 제한

- 현재 PornMaster Registry는 CFG 변경만 experimental로 허용하고 `steps`는 preset의 4로
  고정한다. 따라서 제작자 후보인 CFG 1.5/8 steps는 현 API에서 422가 되어 이 T08 범위에
  포함하지 않는다. 이를 직접 sd-cli로 우회하거나 YAML을 임의 변경하지 않는다.
- T08 완료 상태·validation status·추가 capability 승격은 실제 job/metadata/journal 결과를
  받은 뒤에만 변경한다.

### 실제 실행 결과

- 증거 디렉터리: `docs/t08-pornmaster-20261026-073336/`.
- BC-250 Studio는 `engine: sdcpp`, `simulated: false`, `manual` 정책으로 시작·종료했고
  `recovery_required: false`, `error: {}`, `active_job: null` 상태를 유지했다.
- `pornmaster-klein-9b`는 512×512 / 4 steps / Euler / scheduler 생략 / seed 4242에서 다음
  네 작업을 모두 완료했다.

| CFG | Negative prompt | Job ID | Asset ID | job 경과 시간 |
| --- | --- | --- | --- | --- |
| 1.0 | 빈 값 | `6bec2883073f4ad79f3714670a5b3f1e` | `275d58ad108f48ceaed54b8687b01737` | 49.536초 |
| 1.5 | 빈 값 | `cd9ce74c5555442fa06a37ea5bfbe185` | `d52cf546edcf4f7aa86816b6d2712dc3` | 66.290초 |
| 2.0 | 빈 값 | `731c37e8f0394f9392955473c9173ebc` | `0bba2c6595b842f391ef78aec5a36890` | 66.650초 |
| 2.0 | `avoid blur, low contrast` | `490bb708d7fc437e830d1131b47a785f` | `631215936b764e5bad4a2ee00721463a` | 66.798초 |

- 네 PNG는 모두 512×512 RGB non-interlaced이며 서로 다른 SHA-256을 가진다. metadata는
  각 요청의 CFG/negative prompt, `sampling_method: euler`, `scheduler: null`,
  `simulated: false`와 동결 model snapshot을 보존했다.
- llama-server는 전후 모두 `active`, `KillMode=control-group`, 동일 ControlGroup이었고
  MainPID는 `20924`에서 `22120`으로 변경됐다. 제어된 LLM 전환 후 복구된 증거이지만,
  제공된 Studio journal은 Uvicorn access log만 포함해 각 작업의 완전한 sd-cli argv 및
  작업별 systemd stop/start 시각은 직접 보존하지 못했다.
- GPU memory counter는 설정되지 않아 피크·idle VRAM 수치는 미측정이다.

### 결과 반영

- `config/models.yaml`에서 PornMaster의 `validation_status`를 `tested`로, 이 한정된 CFG와
  조건부 negative prompt capability를 `verified`로 승격했다.
- UI/API에 표시되는 갱신 상태는 이 변경된 config를 다음 backend/frontend 동시 배포 후에
  반영된다. 이미 실행한 T08 배포본의 snapshot은 당시 `configured`/`experimental` 상태를
  보존하며 이를 다시 쓰지 않는다.
- 8-step 레시피, 768×768, 다른 seed, sampler/scheduler 변경, negative prompt의 품질 효과,
  GPU 메모리 피크와 정확한 argv 텍스트는 여전히 미검증이다.

### 완료 후 검증

- `.venv/bin/pytest backend/tests/test_api.py backend/tests/test_sdcpp.py` — **39 passed**.
- `.venv/bin/ruff check backend/app backend/tests` — 통과.
- `npm --prefix frontend run lint` 및 `npm --prefix frontend run build` — 통과.
