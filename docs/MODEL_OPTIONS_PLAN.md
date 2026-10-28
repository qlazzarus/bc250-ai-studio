# 모델별 생성 옵션 구현 인계 계획

## 범위와 확인 결과

2026-10-26 조사. 구현이나 실제 GPU 실행은 수행하지 않았다.
구현 담당은 사용자가 선택할 **GPT 5.6 terra medium 코딩 모델**이다.
terra medium은 배포 서버나 이미지 생성 모델을 의미하지 않는다.
사용자가 아래 태스크를 하나씩 요청한다. 이 문서는 계획만 정의하며 구현을 시작하지 않는다.

현재 실행 경로는 `프런트엔드 → Studio API/Registry → 큐 spec → SdCppEngine → sd-cli`다.
조사와 설계는 반대 방향인 **설치된 sd-cli → 체크포인트별 지원 → API/엔진 → UI**로 진행한다.
웹 최신 문서나 모델의 다른 런타임 예제보다 실제 설치 바이너리의 동작을 우선한다.

- config/models.yaml: PornMaster Klein 9B Turbo, Klein 4B Q4/Q8, Z-Image
  Turbo/NSFW v2는 cfg_scale 및 negative_prompt를 허용 목록에 넣지 않았다.
- backend/app/services/registry.py의 resolve(): 미지원 필드가 프리셋과 다르면
  `Model does not support changing cfg_scale`로 거절한다. 기본 CFG는 모두 1이다.
- frontend/src/App.tsx: CFG 입력은 항상 활성화되어 있어 서버 정책과 불일치한다.
- backend/app/engines/sdcpp.py: CFG를 --cfg-scale로 전달할 수 있는 구현은 이미 있다.
  모델별 cli_args가 마지막에 붙으므로 동적 옵션 추가 시 중복 플래그를 방지해야 한다.
- JobRequest는 extra=forbid이므로 sampler/scheduler 등을 보내면 현재는 거절된다.
- bc250-verified.json의 저장된 도움말에는 --sampling-method, --scheduler,
  --cfg-scale, --guidance, --clip-skip, --flow-shift, --vae-tiling,
  --vae-tile-size, --extra-sample-args 등이 있다. 현 서버 바이너리와 일치 여부는 미확인.

## 모델별 적용 판단

| 모델 | 현재 설정 | 우선 검토할 변경 |
| --- | --- | --- |
| PornMaster Klein 9B v4 Turbo Q4_K | 4 steps / CFG 1 / Euler | 정확한 v4 Turbo 제작자 레시피와 바이너리 구현 확인 후 CFG와 negative prompt를 함께 검증. 체크포인트별 허용 목록으로 관리 |
| Klein 4B Q4/Q8 | 4 steps / CFG 1 / Euler | distilled 기본값 유지. sampler/scheduler는 검증된 조합만 제공. base 모델 레시피를 혼용하지 않음 |
| Z-Image Turbo | 4 또는 8 steps / CFG 1 / Euler | Turbo 레시피 유지, sampler/scheduler 후보 검증. Diffusers의 guidance_scale 숫자를 sd.cpp CFG로 그대로 복사하지 않음 |
| Z-Image NSFW v2 | 4/6/8 steps / CFG 1 / Euler | 정확한 파생 모델 출처/버전과 권장 설정 확보 후 CFG 지원 결정 |
| Realistic Vision v6 | 15/20/30 steps / CFG 7 / Euler | CFG/negative prompt는 이미 허용. sampler/scheduler 및 CLIP skip 추가 후보 |
| Fake | CPU 테스트 | 옵션 해석/API 전달 테스트용이며 품질 지원 증거로 사용하지 않음 |

--guidance는 도움말상 guidance 입력을 가진 모델의 distilled guidance이다.
--cfg-scale와 동일한 옵션으로 취급하거나 모든 FLUX 모델에 일괄 노출하지 않는다.
CLIP skip도 Qwen 인코더 모델에 적용할 옵션으로 간주하지 않는다.

## 구현 순서

1. 근거 확정: 설치 바이너리 해시와 help 스냅샷 대조, 정확한 체크포인트 출처/버전
   기록. PornMaster v4 Turbo와 Z-Image NSFW v2 제작자 권장값을 확보한다.
2. 레지스트리: 기존 supported_parameters/presets를 보존하며 옵션별 타입, 기본값,
   범위/선택지, 지원 상태(verified/experimental/unsupported), 조건 및 설명을 추가한다.
   추천값과 변경 금지를 별개로 표현한다. 기존 모델 정의에는 호환 기본값을 제공한다.
3. API: sampling_method, scheduler, clip_skip, vae_tiling 등 선택 필드를 단계적으로
   추가한다. 모델별 검증은 resolve()에서 하고, 생략된 값은 기존 동작을 유지한다.
   임의 CLI 인자나 파일 경로 입력은 받지 않는다. 모델별 CFG/negative prompt 조건을 검증한다.
4. 엔진: 허용된 옵션을 명시적 argv 매핑으로 변환한다. 기존 cli_args의 sampler 등은
   기본값으로 정규화하고 동일 옵션을 두 번 출력하지 않는다. 큐 spec에 확정값과 모델
   설정을 동결하고 metadata/JobView/프런트 타입/설정 재사용까지 전달한다.
5. UI: 모델 선택 시 지원 옵션만 편집 가능하게 한다. 추천/실험적/미지원 표시와
   CFG에 따른 negative prompt 조건을 설명한다. 모델 변경 시 다른 모델의 옵션을
   초기화한다. 프리셋과 수동 변경의 관계를 명확히 한다.
6. 1차 옵션: CFG 정책 일치, negative prompt, sampler, scheduler.
   2차 옵션: SD1.5 CLIP skip, 검증된 VAE tiling.
   LoRA, img2img, reference image, hires는 자산 업로드/권한/출력 크기 검증까지 필요한
   별도 작업으로 분리한다. flow shift/SLG/cache는 바이너리와 모델 검증 후 도입한다.

## 검증과 완료 조건

- GPU 없는 테스트: 허용/거절 범위, 기본값 호환, 잘못된 enum/NaN 거절,
  argv의 옵션별 단일 출력, 큐/재시도 snapshot 재현, metadata 보존.
- UI 검증: 모델/프리셋 변경과 옵션 초기화, 실제 전송값, 미지원 필드 설명,
  설정 재사용, lint/build.
- 실제 BC-250 비교는 별도 명시적 승인 후 실행한다. 비성적 동일 프롬프트/seed/해상도에서
  옵션 하나씩 변경해 결과·시간·메모리·실제 argv를 기록한다. PornMaster CFG 1과
  변경값 비교도 이 단계에 속한다. GPU lock/admission/systemd 절차는 유지한다.
- 통과 기준: UI 허용값과 API 정책 일치, 단일 argv 전달, 과거 요청 호환,
  품질/속도 증거를 가진 조합만 verified로 승격. 단순 실행 성공과 품질 권장은 구분한다.

## 태스크 실행 규칙

- 한 번의 요청에서는 지정된 태스크만 수행하고 다음 태스크를 자동 실행하지 않는다.
- 각 태스크 시작 시 실제 코드와 이전 산출물을 읽는다. 문서의 조사 결과를 현재 코드로
  재확인하고 기존 사용자 변경을 보존한다.
- 인증, 큐, GPU lock, admission gate, systemd 전환은 이 작업의 변경 대상이 아니다.
- 실제 이미지 생성/벤치마크/서비스 재시작/배포는 이 계획만으로 승인되지 않는다.
- CLI 플래그 존재, 모델에서의 의미, 권장값, 실기 검증 결과를 각각 기록한다.
  미확인 항목을 unsupported 또는 verified로 단정하지 않는다.
- 실행 결과는 `docs/MODEL_OPTIONS_PROGRESS.md`에 태스크 ID, 변경 파일, 검사 결과,
  남은 불확실성, 다음 태스크 입력을 기록한다. 이 진행 파일은 T01에서 생성한다.
- 연결 실패나 증거 부재가 있으면 부족한 항목을 명시한다. 무관한 작업은 진행할 수 있지만
  확인되지 않은 플래그/모델 지원을 가정해 API·UI에 노출하지 않는다.
- 테스트 명령은 프로젝트 루트 기준 `.venv/bin/pytest`, `.venv/bin/ruff check`,
  `npm --prefix frontend run lint`, `npm --prefix frontend run build`를 사용한다.
  새 의존성이 필요하면 먼저 기존 테스트 도구로 검증 가능한지 확인한다.

## 태스크 목록과 의존성

`T01 → T02 → T03 → T04 → T05 → T06 → T07`

T08은 별도 승인이 필요한 실제 GPU 검증이다. T07까지 끝나도 실기 미검증 상태는 유지한다.
아래 파일 목록은 주요 진입점이며, 실제 호출 관계상 필요한 파일은 근거를 기록하고 포함한다.

### T01 — 설치된 sd-cli 옵션 조사 (코드 구현 없음)

- 입력: `bc250-verified.json`, `scripts/probe_server.py`, `config/models.yaml`,
  `backend/app/engines/sdcpp.py`, 기존 배포 문서.
- 작업: 기록된 바이너리 경로/해시/help와 현재 서버 자료를 대조한다. 원격 접속은 이전에
  인증 실패했으므로 접근 가능하다고 가정하지 않는다. 접근 불가 시 사용자가 서버에서
  실행할 해시/help 수집 명령을 제공하고, 저장된 자료는 잠정 증거로 표시한다.
- help에 나온 정확한 옵션명·타입·선택지·기본값을 추출한다. 필요 시 일치하는 소스 버전의
  옵션 파서와 모델별 적용 코드를 읽는다. 최신 upstream을 설치 버전으로 취급하지 않는다.
- 대상: CFG, negative prompt, sampler, scheduler, distilled guidance, CLIP skip,
  VAE tiling/tile size, flow shift. 추가로 발견한 옵션은 후속 후보로 분류한다.
- 산출물: `docs/SDCLI_OPTIONS_AUDIT.md`, 진행 파일.
- 완료 조건: 각 항목에 근거 위치와 설치 버전 확인 여부가 있고, CFG와 guidance의 차이가
  명시되어 있다. 이미지 추론 없이 조사한다. 현재 바이너리 미확인은 다음 단계에 전달한다.

### T02 — 체크포인트별 적용 표와 API 계약 확정 (코드 구현 없음)

- 의존: T01. 입력: 조사 문서, 모델 레지스트리, 정확한 체크포인트 제작자 자료.
- 작업: 위 모델별 표를 구체화하고 옵션별 `지원/실험적/미지원/미확인`, 추천값,
  허용 범위·enum, 적용 조건, 근거를 확정한다. 추천값 1과 CFG 변경 불가는 구분한다.
  PornMaster v4 Turbo를 일반 Klein distilled/base와 동일 취급하지 않는다.
- 1차 범위는 CFG·negative prompt·sampler·scheduler. CLIP skip/VAE tiling은 증거가
  충분한 항목만 포함한다. 미확인 옵션은 후속 후보로 남긴다.
- 계약: 기존 최상위 요청 필드와 배열형 목록 응답을 유지한다. 새 옵션은 optional로
  정의하고, `/models`의 capability 설명 형태, 기본값/추천값/생략 처리, 프리셋과 수동값의
  우선순위, 미지원 값의 422 오류, 과거 job/metadata 읽기 동작을 명시한다.
- 특히 scheduler 미지정은 기존 CLI의 model-specific 기본 동작을 보존해야 한다.
  운영자 cli_args와 요청 옵션이 충돌할 때의 우선순위도 정한다.
- 산출물: `docs/MODEL_OPTIONS_CONTRACT.md`. 요청·응답 예시와 옵션→CLI 매핑 표 포함.
- 완료 조건: T03~T06 담당자가 옵션 이름/기본값/허용 조건을 임의로 결정할 필요가 없다.
  증거 부족으로 보류한 옵션과 구현 가능한 옵션을 분리한다.

### T03 — 모델 capability 레지스트리 구현

- 의존: T02. 주요 파일: `config/models.yaml`, `backend/app/services/registry.py`,
  레지스트리 관련 테스트.
- 작업: 계약의 capability 구조를 타입 검증 가능한 형태로 추가하고 `/models`에 제공한다.
  기존 supported_parameters 및 presets와 모순되지 않게 단일 기준으로 유지한다.
  기존 YAML 정의를 읽을 수 있도록 호환 기본값을 둔다.
- 이 단계에서 새 요청 필드를 조용히 수락하지 않는다. 실제 엔진 전달이 준비되지 않은
  옵션은 실행 가능으로 광고하지 않는다. T04에서 검증·실행 경로를 함께 연결한다.
- 완료 조건: 기존 설정 로드와 모델 조회가 유지되고 모델별 설명/타입/범위가 계약과 일치한다.
  레지스트리 변경에 맞는 회귀 테스트를 통과한다.

### T04 — API 검증과 sd-cli 인자 전달을 함께 구현

- 의존: T03. 주요 파일: `backend/app/models/schemas.py`, `services/registry.py`,
  `engines/sdcpp.py`, `tests/test_api.py`, `tests/test_sdcpp.py`.
- 작업: 확정된 optional 필드만 추가하고 Registry.resolve에서 모델별 검증/기본값을
  적용한다. 검증된 spec을 명시적 argv로 변환한다. 실행까지 연결된 옵션만 활성화한다.
- 기존 cli_args의 --sampling-method 등과 중복되지 않도록 정규화한다. --backend 같은
  운영 설정을 손실시키지 않는다. 자유 형식 extra args/경로/셸 문자열 API는 추가하지 않는다.
- 과거 큐 spec에는 신규 키가 없을 수 있다. 기존 model_snapshot과 cli_args의 의미를
  유지하는 fallback을 구현하고 기존 job을 현재 레지스트리로 재해석하지 않는다.
- 완료 조건: API에 넣은 값이 정확히 한 번 argv에 나타난다. 지원 안 되는 조합은 작업
  실행 전에 거절된다. 기존 요청과 과거 큐 spec 테스트, 범위/enum/NaN 검증을 통과한다.

### T05 — 큐·결과 메타데이터·재시도 호환 검증 및 필요한 보완

- 의존: T04. 주요 파일: `scheduler/runner.py`, `models/database.py`, `models/schemas.py`,
  자산 metadata 경로 및 관련 테스트.
- 작업: 요청→확정 spec→job 조회→metadata→retry까지 옵션 보존을 추적한다.
  이미 보존되는 경로는 재구현하지 않는다. 누락된 응답 필드나 fallback만 보완한다.
- 완료 조건: 레지스트리 설정이 바뀌어도 기존 job/retry는 동결된 옵션을 사용한다.
  예전 DB 레코드/metadata에 신규 키가 없어도 조회가 실패하지 않는다.
  스키마 마이그레이션은 실제 필요성을 확인한 경우에만 추가한다.

### T06 — 모델별 프런트엔드 옵션 구현

- 의존: T05. 주요 파일: `frontend/src/api.ts`, `App.tsx`, `styles.css`.
- 작업: capability 계약을 사용해 기본/고급 옵션을 표시한다. 변경 가능한 CFG는 편집,
  고정값은 이유를 표시한다. negative prompt 조건, sampler/scheduler 선택지를 반영한다.
- 모델 변경 때 이전 모델 전용 옵션을 제거한다. 프리셋 변경·수동 편집의 우선순위를
  계약대로 구현한다. 미지원 값은 전송하지 않으며 optional 생략의 의미를 유지한다.
- metadata 상세와 ‘이 설정으로 다시 생성’에 신규 옵션을 연결한다. 오래된 metadata는
  호환 처리하고 새 서버에만 있는 capability 필드가 없을 때도 화면이 실패하지 않게 한다.
- 작업 큐/갤러리/보관함 페이지당 12개와 기존 보관·복원 동작을 유지한다.
- 완료 조건: 실제 요청 payload가 화면 값과 일치한다. 모델 변경/프리셋/설정 재사용을
  fake 또는 mock 환경에서 확인하고 lint/build를 통과한다. 실제 GPU 작업은 제출하지 않는다.

### T07 — 통합 검증과 인계 문서 마무리

- 의존: T06. 작업: 전체 backend 테스트·ruff·frontend lint/build 실행.
  신규 옵션 생략/지정/거절, 구형 job 조회, retry와 metadata 재사용 흐름을 검증한다.
- `/models` → UI → 요청 → resolved spec → argv → metadata의 값 추적 증거를 기록한다.
  테스트는 단순 코드 복제가 아니라 옵션 손실·중복·잘못된 모델 허용을 검출해야 한다.
- `docs/API.md`, `docs/MODELS.md`, `docs/TESTING.md`를 실제 구현에 맞게 갱신한다.
  변경 파일, 확인된 기능, 실기 미확인 조합, 배포 시 backend/frontend 동시 반영 필요를 기록한다.
- 완료 조건: 실패 검사가 없고, 미확인 모델 지원을 검증 완료로 표기하지 않는다.
  번들 생성·서버 반영은 사용자가 별도 요청할 때 수행한다.

### T08 — 승인 후 실제 BC-250 검증 (선택적 후속 태스크)

- 의존: T07 및 사용자의 명시적 GPU 테스트 승인.
- 실행 전에 모델·해상도·seed·옵션 조합·이미지 수·LLM 중단 범위를 구체적으로 정한다.
- 기존 GPU 소유권 절차로 옵션 하나씩 비교한다. 성공 여부뿐 아니라 실제 인자,
  결과 차이, 처리 시간, 메모리 증거를 기록한다. 품질과 지원 상태는 결과에 따라 갱신한다.
- 승인 전에는 비교 계획 작성까지만 수행한다.

## GPT 5.6 terra medium에 보낼 요청

사용자가 모델을 직접 선택한 다음 아래 요청의 태스크 ID만 바꿔 순서대로 사용한다.

```text
docs/MODEL_OPTIONS_PLAN.md를 읽고 T01만 수행해줘.
이전 태스크 산출물과 실제 코드를 먼저 확인하고, 지정 태스크 범위만 진행해.
sd-cli 설치 버전 근거를 기준으로 판단하고 미확인 모델 옵션을 추측해서 활성화하지 마.
실제 GPU 추론, 서비스 재시작, 배포는 하지 마.
완료 후 docs/MODEL_OPTIONS_PROGRESS.md에 변경 파일, 검증 결과,
남은 불확실성, 다음 태스크에 필요한 입력을 기록하고 보고해줘.
다음 태스크는 자동으로 시작하지 마.
```

T02~T07 요청에서도 동일 템플릿을 사용한다. 선행 태스크가 미완료이면 의존하는 변경을
임의로 진행하지 말고, 무엇이 부족한지 보고한다. T08은 위 템플릿으로 GPU 실행을
승인한 것으로 간주하지 않으며 별도 구체적 승인 요청을 사용한다.

## 참조

- https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/flux2.md
- https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- 로컬: config/models.yaml, bc250-verified.json, backend/app/services/registry.py,
  backend/app/engines/sdcpp.py, backend/app/models/schemas.py, frontend/src/App.tsx

정확한 PornMaster v4 Turbo와 Z-Image NSFW v2의 제작자 모델 카드는 미확인이다.
검색된 재게시 자료의 수치를 확정 권장값으로 사용하지 않는다.
