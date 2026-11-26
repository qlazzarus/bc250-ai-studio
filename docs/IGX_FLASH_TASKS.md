# IGX · DeepSeek 4.1 Flash 작업 카드

**첫 세션은 01a다.** 업로드·삭제 정책 중 결정할 항목을 확인하고 요청/응답 예시와 테스트 기준을 제출하면 끝난다. IGX01 구현은 승인 후 01b부터 시작한다. GPU를 사용할 수 없어도 입력 기반을 진행할 수 있다. 이 분할은 모델의 토큰 한도를 가정하지 않고, 새 세션이 이전 대화 없이 한 가지 결과를 검증할 수 있는지를 기준으로 삼았다. 설계 근거와 모델별 지원 등급은 [IGX00 로드맵](IGX00_IMAGE_GENERATION_ROADMAP.md)에 있다.

## 새 대화에 붙여 넣을 프롬프트

```text
BC-250 AI Studio 저장소에서 docs/IGX_FLASH_TASKS.md의 01a 카드만 수행해.
공통 실행 규칙, 해당 카드 한 행, 지시된 IGX00 절과 진입 파일의 관련 함수만 읽어.
먼저 현재 체크아웃과 이전 인계의 변경·증거를 대조해. 이미 구현돼 있으면 검증만 해.
01a의 결과는 계약 초안과 미결정 항목이다. 코드 변경은 다음 카드의 범위다.
끝나면 카드 ID / 상태 / 계약 또는 바뀐 파일·심볼 / 검증 명령과 실제 결과 /
미결 사항 / 다음 가능한 ID를 알려줘.
```

후속 세션은 위 프롬프트의 두 곳에 나온 **01a**를 대상 ID로 바꾸고, 네 번째 줄을 **“산출물과 완료 기준은 이 카드의 행을 따라. 이전 인계는 아래와 같아.”**로 교체한 뒤 이전 결과를 붙인다. 로드맵 전체나 이전 대화 전문을 매번 붙일 필요는 없다.

**공통 실행 규칙**

- 각 행은 한 세션이다. 선행 열은 **완료된 결과**를 뜻한다. 번호가 앞선 다른 분기가 전부 끝날 필요는 없다. 같은 카드에서도 모델·조합·장애 유형별 반복이라고 적힌 경우에는 **한 사례만** 선택해 ID 뒤에 대상 이름을 붙인다.
- 승인된 로컬 코드 작업은 가장 가까운 기존 테스트로 검증한다. 기존 테스트로 빠지는 회귀만 추가한다. 작업 중 두 번째 독립 계약이 드러나면 현재 계약의 테스트까지 마치고 남은 부분을 `카드ID-2`로 넘긴다. 미완성 부분에 외부 진입점을 열지 않는다.
- 실기 카드(P)는 대상 호스트·시험 시간·가중치가 승인된 범위에서만 수행한다. 로드맵 §7의 읽기 전용 인벤토리와 §4의 측정 항목을 쓴다. 실기용 어댑터가 필요하면 별도 로컬 준비 세션에서 기존 Scheduler→GPUManager→SdCppEngine 경로에 연결하고 fake로 먼저 확인한다. 실기 생성·엔진 교체·모델 취득·배포는 카드 지정만으로 승인되지 않는다.
- 결과 상태는 **완료 / 부분 완료 / 차단** 중 하나로 쓰고, 검증 환경을 **로컬 / fake 브라우저 / 격리 VM / BC-250 Vulkan**으로 표기한다. 실기는 job ID, 빌드·가중치 digest, 결과 이미지, 메모리와 LLM 복구 기록을 인계한다. 근거가 없으면 UNKNOWN을 유지한다.
- 표의 파일은 읽기 시작점이다. 백엔드 이름은 backend/app 아래, 프런트 이름은 frontend/src 아래에서 찾는다. 테스트는 backend/tests, frontend/tests, scripts/prompt-composer-browser에서 대상 심볼로 좁힌다. 예를 들어 엔진 계약은 저장소 루트에서 `.venv/bin/python -m pytest -q backend/tests/test_sdcpp.py`로 확인할 수 있다.

## 첫 묶음 · 입력을 받아 다시 쓸 수 있게 하기

로드맵 §1·§5·§6의 IGX01 행을 사용한다. 01a의 정책 결정 전에도 U1에서 기존 UIX 증거를 점검할 수 있다.

| ID | 선행 | 읽을 진입점 | 한 세션의 산출물과 확인 방법 |
|---|---|---|---|
| 01a | 없음 | models/schemas.py의 JobRequest·AssetView, api/routes.py의 asset 조회·삭제, core/middleware.py의 BodyLimit | 문서/인계만 작성. PNG/JPEG 업로드 성공 응답, 초과·손상 오류, 기존 자산 선택 예시를 각 1개 작성한다. byte·pixel·동시 수 한도, TTL, 삭제 후 재시도 보존 기간의 제안값과 승인 필요 항목을 표시한다. |
| U1 | 없음 | ART_STUDIO_UI_UX_IMPLEMENTATION.md의 UIX07, suite-uix06a.mjs | 현재 체크아웃에서 UIX07 항목별 테스트·증거 위치와 빈칸을 표로 남긴다. 빈칸은 페이지 이동, 포커스, 실제 IME, 배포 직접 진입 등 **시나리오 하나당 한 후속 세션**으로 나눈다. |
| 01b | 01a 계약 승인 | models/database.py, backend/alembic/versions, core/studio_files.py | 불변 입력 레코드와 저장 위치를 정의한다. 빈 DB와 기존 Asset·Job이 있는 DB에서 마이그레이션 후 기존 조회가 가능한지 시험한다. |
| 01c | 01a 계약 승인 | pixel/service.py의 Pillow 사용, core/studio_files.py | CPU 정규화 함수만 구현한다. 손상·다중 프레임·픽셀 상한 거부, EXIF 1~8 방향, 알파 보존 및 메타데이터 제거를 작은 이미지로 검증한다. |
| 01d | 01a 계약 승인 | core/middleware.py, main.py의 BodyLimit 등록 | 업로드 경로에만 스트리밍 byte 한도를 적용한다. 길이 헤더 없는 분할 body, 초과·연결 종료·동시 요청, 기존 JSON 요청 한도를 검사한다. |
| 01e | 01b,c,d | api/routes.py의 인증·파일 조회, models/schemas.py | 업로드→정규화→원자적 저장→ID 조회를 연결한다. 정상 round trip, 인증 실패, 디코드/DB 실패 후 임시 파일 처리, 경로 입력 거부를 API로 검증한다. |
| 01f | 01e | api/routes.py의 Asset·PixelVersion 파일 조회 | 생성 결과 ID 또는 Pixel 버전 ID를 입력으로 선택한다. 타입·권한·보관/삭제 여부와 digest를 검증하고 두 ID 종류의 정상/만료 사례를 시험한다. |
| 01g | 01b,e,f | models/database.py, api/routes.py의 enqueue·retry·delete | 작업과 입력 참조 고정을 한 트랜잭션으로 처리할 기반을 만든다. 접수와 삭제 경합, 재시도 보존·기간 만료를 임시 DB에서 검증한다. 생성 모드 연결은 02b가 맡는다. |
| 01h | 01g | core/studio_files.py, main.py의 lifespan | 미사용 입력의 TTL과 재시작 후 고아 정리를 구현한다. 정리 두 번 실행, 쓰기 중인 파일, 참조 고정된 입력의 보존을 시험한다. |
| 01i | 01e | api.ts, App.tsx의 생성 화면 | 파일 선택·미리보기·서버 오류 표시를 연결한다. 키보드만으로 선택/해제 가능하고 업로드 실패 후 재선택 가능함을 확인한다. |
| 01j | 01i | 01i에서 추가한 입력 컴포넌트 | 드롭과 클립보드를 같은 파일 검증에 연결한다. 파일 없는 붙여넣기에서 일반 텍스트 입력 유지, 다중 파일·취소 처리를 시험한다. |
| 01k | 01f,i | components/Gallery.tsx, App.tsx, lib/routes.ts | Art의 ‘이 이미지로 수정’이 입력 ID를 넘긴다. 기존 ‘설정 재사용’의 프롬프트 포커스 및 뒤로 가기를 브라우저로 대조한다. |
| 01l | 01f,i | PixelStudio.tsx, App.tsx | 선택한 Pixel 버전을 Art 입력으로 넘긴다. 왕복 후 프로젝트·버전·승인 상태와 원본이 유지되는지 확인한다. |
| 01m | 01h,j,k,l | scripts/prompt-composer-browser, backend/tests/test_api.py | 좁은 화면에서 업로드→선택→해제, 보관된 자산 실패, 과거 결과 재사용을 검증한다. 입력 단계의 로컬 증거와 UIX07 미결 목록을 인계한다. |

## 편집 주 경로 · 한 장 재생성 → 마스크 → 캔버스 확장

로드맵 §2의 해당 실행 경로와 §5의 공통 계약을 읽는다. 첫 실기 대상은 realistic-vision-v6, 512×512, batch 1이다. 제품 UI는 서버에서 실행 가능하다고 판정한 조합만 노출한다.

| ID | 선행 | 읽을 진입점 | 한 세션의 산출물과 확인 방법 |
|---|---|---|---|
| 10a | 실기 전 | 로드맵 §4·§7, scripts/ucp09/inspect-bc250.sh | 재사용할 측정 기록 양식을 만든다. 승인된 읽기 전용 조회로 채울 수 있는 장치·바이너리·상태와 실기 중에만 채울 peak·지연·복구를 구분한다. |
| P-init | 10a, IGX01 입력, 승인된 시험 경로 | engines/sdcpp.py, scheduler/runner.py | 고정 입력/seed에 strength만 바꾼 결과와 strength 0의 동작을 기록한다. 실제 구조 변화·기본 T2I·LLM 복귀 증거가 나오면 02 엔진 경로를 연다. |
| 02a | 01a | services/registry.py, config/models.yaml, api/routes.py의 models | 모델별 capability 응답과 실행 판정 함수를 추가한다. 구형 YAML·fake·파일 누락·UNKNOWN에서 신규 기능이 닫히는지 검증한다. |
| 02b | 01g,02a,P-init | models/schemas.py, services/registry.py, api/routes.py | img2img 한 모드만 요청·동결 spec·입력 pin에 연결한다. 잘못된 strength·fit·모델 거부, 과거 T2I 요청/조회·retry 호환을 시험한다. |
| 02c | 02b | engines/sdcpp.py, backend/tests/test_sdcpp.py | 검증된 init/strength argv와 입력 fit 처리를 구현한다. contain/crop 결과 좌표, 기존 T2I argv, 실행 직전 입력 파일 변경 거부를 확인한다. |
| 02d | 02c,01m | hooks/useGeneration.ts, App.tsx | 모델 전환·strength·fit·원본 비교를 연결한다. 요청 본문과 제출 후 이력 복원, 미지원 모델 전환 시 오류·포커스를 브라우저로 확인한다. |
| P-mask | 02c, 실기 승인 | engines/sdcpp.py, 로드맵 §2 Inpaint | 표식 마스크로 극성·전흑·전백과 비수정 영역 변화를 확인하고 최종 합성 기준을 기록한다. |
| 03a | P-mask,02b | models/schemas.py, services/registry.py | mask ID·좌표계·feather 단위를 요청에 추가한다. init 누락·규격 불일치·범위 초과를 거부하고 과거 spec을 읽는다. |
| 03b | 03a | engines/sdcpp.py, scheduler/runner.py | 마스크 실행과 원본 합성을 연결한다. feather 바깥 RGBA 차이 0, 지정 안쪽 변화, seed·mask digest 이력을 검사한다. |
| 03c | 03a | App.tsx의 생성 화면, 01i 입력 컴포넌트 | 마스크 편집기의 브러시·지우개·undo와 좌표 변환을 구현한다. CSS 표시 배율이 달라도 동일 원본 픽셀을 수정하는지 시험한다. |
| 03d | 03b,c | 03c 편집기, hooks/useGeneration.ts | 반전·경계 미리보기·키보드 크기 조정과 마스크 파일 대안을 연결한다. 생성→취소→편집기 복귀에서 초안·포커스 보존을 확인한다. |
| 04a | 03b | services/registry.py, 03b 합성 경로 | 네 방향 여백으로 캔버스와 마스크를 만든다. 비대칭·모서리·허용 해상도 초과·원본 위치의 픽셀 일치를 시험한다. |
| 04b | 04a,03d | App.tsx, hooks/useGeneration.ts | 여백/겹침과 최종 크기 미리보기를 연결한다. 승인된 한 사례에서 seam·원본 보존·실기 메모리를 확인한다. 실기가 남으면 UI 로컬 결과와 구분해 인계한다. |

## 선택 기능 · 필요한 분기만 진행

각 P 카드의 준비·실행이 한 세션을 넘으면 `P-이름-prep`은 고정 입력·worker 연결·로컬 검증, `P-이름-run`은 승인된 실측과 판정만 담당한다. 한 모델의 성공 기록을 다른 계열이나 복수 조건의 성공으로 복사하지 않는다.

| ID | 선행 | 읽을 진입점 | 한 세션의 산출물과 확인 방법 |
|---|---|---|---|
| P-ip | 01e,10a, 실기 승인 | 로드맵 §2 IP, engines/sdcpp.py | SD15 Classic 단일 참조, ViT-H/14, 승인된 고정 DGL로 참조/강도 효과와 peak를 측정한다. 다른 빌드가 필요하면 후보 비교를 별도 인계한다. |
| 05a | P-ip,02a | models/schemas.py, services/registry.py | 단일 reference ID·adapter ID·strength의 모델별 허용 조건과 동결 형식을 정의한다. 누락 가중치·family 불일치를 시험한다. |
| 05b | 05a | engines/sdcpp.py, backend/tests/test_sdcpp.py | 고정 레시피에 입력값을 안전하게 전달한다. 문자열·경로 경계와 미지원 빌드 거부, 취소 후 임시 파일 정리를 확인한다. |
| 05c | 05b,01i | App.tsx, hooks/useGeneration.ts | 참조 한 장/강도 선택과 제거를 연결한다. 미지원 모델에서 숨김, 이전 초안 복원, 실제 제출값을 확인한다. |
| P-control | 01e,10a, 실기 승인 | 로드맵 §2 ControlNet | SD15에 승인된 단일 제어망과 준비된 Canny hint를 적용한다. 강도·윤곽 변화, 크기 정합성과 복구를 기록한다. |
| 06a | P-control,02a | models/schemas.py, services/registry.py | 제어 종류·망 ID·hint ID·강도 계약을 추가한다. 잘못된 조합/크기 거부를 시험한다. |
| 06b | 06a | engines/sdcpp.py, backend/tests/test_sdcpp.py | 검증된 Canny 경로 하나를 연결한다. 전처리 좌표·채널과 worker에 전달된 hint를 픽셀 표식으로 대조한다. |
| 06c | 06b,01i | App.tsx, hooks/useGeneration.ts | hint 미리보기·교체·강도를 연결한다. 원본과 hint 혼동 방지, 모델 변경·복원 시 제출 내용을 확인한다. |
| 07a | IGX07 범위 승인 | services/registry.py, config/models.yaml, backend/tests/test_moss.py | 운영자 로컬 LoRA 등록·파일 식별을 구현한다. 대상 텐서·family·digest 불일치와 기존 MOSS 정의 로딩을 검사한다. |
| P-lora | 07a,10a, 실기 승인 | engines/sdcpp.py의 effective_prompt, 로드맵 §2 LoRA | 기존 MOSS off/0.7 단일 기준선을 기록한다. base와 기존 명시 태그 적용의 결과를 구분해 인계한다. |
| P-lora-multi | P-lora, 두 가중치 실기 승인 | engines/sdcpp.py, 10a 측정 양식 | 같은 모델·seed에서 A, B, A+B, 둘 다 off를 비교한다. 두 효과와 메모리·복구를 각각 판정한다. |
| 07b | 07a,P-lora | models/schemas.py, services/registry.py, engines/sdcpp.py | 단일 선택·강도와 기존 toggle/명시 태그 우선순위를 동결한다. 중복 적용 없음과 구 spec retry를 검사한다. |
| 07c | 07b,P-lora-multi | 07b 계약과 backend/tests/test_moss.py | 순서 있는 복수 선택을 추가한다. 순서·중복 ID·혼합 family·미지원 조합의 테스트를 남긴다. |
| 07d | 07b, 복수 UI는 07c | App.tsx, api.ts | 허용된 LoRA 선택과 프리셋 저장/복원을 연결한다. 모델이 바뀌거나 등록 파일이 사라진 프리셋의 표시·거부를 확인한다. |
| P-up | 01e,10a, 실기 승인 | 로드맵 §2 업스케일, engines/sdcpp.py | 승인된 upscaler 한 개로 작은 RGBA 격자의 전체/타일 결과·seam·알파·peak를 비교한다. |
| 08a | P-up,02a | models/schemas.py, services/registry.py | 독립 확대 요청·배율·tile·출력 픽셀 상한을 정의한다. T2I 해상도 검증과 확대 출력 검증을 각각 시험한다. |
| 08b | 08a | engines/sdcpp.py, scheduler/runner.py | 독립 확대 실행·PNG 검증·파생 자산 저장을 연결한다. 정확한 출력 크기, 원본 보존과 실패 시 정리를 확인한다. |
| 08c | 08b,01k | components/Gallery.tsx, PixelStudio.tsx | 결과를 새 자산/버전으로 연결한다. 원본·알파·Pixel 승인 이력이 유지되는지 확인한다. CPU 포맷 변환은 필요한 포맷별 후속 카드로 분리한다. |

**보류 후보**에는 IP Plus·복수 참조·FaceID, pose/depth 추정기, lineart/scribble, Z 전용 다중 제어, hires·얼굴 복원, Klein native edit가 있다. 하나를 선택하면 첫 카드는 “정확한 모델/입력/실행 경로·의존성 확인”, 둘째는 “승인된 조합 한 개의 PoC”로 쪼갠다. 통과한 조합에만 API, 엔진, UI 카드를 각각 만든다.

## 연쇄·최적화·최종 회귀

| ID | 선행 | 읽을 진입점 | 한 세션의 산출물과 확인 방법 |
|---|---|---|---|
| 09a | 02b | api/routes.py의 enqueue·retry, models/database.py | 호출자 범위의 idempotency key를 연결한다. 동시 중복은 같은 ID, 내용 충돌은 409, 키 없는 기존 요청은 기존 동작인지 검증한다. |
| 09b | 09a, 검증된 두 단계 | models/database.py, scheduler/runner.py | 부모 자산과 자식 job 한 단계만 영속화한다. 재시작·중복 이벤트에서 자식 한 개, 중간 실패 시 확정 자산 보존을 검사한다. |
| 09c | 09b | components/JobCard.tsx, components/Gallery.tsx | 결과→수정 또는 수정→확대 중 **한 경로씩** 계보·재개를 표시한다. 새로고침·과거 job permalink·seed 이력으로 확인한다. |
| P-combine | 해당 단일 기능 실기 성공,10a | 로드맵 §6 P-Combine | I2I+IP, I2I+Control, IP+LoRA 중 **한 조합**의 동일 seed 대조군과 A/B/A+B를 측정한다. 조합별 시간·peak·화질을 인계한다. |
| 09d | 해당 P-combine | services/registry.py, hooks/useGeneration.ts | 통과한 조합 한 개만 capability와 제출 검증에 반영한다. 순차 작업 성공만 기록된 조합은 여전히 거부되는지 확인한다. |
| 10b | 10a, 첫 실기 기준선 | engines/sdcpp.py, config/models.yaml | 해상도·tile·offload·양자화 중 **한 변수만** A/B 비교한다. cold 1회/warm 3회의 장당 소요 시간·최저 여유 메모리·복구·화질을 기록한다. |
| 10c | 10b, 운영 합격선 결정 | services/registry.py, gpu.py, scheduler/runner.py | 측정된 레시피 한도와 차단 사유를 반영한다. 기준 미달·미측정 조합 거부와 기존 lease/복구 계약을 시험한다. |
| 11a | 검증할 로컬 기능 | scripts/test-studio.sh, backend/tests, frontend/tests | 기존 API·엔진·MOSS·LLM 단위/계약 회귀를 실행하고 명령과 실패 목록을 남긴다. 수정이 필요하면 실패 원인별 카드로 넘긴다. |
| 11b | U1, 검증할 UI | scripts/prompt-composer-browser, frontend/src/lib/routes.ts | UIX07 및 새 workflow를 **시나리오 하나씩** 브라우저에서 확인한다. 실제 IME·배포 직접 진입은 해당 환경 증거로 따로 판정한다. |
| 11c | 검증할 worker | services/gpu.py, scheduler/runner.py, backend/tests/test_gpu_owned_holds.py | 취소·timeout·비정상 종료·모델 교체 경합 중 **한 장애씩** 격리 환경에서 주입한다. terminal 상태·파일·lock·hold·원래 LLM 상태를 대조한다. |
| 11d | 해당 기능 로컬 검증, 실기 승인 | 로드맵 §3·§7, 10a 측정 양식 | BC-250에서 **모델×빌드×레시피 한 셀씩** 증거를 모은다. 품질·메모리·실채팅 복귀 판정을 남기고 해당 셀만 갱신한다. |
| 11e | 선택한 범위의 11a~d | 로드맵 §3·§6 | 공개 가능한 레시피, 차단 조합, UIX07 미결, 롤백할 capability를 증거와 대조해 릴리스 판단을 인계한다. 배포는 별도 결정이다. |

### 인계 예시 · 실제 작업 시 빈칸 채우기

```text
카드 / 상태 / 환경:
기준 커밋 및 변경 파일·심볼:
다음 카드가 사용할 확정 계약 또는 산출물:
실행한 명령 · 결과 · 증거 위치:
미검증 항목 · 필요한 승인:
다음 가능한 ID와 해당 ID의 선행 충족 여부:
```
