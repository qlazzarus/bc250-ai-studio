# 사전 프롬프트 통합 구성 단일 실행 명세

작성일: 2026-11-21 · 우선순위: 사전 프롬프트 영역 최우선 · 실행 담당: DeepSeek 4.1 Flash

한글 설명과 사전 선택을 하나의 장면으로 해석하고, 한 번의 실행으로 사전 항목 자동 선택과 모델별 영어 프롬프트 후보 생성을 완료한다. 사용자는 결과를 확인하고 수정한 뒤 기존 최종 프롬프트 입력에 적용한다. 한글부터 시작하거나 사전부터 시작해도 같은 결과 화면으로 도착한다.

**이 파일 하나가 사전 프롬프트 개선의 설계·구현·태스크 관리 기준이다.** 실행에 필요한 현재 구조, 변경할 계약, 화면, 파일 위치, 검증 기준과 남은 보완 항목을 모두 포함한다. 프로젝트 공통 TODO는 이 파일로 연결만 하며, 사전 프롬프트 태스크를 별도로 나누어 관리하지 않는다. 소스 코드는 구현 시 확인하되 다른 계획 문서나 삭제된 과거 문서를 선행 자료로 요구하지 않는다.

**문서 압축 대상에서 제외한다.** 완료 전에는 이 명세를 삭제하거나 요약본·링크 목록으로 대체하지 않는다. 프로젝트 전체의 과거 히스토리 정리와 이 최우선 구현 명세의 유지 원칙은 별개다. 태스크별 현재 결과·결정·차단 사유는 이 파일에서 관리하고 날짜별 장황한 로그만 누적하지 않는다.

현재 상태는 **UCP01 계약 확정 완료, UCP02·UCP03·UCP04·UCP05·UCP06·UCP07 구현 완료, UCP08 브라우저 자동화 완료(459 checks, 모바일 실기기 대기), UCP09 미착수(실행 환경 없음)**다. UCP09는 실제 llama-server·GPU·모델을 요구하는데 이번 실행 호스트(Apple M1 macOS)에는 셋 다 없어 착수하지 못했고, 그 차단 근거를 「UCP09 환경 확인」 절에 기록했다. UCP03의 실제 llama-server·GPU gate 실연결 검증과 16K 컨텍스트 토큰 소비량 측정도 같은 이유로 대기다. UCP05의 화면 검증은 mock API와 데스크톱 브라우저 레이아웃까지이고, UCP06은 그 화면의 양방향 수정·적용 보호를 통합 테스트로 고정했다. UCP07은 v3 저장·trim·복원·재시도를 API와 순수 모듈 수준에서 고정했고, UCP08이 실제 브라우저(CDP, Edge 158)에서 적용→저장→갤러리 복원까지 클릭으로 확인했다. UCP08의 모바일 실기기(iOS Safari·Android Chrome) 검증은 기기가 없어 대기 상태로 남는다. DeepSeek 4.1 Flash는 코드를 구현할 실행자이며 Studio 런타임 LLM 설정을 바꾸라는 뜻이 아니다. 런타임은 기존 서버의 LLM 연결과 GPU 조정 경로를 사용한다.

## 0 DeepSeek 4.1 Flash 실행 지시

다음 지시를 이 문서와 함께 실행자에게 전달한다.

```text
이 저장소의 사전 프롬프트 통합 구성 개선을 구현하라.
유일한 실행 명세는 docs/PROMPT_COMPOSER_UNIFIED_IMPLEMENTATION.md다.
문서 전체를 읽고 현재 코드와 작업 트리를 확인한 뒤 UCP01부터 실행한다.

목표:
한글 설명 → LLM 전체 의미 해석·검증 → 사전 자동 선택 → 현재 모델에 맞는
영어 프롬프트 후보까지 한 번의 실행으로 제공한다.
반대로 사전 선택 → 한글 디테일 추가도 동일한 결과 흐름으로 연결한다.
기존 직접 프롬프트 입력과 이미지 생성·결과 재사용은 유지한다.
모바일에서도 한글 입력·사전 선택·후보 확인·적용의 전체 흐름을 완료할 수 있게 한다.
반응형 UX는 이 문서 3절과 UCP01·02·05·06·08·09에 포함된 필수 구현 범위다.

실행 규칙:
1. 다른 작업의 미커밋 변경을 보존한다. 문서 정리 변경을 구현 변경으로 오인하지 않는다.
2. UCP01에서 타입·제한·JSON 예시를 이 문서 안에 확정한 뒤 순서대로 구현한다.
3. 각 태스크의 실행 체크리스트·완료 기준·관련 테스트를 충족한다.
4. 기능을 추가할 때 실제 API와 UI를 연결한다. 버튼만 합치거나 mock만으로 완료하지 않는다.
5. 상태표와 해당 태스크의 현재 결과·결정·차단 사유를 이 문서에 갱신한다.
6. API·화면·저장 계약이 바뀌면 이 문서의 해당 절도 함께 갱신한다.
7. 테스트 실패는 원인을 해결한다. 환경이 없는 실연결/GPU 검증은 환경 대기로 남기고
   가능한 로컬 구현·검증은 계속 진행한다. mock 결과를 실연결 성공으로 보고하지 않는다.
8. 새 실행 계획서나 별도 태스크 파일을 만들지 않는다. 이 문서를 축약·삭제하지 않는다.
9. 이 문서의 설계는 목표 상태다. 현재 존재하지 않는 compose API나 v3 저장을
   이미 구현된 것으로 간주하지 않는다. 런타임 모델을 DeepSeek로 임의 변경하지 않는다.

착수는 UCP01이다. 최종 보고에는 구현 범위, 검증 결과, 남은 환경 의존 작업을 구분한다.
```

## 1 목표와 범위

### 필수 결과

- 한글 장면 입력 후 `프롬프트 만들기` 한 번으로 전체 의미 해석, 사전 자동 선택, 영어 후보 생성까지 완료한다.
- 사전으로 먼저 선택한 뒤 한글로 디테일을 추가해도 같은 흐름을 사용한다. 한글 없이 사전 선택만으로도 실행 가능하다.
- 사전이 표현하지 못하는 관계, 수량, 부정 조건, 디테일도 영어 결과에 보존한다.
- 현재 선택 모델에 맞는 영어 표현 후보를 최대 3개 제공한다. 기본 후보는 원문에 충실하고 후보마다 의미를 임의로 바꾸지 않는다.
- 기존 직접 프롬프트 입력, 이미지 생성, 결과 재사용을 유지한다.
- 자동 선택은 편집 중 장면에 즉시 반영하되 최종 프롬프트 교체는 사용자의 `이 프롬프트 사용` 동작으로 수행한다.
- 사용자 직접 선택·고정·제외와 AI 자동 선택의 출처를 구분하고 재분석에서도 존중한다.

- 모바일 360px부터 데스크톱까지 한글 입력·사전 선택·후보 비교·적용을 제공한다. 터치, 한글 조합 입력, 소프트 키보드, 화면 회전에서도 입력과 선택을 보존한다.

### 이번 범위에서 제외

대규모 사전 확장, 사용자 사전 편집, 이미지 생성 엔진 교체, 새 모델 계열 추가, 런타임 LLM 교체, GPU 운영 정책 개편은 별도 작업이다. 모든 설치 모델에 동시에 요청하는 배치 생성도 제외한다. 지원 모델 계열별 표현 처리는 구현하되 한 번의 요청은 현재 선택한 모델 하나를 대상으로 한다.

여러 영어 후보는 동일 장면의 표현 대안이다. 장소나 행동을 바꾸는 창작 후보는 `다른 상황 제안`이라는 별도 보조 기능으로 유지한다. 새 흐름에서 안정적으로 연결하기 전까지 고급 도구로 분리하며 기본 후보에 섞지 않는다.

## 2 현재 구현과 재사용 위치

| 위치 | 현재 책임과 변경 방향 |
| --- | --- |
| `frontend/src/components/PromptBuilder.tsx` | 한글 입력, 개별 제안 수락, 번역 포함, 초안 적용. 통합 흐름의 컨테이너로 정리하고 입력·장면·후보·상태 컴포넌트 분리 |
| `frontend/src/prompt/scene.ts` | 평면 선택 스냅샷과 모델 계열 재결속. 기존 복원 호환 유지 |
| `frontend/src/prompt/builderState.ts` | 편집 장면·초안·적용 이력 분리. 통합 결과와 마지막 적용 스냅샷도 분리 |
| `frontend/src/prompt/compiler.ts` | 사전 표현 정렬·연결·충돌 경고. 수동 사전 미리보기와 LLM 실패 대체 경로에 재사용 |
| `frontend/src/prompt/dictionary.ts`, `config/prompt_dictionary.json` | 안정 ID, 분류, 별칭, 모델 계열 매핑. 유효 ID와 사전 버전 검증 유지 |
| `frontend/src/prompt/llmProposals.ts`, `proposalCapability.ts` | 요청 취소, revision 검증, capability. 새 계약에 맞게 재사용하거나 독립 모듈로 확장 |
| `frontend/src/prompt/remainder.ts`, `remainderInclusion.ts` | 사전 밖 구절 분리·개별 번역 수락. 과거 v2 복원에 유지하되 통합 생성의 필수 단계에서는 제외 |
| `frontend/src/App.tsx`, `api.ts` | 최종 입력, 모델 선택, 요청 연결, 제출. 기존 직접 입력 경로 유지 |
| `frontend/src/components/MetadataModal.tsx` | 구성 이력 표시. 새 구성의 후보·출처·직접 수정 여부 표시 |
| `backend/app/api/proposals.py` | 인증된 `/api/v1/prompt/proposals` 경로. 기존 계약 유지 |
| `backend/app/services/proposal_provider.py` | LLM payload, provider 호출, GPU gate 경로. 전체 장면 생성 요청에 연결 |
| `backend/app/services/prompt_proposals.py` | 제안 형식과 사전 ID 검증. 공통 검증을 재사용하고 통합 응답 검증 분리 |
| `backend/app/api/routes.py` | capability와 생성 API. 새 지원 여부를 독립 광고 |
| `backend/app/models/schemas.py`, `backend/app/services/registry.py` | 구성 저장과 모델 계열 검사. 새 스냅샷 및 과거 v1/v2 호환 |

현재 LLM은 사전 ID 제안과 잔여 구절 번역을 별개로 처리한다. 컴파일러는 전체 장면을 번역하지 않으며 자연어 계열도 주로 세미콜론 연결이다. 상황 후보는 장소·행동 변경이다. 기존의 기능 조각은 활용하되 버튼만 합쳐서 통합 구현으로 판정하지 않는다.

UCP05가 이 표의 첫 행에 실제 변경을 넣었다: `PromptBuilder`는 고급/호환 경로로 **그대로 유지**하고, 통합 흐름은 새 `ComposePanel`이 담당한다. 즉 표의 "통합 흐름의 컨테이너로 정리"는 "PromptBuilder를 대체"가 아니라 "두 경로가 공존"으로 확정됐다. 기존 자유 입력 경로는 삭제·축소되지 않았고, compose가 불가능한 배포에서는 `ComposePanel`이 `composeFallbackNotice`로 이유를 밝히고 아무 것도 하지 않으며 자유 입력은 그대로 동작한다.

### 구현 시작 시 알아야 할 현재 계약

- 사전은 `frontend/src/prompt/dictionary.ts` 버전 1.2.0, 활성 항목 100개다. `scripts/gen-prompt-dictionary.mjs`가 서버 mirror `config/prompt_dictionary.json`을 생성한다. 수정 시 양쪽 버전과 내용 일치를 검증한다.
- 컴파일러는 1.3.0이다. `sd15`는 쉼표, `z-image`·`flux2`·`moss-image`는 세미콜론으로 사전 표현을 연결한다. 다인 귀속이나 전체 한글 의미 해석은 하지 않는다.
- 기존 builder는 편집 `scene`, 생성 `result`, 생성 기준 `generatedFrom`, 마지막 적용 `applied`를 분리한다. 원문/선택 수정이 최종 입력을 바로 덮어쓰지 않는다. 상태는 메모리에 있으며 새로고침 전 자동 영속 저장은 없다.
- 기존 LLM 제안은 `/api/v1/prompt/proposals`의 `selection_hint`, `partial_change`, `situation_variants`, `remainder_translation`이다. capability가 지원되고 사전 버전이 일치할 때만 호출한다. 입력 중 호출하지 않고 수락 전에는 결과를 적용하지 않는다.
- 기존 제안 요청은 8 KiB, UI 응답은 16 KiB, 서버 timeout은 20초, 프런트는 5초 여유를 더한다. credential당 1개·전체 2개 동시 요청 제한이며 요청 ID·kind·revision을 비교한다. 새 compose의 제한은 이 값을 무조건 복사하지 말고 UCP01에서 확정한다.
- 현재 구성 저장은 v1/v2다. v2 `remainder`는 최대 8개이며 각 `source_ko`/`suggested_en`은 200자, `proposal_id`는 8~64자, `proposal_model`은 1~200자, `accepted_at`은 UTC 초 단위다. 번역은 초안과 별도로 저장하고 최종 prompt에 개행으로 붙인다.
- 선택은 최대 100개, 한글은 4,000자, 초안·최종 prompt는 각각 8,000자, 선택 rendered는 300자, 미변환은 101개/항목 text 4,000자, 정규화 구성 JSON은 UTF-8 32 KiB다. 생성 HTTP body는 설정값을 따르며 소스 기본값은 65,536 bytes다. 문자 수와 UTF-8 byte 수를 혼동하지 않는다.
- 서버는 저장 구성의 구조·계열 일치를 검증하지만 현재 사전으로 재컴파일하지 않는다. 실제 실행 기준은 최상위 prompt다. snapshot은 DB·이벤트·asset metadata·sidecar·retry에 보존된다. 구 서버에서는 capability에 따라 구성 필드를 생략하거나 v2를 v1로 내리고 저장되지 않는 번역 기록을 안내한다.
- `prompt_compose` capability와 `/prompt/compose` 경로는 UCP03에서, 계열별 출력 프로필은 UCP04에서 구현되어 이미 존재한다. 화면은 UCP05에서 `ComposePanel`로 연결했다. 구성 v3 저장·trim·복원은 UCP07에서 구현했다(`schema_versions`에 `3`이 있으면 v3로 저장, 없으면 v1/v2 경로로 내려간다). 일반 Studio 앱 등록은 `backend/app/main.py`의 router 등록을 확인한다.
- 서버 런타임 설정은 `backend/app/core/studio_config.py`의 `STUDIO_*`다. client/admin 인증을 유지하고 브라우저에 LLM/gate 키를 전달하지 않는다. 기존 owned admission은 protocol 3을 요구하고 저장소 후보 gate는 protocol 2를 반환하므로 해당 조합을 검증 없이 활성화하지 않는다. 기존 제안 데이터 경로와 owned 이미지 조율 문제는 구분한다.

### 현재 모델 옵션과 새 출력의 연결

모델 ID·옵션·파일 가용성은 `config/models.yaml`과 Registry 응답이 기준이다. 다음은 현재 기본 구성이며 UCP01에서 변경 여부를 다시 확인한다.

| 모델 또는 계열 | 현재 prompt 관련 조건 |
| --- | --- |
| Klein 4B Q4/Q8, Z-Image Turbo/NSFW | CFG 1 고정, negative prompt 미지원 |
| PornMaster Klein 9B | CFG 1/1.5/2, 비어 있지 않은 negative는 CFG 2 필요 |
| Realistic Vision v6 | CFG 0..30, negative prompt 지원 |
| MOSS Q4/Q8 | CFG 3, negative 미지원, Euler/discrete, tokenizer·flow shift·설정 기반 LoRA 사용 |
| fake | API·UI 테스트 전용, 실제 이미지 품질이나 LLM 의미 검증 근거가 아님 |

후보를 적용할 때 현재 generation_options와 CFG 조건을 확인한다. negative를 넣기 위해 사용자 CFG를 조용히 바꾸지 않는다. API의 fixed/unsupported 조건을 영어 생성기가 우회하지 못하게 한다. MOSS trigger/LoRA는 기존 엔진 처리와 중복 주입하지 않는다.

## 3 사용자 흐름과 화면

### 한글에서 시작

1. 모델을 선택하고 `어떤 장면을 만들까요?`에 한글을 입력한다.
2. `프롬프트 만들기`를 누른다. 입력 중 자동 네트워크 호출은 하지 않는다.
3. 처리 완료 후 한글 해석 요약, 자동 선택된 사전 칩, 영어 후보를 한 화면에 표시한다.
4. 사전 칩 또는 설명을 수정하면 후보를 갱신 필요 상태로 표시한다. `다시 만들기`로 재분석한다.
5. 후보의 `이 프롬프트 사용`으로 최종 입력에 적용하고 기존 생성 동작을 사용한다.

### 사전에서 시작

1. 입력 옆 `사전에서 고르기`로 대상·배경·스타일 등을 선택한다.
2. 필요하면 같은 한글 입력란에 디테일을 추가한다. 별도의 번역 입력란을 만들지 않는다.
3. `프롬프트 만들기` 이후 동일한 결과 화면을 사용한다.

### 화면 구성

- 입력 영역: 한글 설명, 예시, 선택 모델, 주 실행 버튼. 사전 진입 버튼은 입력 전에도 보인다.
- 장면 영역: `이렇게 이해했어요` 요약, 그룹별 칩, 사전 미등록 디테일, 확인이 필요한 충돌. 자동 칩은 `자동`, 사용자 지정은 `직접 선택`, 고정은 `고정`으로 구분한다.
- 후보 영역: 원문 충실 후보를 먼저 표시한다. 후보별 한글 차이 설명, 영어 본문, 적용 버튼을 제공한다. 영어 결과는 기본 펼침 상태다.
- 사전 상세: 검색·분류·선택 상태·결과 없음 복구를 유지한다. 모바일에서도 주요 결과와 적용 버튼을 찾기 쉽게 배치한다.
- 기본 화면에서 사전 항목 개별 수락, 잔여 구절 번역, 번역 포함, 별도 보관/원문 반영 선택을 제거한다. 과거 이력 복원과 고급 수동 경로는 별도로 유지한다.
- 중복 요청 차단과 취소를 제공한다. 로딩 중 입력 편집은 가능하며 이전 요청 결과가 새 입력에 덮어써지지 않는다.

최종 입력이 마지막 자동 적용 문자열과 같으면 재적용 확인 없이 교체할 수 있다. 사용자가 직접 수정했거나 출처를 알 수 없는 비어 있지 않은 입력을 교체할 때는 기존 덮어쓰기 보호를 유지한다. 자동 선택 자체에 개별 확인을 요구하지 않는다.

### 반응형 UX와 모바일 사용성

모바일 개선은 통합 작성기의 필수 범위다. 별도 모바일 제품이나 전체 Studio 재디자인을 만들지 않는다. 구성기를 감싸는 App 레이아웃과 최종 입력/적용 접점까지 필요한 범위로 수정하고, 큐·갤러리·Pixel의 기존 사용성은 회귀 확인한다.

현재 소스는 좁은 화면에서 카드와 버튼을 재배치하지만 칩 삭제는 최소 26px, 분류 버튼은 최소 32px다. 이는 코드상 기준이며 실기기 사용성 검증 결과는 아니다. 새 구성기의 터치 영역과 읽기 순서를 아래 기준으로 재설계한다.

| 영역 | 구현 요구사항 | 완료 기준 |
| --- | --- | --- |
| 읽기 순서 | 모바일은 입력 → 해석/선택 → 후보 → 최종 적용의 한 열. 넓은 화면은 실제 구성기 너비가 충분할 때만 나란히 배치 | viewport가 넓어도 부모 패널이 좁으면 한 열 유지. DOM/키보드 순서와 시각 순서 일치 |
| 텍스트 | 입력 글자는 최소 16 CSS px를 프로젝트 기준으로 사용. 긴 영어·사전 이름·오류는 줄바꿈하고 컨테이너 min-width를 제한 | 360px 및 200% 확대에서 본문·버튼이 잘리거나 페이지 가로 스크롤이 생기지 않음. 확대 금지 설정 없음 |
| 터치 | 생성·적용·취소·칩 삭제·고정·분류·닫기 등 단독 조작 hit area는 최소 44×44 CSS px. 작은 아이콘도 실제 클릭 영역 확보 | 인접 삭제/고정의 hit area가 겹치지 않고 hover 없이 모든 기능 접근 |
| 사전 탐색 | 기본은 문서 흐름 안의 펼침 패널. 검색·분류·선택 수·선택 결과를 가까이 배치하고 항목 클릭으로 즉시 선택 상태 갱신 | 한 항목마다 패널 닫힘/페이지 맨 위 이동 없음. 접기/재열기 때 query·분류·선택 유지. 별도 선택 수락 단계 없음 |
| 선택 칩 | 줄바꿈하며 대상별 귀속·자동/직접/고정 상태를 텍스트로 구분. 많은 선택은 그룹별 접기로 관리 | 칩 제거 시 가까운 조작으로 포커스 이동. 선택 수와 펼치기 수단은 유지 |
| 영어 후보 | 모바일은 세로 카드. 첫 충실 후보는 영어 본문 기본 펼침. 나머지 후보도 기본 펼침을 유지하되 사용자가 접을 수 있음 | 각 카드의 제목·차이·본문·적용이 함께 식별됨. 가로 carousel이나 swipe만으로 접근하지 않음 |
| 긴 결과 | 한글 요약에서 결과 위치로 이동하는 명시적 동작 제공. 후보별 적용 버튼은 해당 본문 뒤에 배치 | 결과 수신이 입력 중 포커스/스크롤을 강제로 이동시키지 않음. 접힌 후보는 전문 확인으로 이동시켜 확인 후 적용 |
| 주요 동작 | 기본은 흐름 안의 전폭 생성/적용 버튼. sticky 보조 동작은 실제 가림 검증 후 필요할 때만 사용 | 현재 후보/동작이 명확하고 모델 이미지 생성과 프롬프트 만들기를 혼동하지 않음 |
| 키보드와 화면 높이 | 소프트 키보드·주소창 변화·safe area를 고려. 화면 높이 고정이나 body scroll 잠금으로 입력/오류/버튼을 가두지 않음 | 키보드 열린 상태에서 편집·사전 검색·오류 수정 가능. sticky가 있다면 키보드 때 숨기거나 흐름 안으로 돌리고 겹침 제거 |
| 한글 IME | composition 중 Enter를 제출/선택 확정으로 처리하지 않음. textarea Enter는 기본 줄바꿈, 실행은 명시적 버튼 | 조합 중 중복 요청·문자 유실·의도치 않은 패널 닫힘 없음 |
| 화면 전환 | 회전·resize·breakpoint 변경은 표시만 변경하며 같은 상태 인스턴스 유지 | 원문·선택·query·고정/제외·후보·적용 상태 보존, LLM 재요청 없음 |
| 오류와 접근성 | 입력 오류는 해당 필드 근처, 요청 상태는 상태 영역에 표시. 색상만으로 구분하지 않음 | 스크롤 없이 오류가 보인다고 가정하지 않으며 명시적 오류 이동 제공. 포커스 표시와 상태 알림 유지 |

CSS breakpoint 수치는 기기 이름에 고정하지 말고 실제 콘텐츠/구성기 폭을 기준으로 UCP01에서 결정한다. 기존 `.prompt-builder`의 container query 구조와 전체 workspace breakpoint를 확인한다. 360/390px은 주요 검증 폭이지 지원 폭을 둘로 제한하는 값이 아니다.

#### UCP01 확정 breakpoint

`.prompt-builder`는 이미 `container-type: inline-size; container-name: prompt-composer`를
선언하지만 `@container` 규칙은 아직 없다. 기존 `@media (max-width: 820px|460px|420px)`는
viewport 기준이므로 부모 패널 폭을 반영하지 못한다. 통합 구성기는 **컨테이너 폭**으로
전환하고, viewport 규칙은 App 레이아웃(워크스페이스 1열/2열)에만 남긴다.

| 컨테이너 폭 | 레이아웃 | 근거 |
| --- | --- | --- |
| `< 360px` | 한 열. 칩은 한 줄에 하나, 후보 카드는 본문과 적용 버튼 세로 배치 | 360px 미만에서도 가로 스크롤 없이 읽기 순서 유지 |
| `360px ~ 459px` | 한 열. 후보 카드의 적용 버튼이 본문 아래로 내려감 | 기존 `@media (max-width: 460px)`의 카드 규칙을 컨테이너로 옮긴 값 |
| `460px ~ 639px` | 한 열. 칩 다중 열, 후보 카드는 본문+버튼 같은 줄 | 기존 `.prompt-stage`가 638px까지 한 열인 실측과 일치 |
| `≥ 640px` | 장면/후보 2열 배치 허용 | 지금까지 구성기가 실제로 도달한 최대 폭(≈638px)을 넘는 첫 구간 |

viewport 기준 `@media (max-width: 820px)`은 워크스페이스를 1열로 만드는 App 레이아웃
규칙이므로 유지한다. 구성기 내부 규칙은 컨테이너 질의로 옮긴다.

터치 영역은 기존 26px(칩 삭제)·32px(분류 버튼)에서 **44px**로 올린다. 이는 3절 표의
요구사항이며 현재 코드값과 달랐으므로 UCP05에서 실제로 변경했다. `.compose` 블록의 모든
독립 조작(버튼·input·칩·후보 카드 버튼)이 `min-height: 44px`(칩은 `min-width` 포함)를
갖는다. 분류 버튼과 칩 삭제는 이 규칙으로 26px·32px에서 올라갔다.

bottom sheet나 modal picker는 기본 요구사항이 아니다. 도입이 필요하면 UCP05에서 이유를 이 절에 남기고 accessible name, focus trap/복귀, Escape·명시적 닫기, 배경 스크롤 복원, 키보드/회전 중 높이와 상태 보존을 함께 구현한다. swipe만 가능한 닫기와 중첩 dialog는 피한다.
→ **UCP05는 도입하지 않았다.** 사전 탐색은 `aria-expanded`/`aria-controls`를 가진 인라인 확장 패널이라 새 레이어가 생기지 않고, 따라서 위 조건들이 적용될 대상이 없다. 도입 근거와 미도입 근거는 UCP05 구현 결과의 "도입하지 않은 것과 그 근거"에 있다.

### 반응형 검증 매트릭스

| 환경 | 필수 확인 |
| --- | --- |
| 360×800, 390×844, 430×932 CSS px | 한글 우선/사전 우선 끝까지 수행, 긴 이름·다수 칩·후보 3개·긴 오류, 가로 넘침과 터치 영역 |
| 가로 844×390, 중간 폭 768px | 짧은 화면에서 입력/적용 접근, 회전과 폭 변경 전후 상태 보존 |
| 데스크톱 1280/1440px | 좁은 부모 패널과 넓은 패널 모두 읽기 순서/배치 확인, 기존 직접 입력·큐·갤러리 회귀 |
| 실제 브라우저 확대 200% | reflow, 포커스·오류·주요 버튼 가림. 단순 viewport 축소 결과로 대체하지 않음 |
| iOS Safari 실기기, Android Chrome 실기기 | 한글 IME·소프트 키보드·주소창·safe area·회전·터치. 원격 실기기 환경도 가능 |
| 키보드·보조기기 | Tab/Shift+Tab/Enter/Escape, 버튼 이름·상태 안내. 실기기 스크린리더 확인 범위와 미검증 범위 분리 |

브라우저 자동화의 mobile emulation은 레이아웃 검증이며 실제 소프트 키보드·IME·safe area 동작의 증거가 아니다. 실기기가 없으면 UCP08의 자동화/브라우저 완료와 `모바일 실기기 검증 대기`를 구분하고 전체 모바일 검증 완료로 표시하지 않는다. 실기기 검증은 mock 응답으로 먼저 수행할 수 있어 GPU/실제 LLM 대기를 선행 조건으로 두지 않는다.

## 4 장면 데이터와 편집 규칙

### 장면의 기준 데이터

원문 `brief_ko`, 사용자 제약, 구조화된 장면, 영어 후보를 구분한다. 사전 칩만으로 원문의 모든 의미를 대표하지 않는다. 원문을 태그로 분해한 뒤 잔여 조각만 번역하는 방식을 통합 생성의 기준으로 사용하지 않는다.

구조화된 장면에는 다음 정보를 둔다. 정확한 타입과 필수/선택 여부는 UCP01에서 프런트·서버에 동일하게 확정한다.

| 정보 | 용도 |
| --- | --- |
| `entities` | 대상별 안정적인 장면 내부 ID, 종류, 수량, 속성 |
| `relations` | 주체·행동·목적어, 소유·위치 관계. 대상 ID 참조 |
| `environment` | 장소, 시간, 조명, 구도, 스타일 |
| `constraints` | 부정 조건, 사용자 고정·직접 선택·제외 |
| `dictionary_bindings` | 사전 ID, 선택 출처, 가능한 경우 대상 ID, 원문 근거 |
| `unmapped_details` | 사전에 없는 의미를 온전한 문맥으로 보존 |
| `ambiguities` | 서로 충돌하거나 해석을 확정할 수 없는 부분과 해결 선택지 |

대상별 귀속을 기존 평면 Scene v1에 억지로 저장하지 않는다. 새 장면 안에서 대상 ID에 연결하며, UI가 아직 대상별 편집을 지원하지 않는 항목은 일반 칩으로 단정하지 말고 디테일과 한글 요약으로 보존한다. 서로 다른 인물의 머리색을 전역 충돌로 판단해서는 안 된다.

### 선택 우선순위

- 직접 선택과 고정 항목은 보호한다. 한글 설명이 보호 항목과 명백하게 충돌하면 해당 부분만 확인한다.
- AI 자동 선택은 최신 원문 분석으로 교체할 수 있다. 이전 자동 선택을 누적해 모순을 만들지 않는다.
- 사용자가 자동 칩을 삭제하면 제외 제약으로 남긴다. 재분석이 임의로 다시 추가하지 않으며, `제외 해제` 또는 장면 초기화로 해제한다.
- 대상에 귀속된 선택의 제외는 대상 단위로 관리한다. 사용자 입력과 제외가 충돌하면 조용히 누락하지 말고 충돌로 표시한다.
- 고정 해제와 선택 삭제를 구별한다. 직접 선택한 항목은 출처가 유지되며 단순 고정 해제로 AI 변경 대상으로 바뀌지 않는다. AI에 맡기기 동작이 필요하면 별도로 제공한다.
- 모델 변경은 장면 의미와 사용자 제약을 유지한다. 모델 ID 또는 출력 프로필 변경으로 기존 후보는 만료되고 재생성이 필요하다. 이전 최종 입력과 적용 이력은 보존한다.
- 통합 결과 반영은 장면과 후보가 함께 갱신되는 원자적 동작이다. 한 번의 되돌리기로 직전 상태에 복귀한다. 이후 사용자가 편집했다면 그 편집을 덮어쓰는 되돌리기를 막거나 차이를 명시한다.

## 5 통합 API와 LLM 처리

### 신규 계약

새 `POST /api/v1/prompt/compose`를 추가하는 것을 기본 설계로 한다. 기존 `/proposals`의 네 가지 kind와 응답 의미는 유지한다. 기존 인증, 요청 크기 검사, provider 연결, GPU gate 정책을 재사용한다. 브라우저에서 외부 LLM이나 gate를 직접 호출하지 않는다.

`GET /system/capabilities`에는 `prompt_compose` 지원 버전, 사전 버전, 출력 프로필 버전, 제한과 timeout을 독립적으로 광고한다. 구 서버가 기존 제안만 지원한다고 해서 통합 기능을 지원한다고 판단하지 않는다.

요청은 `schema_version`, `request_id`, `input_revision`, `dictionary_version`, `target_model_id`, `target_family`, `profile_version`, `brief_ko`, 사용자 선택·고정·제외, `candidate_count`를 포함한다. 모델 ID와 계열은 서버 registry와 대조한다. 사용자의 선택 표현을 신뢰해 서버 사전을 대체하지 않는다.

응답은 서버가 발급한 결과 ID, 요청 ID/revision, 상태, 대상 모델·계열·프로필, 한글 요약, 구조화된 장면, 검증된 사전 연결, 영어 후보, 충돌·경고, provider 출처를 포함한다. 후보는 ID, 한국어 제목·차이 설명, `positive_prompt`, 적용 가능한 경우 `negative_prompt`, 의미 보존 확인 항목을 갖는다.

상태는 `ready`, `needs_clarification`, `unavailable`을 구분한다. `needs_clarification`에서는 선택지와 근거를 보여주고 해결 전 후보 적용을 막는다. 형식 오류와 인증·크기 오류는 HTTP 오류로 구별한다. 잘못된 LLM 응답을 정상적인 빈 성공으로 위장하지 않는다.

### 처리 순서

1. 인증, capability, 입력·모델·사전·제약을 검증한다.
2. 원문 전체와 사용자 제약, 유효 사전, 해당 모델 출력 프로필을 LLM에 전달한다.
3. 기본은 한 번의 구조화된 LLM 호출로 장면과 최대 3개 후보를 받는다. 별도의 검증 LLM 호출을 필수로 추가하지 않는다.
4. 서버에서 응답 스키마, 유효 사전 ID, 대상 참조, 보호·제외 조건, 크기, 후보 개수, 모델 일치를 검증한다.
5. 검증된 결과만 반환한다. 현재 revision과 일치하는 응답만 프런트가 반영한다.

LLM이 자신의 결과를 검토했다는 문구는 정확성 보장이 아니다. 결정적인 계약 검증은 서버가 수행하고, 관계·의미 보존은 고정 평가 사례와 실제 응답 검토로 확인한다. 원문에 없는 인물·의상·행동·스타일·품질 수식어를 기본 후보에 추가하지 않는다.

### 후보와 모델별 출력

기본 후보는 원문 충실형이다. 추가 후보는 같은 장면의 간결한 표현과 상세한 표현 등 유의미한 차이가 있을 때만 생성한다. 후보 수를 맞추기 위해 장면을 바꾸거나 사실을 추가하지 않는다. 동일한 후보만 나오는 경우 1개를 반환해도 정상이다.

프로필은 모델 계열과 필요한 체크포인트 override를 구분한다. 현재 코드의 지원 계열 `sd15`, `z-image`, `flux2`, `moss-image`를 기준으로 registry와 실제 입력 지원을 확인한다. SD 계열의 태그·짧은 구절 방식과 자연어 계열의 관계 중심 문장을 구분하되, 단순 구분자 교체로 최적화 완료를 선언하지 않는다.

부정 조건은 누락하지 않는다. negative prompt 지원 모델에서는 적절한 필드로 전달하고, 지원하지 않는 모델에서는 지원되는 표현 방식으로 보존하거나 한계를 표시한다. 사용자 기존 negative prompt는 몰래 교체하지 않는다. 후보 적용 시 positive/negative 변경 내역을 함께 보여주고 교체 대상을 명시한다. 엔진이 지원하지 않는 weighting 문법을 생성하지 않는다.

### UCP01 확정 계약: 통합 compose 요청·응답

이 절의 수치는 `config/models.yaml`, `config/prompt_dictionary.json`(v1.2.0, 활성 100개),
현재 `JobRequest`·`PromptCompositionV2` 스키마로 실측한 값이다. 프런트와 서버가 같은 값을
사용하며, 구현은 이 값을 상수로 옮기고 테스트에서 재측정한다.

#### 크기 상한의 원칙

기존 `check_snapshot`은 **필드별 바이트 예산을 두지 않는다.** 그 이유는
`backend/app/models/schemas.py`에 기록되어 있다. 필드별 바이트 상한을 추가하면 브라우저의
`validateComposition`과 갈라지는 두 번째 진실이 생기기 때문이다. 따라서 새 계약도 같은
원칙을 따른다.

- **의미 상한**(문자 수): 화면에 보여줄 카드 수와 한 문자열의 길이를 정한다.
- **집계 상한**(UTF-8 바이트): 저장 가능 여부를 결정하는 유일한 크기 판정이다.
- 두 종류를 섞지 않는다. 문자 수와 바이트 수를 같은 표에서 비교하지 않는다.

#### 집계 상한

| 대상 | 상한 | 근거 |
| --- | --- | --- |
| v3 스냅샷 JSON | 32,768 B | 기존 `check_snapshot`·`validateComposition`과 동일. 새 상한을 만들지 않는다 |
| `POST /api/v1/prompt/compose` 요청 | 24,576 B | 실측 최대 19,352 B(문서화된 의미 상한 기준) + 여유 |
| `POST /api/v1/prompt/compose` 응답 | 49,152 B | 아래 응답 축소 규칙을 적용한 뒤의 상한 |
| 생성 작업 body | 65,536 B | 기존 `max_body_bytes` 기본값. 변경하지 않는다 |
| LLM provider 요청 | 32,768 B | 실측 최대 29,515 B. 사전이 커지면 `category` 순서로 뒤쪽을 자른다(아래) |

compose 응답 상한이 기존 제안 응답 16 KiB보다 큰 이유는 장면 전체와 후보 3개를 함께
반환하기 때문이다. 기존 `/proposals`의 16 KiB 상한은 그대로 둔다.

장면을 의미 상한까지 채우면 장면 하나가 73,783 B이고, 후보 3개를 더한 응답은 99,113 B다.
따라서 응답도 **스냅샷과 같은 축소 사다리**를 적용한 뒤 상한을 판정한다. 실측 결과는 다음과
같다.

| 사다리 적용 | 후보 3개 | 후보 2개 | 후보 1개 |
| --- | --- | --- | --- |
| 없음(모든 의미 상한) | 99,113 | 93,172 | 87,231 |
| 1~2단계 | 86,501 | 80,560 | 74,619 |
| 3단계(속성 첫 항목) | 52,733 | 46,792 | 40,851 |
| 7단계(장면 배열 2개) | 30,627 | 24,686 | 18,745 |

응답은 다음 순서로 줄인다. 3단계까지 적용해도 49,152 B를 넘으면 **후보 개수를 하나씩
줄인다**(3→2→1). 후보를 문장 중간에서 자르지 않는다. 후보 1개로도 넘으면 7단계를 적용한다.
실제로는 3단계 + 후보 2개(46,792 B)에서 처음으로 상한 안에 들어온다.

후보를 줄인 사실은 `candidate_count_requested`와 실제 `candidates` 길이의 차이로 드러나며,
`warnings`에 `candidates_reduced`를 남긴다. 조용히 후보를 버리지 않는다.

LLM provider 요청은 사전 활성 100개(`id`·`category`·`label_ko`·`aliases`)를 모두 넣고
`brief_ko` 4,000자, 선택 100개를 채우면 29,515 B다. 32,768 B 안에 들어오므로 평상시에는
사전을 줄이지 않는다. 사전이 커져 32,768 B를 넘으면 요청을 거절하지 않고 `category`
우선순위로 뒤쪽 항목을 잘라 보낸다. 잘린 사실은 `dictionary_truncated: true`로 응답에
남긴다. `aliases`는 매칭 품질에 필요하므로 사전 항목을 버리기 전에는 제거하지 않는다.

#### 의미 상한

| 필드 | 상한 | 비고 |
| --- | --- | --- |
| `brief_ko` | 4,000자 | 기존 한글 입력 상한과 동일 |
| `selections` (선택+제외 합계) | 100개 | 기존 `MAX_SELECTIONS`와 동일 |
| `selections[].id` | 100자 | 기존 `CompositionSelection.id` |
| `candidates` | 3개 | `candidate_count`로 1~3 |
| `candidates[].positive_prompt` | 2,000자 | 계열별 프로필이 더 짧게 제한할 수 있다 |
| `candidates[].negative_prompt` | 800자 | negative 미지원 모델은 필드 자체를 생략 |
| `candidates[].title_ko` | 40자 | |
| `candidates[].difference_ko` | 240자 | |
| `candidates[].preserved_ko` | 6개 × 120자 | 의미 보존 확인 항목 |
| `summary_ko` | 600자 | |
| `scene.entities` | 8개 | 각 8개 속성, 속성 1개당 200자 |
| `scene.entities[].evidence_ko` | 200자 | 원문 근거 인용. 축소 1순위 |
| `scene.relations` | 12개 | |
| `scene.relations[].evidence_ko` | 200자 | 축소 1순위 |
| `scene.environment` | 6개 키 | `location`·`time`·`lighting`·`composition`·`style`·`mood` |
| `scene.unmapped_details` | 8개 × 200자 | 기존 `MAX_UNRESOLVED_CHARS`와 동일 |
| `scene.ambiguities` | 8개 × 200자 | 선택지 최대 6개 |
| `clarifications` | 3개 × 200자 | 선택지 6개 × 80자 |
| `warnings` | 4개 × 200자 | |

`scene.*` 문자열 200자와 `candidates` 개수는 기존 `prompt_proposals.py`의
`MAX_UNRESOLVED_CHARS`·`MAX_VARIANTS`와 맞춘다. 새 숫자를 만들지 않는다.

#### 집계 상한 초과 시 동작

문장을 조용히 잘라내지 않는다. 위 의미 상한은 필드 하나하나의 최대치일 뿐, **동시에 모두
채우면** 집계 상한을 넘는다(실측: 모든 의미 상한을 동시에 채운 v3 = 107,585 B). 그래서
집계 상한을 넘을 때만 다음 **고정 순서**로 구조를 낮춘다. 각 단계는 결정적이고 순서가
고정되어 있으며, 적용된 단계 이름을 `snapshot_trim`에 남긴다.

측정 기준은 "모든 의미 상한을 동시에 채운 107,585 B 스냅샷"이고, 표의 두 숫자는 그 상태에서
해당 단계까지 **누적 적용**했을 때의 결과 크기와 직전 단계 대비 감소량이다.
`backend/measure_ladder.py`가 이 표를 다시 측정하며, `backend/tests/test_prompt_composition_v3.py`의
`LABELED_STEPS`가 같은 fixture에서 나온 단계 목록을 고정한다. 이 표와 그 상수가 어긋나면
사다리나 의미 상한이 움직인 것이다.

| 순서 | 낮추는 대상 | 보존되는 것 | 실측 결과 | 절감 |
| --- | --- | --- | --- | --- |
| 1 | `scene.entities[].evidence_ko`, `scene.relations[].evidence_ko` | 인용만 제거. 개체·관계·속성 전부 유지 | 95,625 B | 11,960 |
| 2 | `scene.ambiguities[].options` | 질문과 이유 유지. 선택지는 다시 계산 | 95,105 B | 520 |
| 3 | `scene.entities[].attributes_ko`를 첫 항목만 | 개체·수량·첫 속성 유지 | 61,337 B | 33,768 |
| 4 | `scene.unmapped_details[].text_ko`를 200자로 | 항목 수와 개체 귀속 유지 | 61,337 B | 0 |
| 5 | `brief_ko`를 2,000자로 | 원문 앞부분. 잘린 사실을 기록 | 55,337 B | 6,000 |
| 6 | `scene.environment` 제거 | 개체·관계·미변환·모호성 유지 | 51,644 B | 3,693 |
| 7 | `scene`의 각 배열을 2개로 | 가장 중요한 개체·관계 2개 유지 | 31,710 B | 19,934 |

4단계가 0 B인 것은 의미 상한이 이미 `unmapped_details[].text_ko`를 200자로 제한하므로
정상 입력에서는 자를 것이 없기 때문이다. 상한을 넘는 과거 데이터가 들어온 경우에만
효과가 있다. 이 단계를 지우지 않고 남기는 이유는 그런 입력에서도 수렴을 보장하기 위해서다.

**`source: "excluded"`는 어떤 단계에서도 제거하지 않는다.** 제외 목록은 자동 재선택을
막는 유일한 근거이므로, 저장과 복원 뒤에도 남아야 한다. 제외 항목 하나는 `id`만 가져
47 B이고, 선택 100개를 전부 제외로 채워도 4,700 B다. 이 결정으로 사다리는 8단계가 아니라
7단계가 되고, 사다리 적용 **전** v3 최대치는 107,585 B다.

7단계까지 적용하면 31,710 B로 32 KiB 안에 들어온다. 7단계에서도 넘으면 `scene`을 전부
제거한다(실측 26,928 B). `applied.positive_prompt`·`applied.negative_prompt`·
`applied.summary_ko`·`brief_ko`(2,000자까지)·사용자가 고른 `selections`·제외
`selections`는 **어떤 단계에서도 제거하지 않는다.** 실제 실행된 문자열과 구성 기록이
달라지면 기록이 거짓이 된다.

`scene`까지 제거해도 32 KiB를 넘으면 저장을 거절하고 `422`와 함께 초과 바이트를 알린다.
이 경로는 **도달 가능하다**. 사다리는 `applied`·`selections`·`brief_ko`(2,000자)·
`target_*`·`dictionary_version`을 지울 수 없으므로 그 합이 바닥값이고, 의미 상한을 채운
바닥값은 실측 66,066 B다(모두 한글, `applied` 3필드 + 선택 100개 + `brief_ko` 4,000자).
이미 32 KiB를 넘으므로 어떤 단계도 도울 수 없다. 실제로 거절되는 최소 입력도 실측했다:
`brief_ko` 3,000자 + 선택 40개(각 60자) + `positive_prompt` 8,000자를 채우면 41,945 B이고
사다리는 `brief_2000` 한 단계만 내려 38,945 B에 멈춘다 — 여전히 초과다. 그래서 거절은
가상의 경로가 아니라 **한글 입력에서 실제로 밟는 경로**이며, 두 테스트가 그것을 고정한다
(`test_the_ladder_still_refuses_when_it_cannot_get_under_the_budget`,
`test_a_record_that_the_ladder_cannot_save_is_a_422_not_a_broken_row`).

축소가 일어난 스냅샷은 온전한 복원 상태가 아니다. `snapshot_trim`이 비어 있지 않으면
복원 화면은 "축소된 기록"임을 표시하고, 근거 인용·추가 속성·선택지가 원래 있었다는
사실을 복원된 값으로 추정하지 않는다. 축소된 필드는 **없는 것이지 빈 값이 아니다.**

#### 생성 body와의 결합

v3 스냅샷은 생성 body 안에 들어가므로 두 상한이 **동시에** 성립해야 한다.
실측한 최악 조합은 다음과 같다.

| 상태 | prompt | body | 스냅샷 예산 | 결과 |
| --- | --- | --- | --- | --- |
| 적용 전(한글 원문) | 한글 8,000자 + 4,000자 | 36,184 B | 29,352 B | 스냅샷은 `applied` 없이 원문·선택만 |
| 적용 후(영어) | 2,000 / 800자 | 2,984 B | 32,768 B | 32,768 + 2,984 = 35,752 B로 여유 |
| 절대 최대(모든 옵션) | 한글 8,000자 + 4,000자 | 36,537 B | 28,999 B | 바닥값 25,704 B이므로 통과 |

따라서 스냅샷 예산은 `min(32768, 65536 - body_without_snapshot)`으로 계산한다.
한글 최대 body에 32 KiB 스냅샷을 함께 보내면 36,184 + 32,768 = 68,952 B가 되어 65,536 B를
넘는다. 그래서 한글 최대 상태에서는 `applied`가 존재할 수 없다는 점을 계약으로 고정한다.
한글 최대 상태는 아직 아무 후보도 적용하지 않은 상태이므로 `applied`가 없는 것이 정상이다.
적용이 끝나면 prompt는 영어가 되고 body는 2,984 B로 줄어 32 KiB 스냅샷이 들어간다.

#### 요청 예시

`POST /api/v1/prompt/compose`, `Authorization: Bearer <token>`.

```json
{
  "schema_version": 1,
  "request_id": "cmp-0123456789ab",
  "input_revision": "sha256:6f1c…",
  "dictionary_version": "1.2.0",
  "target_model_id": "pornmaster-klein-9b",
  "target_family": "flux2",
  "profile_version": 1,
  "candidate_count": 3,
  "brief_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
  "selections": [
    {"id": "clothing.dress", "source": "manual", "pinned": true},
    {"id": "style.illustration", "source": "excluded"}
  ],
  "clarification_choices": []
}
```

| 필드 | 필수 | 제약 |
| --- | --- | --- |
| `schema_version` | 필수 | `1` |
| `request_id` | 필수 | `cmp-` + 12 hex. 프런트가 만들고 응답에서 그대로 돌려받는다 |
| `input_revision` | 필수 | `sha256:` + 64 hex. 원문·선택·고정·제외·모델·프로필을 모두 포함해 계산한다 |
| `dictionary_version` | 필수 | 서버 사전과 다르면 `409 stale_dictionary` |
| `target_model_id`, `target_family` | 필수 | registry와 대조. 불일치 `422` |
| `profile_version` | 필수 | 서버 프로필과 다르면 `409 stale_profile` |
| `candidate_count` | 필수 | 1~3 |
| `brief_ko` | 선택 | 0~4,000자. **비어 있어도 된다.** 사전 선택만으로 생성할 수 있다 |
| `selections` | 선택 | 최대 100. `id`·`source`·`pinned`·`entity_id`를 모두 받는다. `source`는 아래 규칙으로 서버가 재판정한다 |
| `clarification_choices` | 선택 | 최대 8. `{question_id, option_id}` |

`input_revision`은 서버가 다시 계산해 비교한다. 클라이언트가 보낸 값을 신뢰하지 않는다.
계산 대상은 `brief_ko`, `selections`의 `id`·`source`·`pinned`·`entity_id`,
`clarification_choices`, `target_model_id`, `profile_version`, `dictionary_version`이다.
`request_id`는 제외한다.

`brief_ko`가 비어 있고 `selections`도 비어 있으면 생성할 것이 없으므로 `422`로 거절한다.
둘 중 하나만 있으면 유효하다. "선택만 있는 요청"과 "아무것도 없는 요청"을 같은 빈 성공으로
처리하지 않는다.

#### 선택 출처를 서버가 판정하는 방법

요청의 `source`를 그대로 믿지 않는다. 서버는 각 항목을 다음 규칙으로 **다시 판정**한다.

| 요청 상태 | 서버 판정 | 근거 |
| --- | --- | --- |
| `source: "excluded"` | 제외 유지. 생성 대상에서 빠지고 재선택 금지 목록에 들어간다 | 제외 의도는 사용자만 만들 수 있다. AI가 제외를 만들지 않으므로 신뢰해도 안전하다 |
| `source: "manual"` | 직접 선택으로 유지. `pinned` 값과 무관하게 `auto`로 강등하지 않는다 | 직접 고른 사실은 요청에 실려 오고, AI는 그 사실을 만들 수 없다 |
| `source: "auto"` | 자동 선택 후보로 취급. 서버가 다시 검증하고 필요하면 교체한다 | AI 판단이므로 서버 검증 대상이다 |
| `source` 없음 | `auto`로 간주 | 구 클라이언트 호환. 직접 선택 보호를 주장할 수 없다 |

즉 `manual`과 `excluded`는 **사용자 의도의 기록**이므로 보존하고, `auto`만 서버가
재검증한다. 이것이 "출처를 무조건 신뢰하지 않으면서 사용자 의도를 보존하는" 방법이다.

`pinned`는 출처와 다른 개념이다. `pinned: true`는 "다음 생성에서도 이 항목을 유지하라"는
요청이고, `source: "manual"`은 "내가 직접 골랐다"는 사실이다. `manual` + `pinned: false`는
"내가 골랐지만 다음 자동 선택에서 바뀌어도 된다"는 뜻이며, AI 자동 선택으로 **출처가
바뀌지는 않는다.** 출처는 `manual`로 남고 `pinned`만 `false`다.

#### 응답 예시 (`ready`)

```json
{
  "schema_version": 1,
  "status": "ready",
  "result_id": "cmp-0123456789ab",
  "request_id": "cmp-0123456789ab",
  "input_revision": "sha256:6f1c…",
  "target_model_id": "pornmaster-klein-9b",
  "target_family": "flux2",
  "profile_version": 1,
  "dictionary_version": "1.2.0",
  "summary_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있는 장면",
  "selections": [
    {"id": "subject.person", "source": "auto", "pinned": false, "entity_id": "entity-1"},
    {"id": "clothing.dress", "source": "manual", "pinned": true, "entity_id": "entity-1"},
    {"id": "location.street", "source": "auto", "pinned": false}
  ],
  "scene": {
    "entities": [
      {"entity_id": "entity-1", "kind": "person", "count": 1,
       "attributes_ko": ["붉은 원피스"], "evidence_ko": "붉은 원피스를 입은 여성"}
    ],
    "relations": [
      {"subject_entity_id": "entity-1", "predicate_ko": "서 있다",
       "object_entity_id": null, "evidence_ko": "거리에 서 있다"}
    ],
    "environment": {"location_ko": "비 오는 거리", "lighting_ko": "흐린 날 빛"},
    "unmapped_details": [{"text_ko": "비에 젖은 아스팔트 반사", "entity_id": null}],
    "ambiguities": []
  },
  "candidates": [
    {
      "candidate_id": "candidate-1",
      "title_ko": "원문 충실",
      "difference_ko": "원문의 인물·의상·장소를 그대로 옮긴 기본 후보",
      "positive_prompt": "a woman wearing a red dress, standing on a rainy street",
      "negative_prompt": "blurry, deformed hands",
      "preserved_ko": ["붉은 원피스", "비 오는 거리", "서 있는 자세"]
    }
  ],
  "clarifications": [],
  "warnings": [],
  "snapshot_trim": [],
  "provider": {"model": "qwen3-test", "latency_ms": 4120, "finish_reason": "stop"}
}
```

`scene`은 v3 예시와 같은 형태이며, 서버가 사전으로 검증한 결과다. 요청의 `selections`를
그대로 되돌려주지 않는다. 검증에서 탈락한 항목은 `selections`에 넣지 않고 `warnings`에
이유를 남긴다.

#### 응답 예시 (`needs_clarification`)

`candidates`는 빈 배열이고 `clarifications`가 채워진다. 두 필드는 동시에 채워지지 않는다.

```json
{
  "schema_version": 1,
  "status": "needs_clarification",
  "result_id": "cmp-0123456789ab",
  "request_id": "cmp-0123456789ab",
  "input_revision": "sha256:6f1c…",
  "target_model_id": "pornmaster-klein-9b",
  "target_family": "flux2",
  "profile_version": 1,
  "dictionary_version": "1.2.0",
  "summary_ko": "인물이 둘인데 누가 서 있는지 확정할 수 없습니다",
  "selections": [],
  "scene": {"entities": [], "relations": [], "environment": {},
            "unmapped_details": [], "ambiguities": []},
  "candidates": [],
  "clarifications": [
    {
      "question_id": "clar-01",
      "question_ko": "서 있는 사람은 누구인가요?",
      "why": "actor_unknown",
      "options": [
        {"option_id": "opt-01", "label_ko": "앞에 있는 여성"},
        {"option_id": "opt-02", "label_ko": "뒤에 있는 남성"}
      ]
    }
  ],
  "warnings": [],
  "snapshot_trim": [],
  "provider": {"model": "qwen3-test", "latency_ms": 3980, "finish_reason": "stop"}
}
```

`why`는 `actor_unknown`·`polarity_conflict`·`model_mismatch`·`dictionary_missing` 중 하나다.

#### Clarification 응답의 revision 규칙

`clarification_choices`는 **원문이나 선택을 바꾸지 않고 질문에 답만 더한다.** 따라서 답을
보낼 때 원문·선택 revision은 유지되고, 답 자체가 revision에 더해진다. 구분은 다음과 같다.

| 변경 | `brief_revision` | `selection_revision` | `choice_revision` | 결과 revision |
| --- | --- | --- | --- | --- |
| 원문 수정 | 바뀜 | 유지 | **초기화** | 바뀜 |
| 선택·고정·제외 수정 | 유지 | 바뀜 | **초기화** | 바뀜 |
| 질문 답변만 추가 | 유지 | 유지 | 바뀜 | 바뀜 |

`input_revision`은 세 값을 모두 포함해 계산한다. 그래서 답만 추가해도 전체 revision은
바뀌지만, 원문과 선택 revision은 그대로다. 이것이 "같은 revision에 답을 더한다"와
"revision이 갱신된다"를 동시에 만족시키는 방법이다.

`choice_revision`은 `clarification_choices`의 질문·선택 쌍만으로 계산한다. 원문이나 선택이
바뀌면 이전 질문은 더 이상 그 장면의 질문이 아니므로 `clarification_choices`를 **버린다.**
버리지 않으면 오래된 질문의 답이 새 장면에 적용된다.

서버는 각 `question_id`가 **현재 revision에서 발급된 질문**인지 확인한다. 발급 당시의
`input_revision`과 요청의 원문·선택 revision이 다르면 `409 stale_clarification`으로
거절하고, 답을 적용하지 않는다. 조용히 무시하거나 새 장면에 추측 적용하지 않는다.

#### 상태 전이

`status`는 세 값이고 HTTP 코드와 분리한다.

| 현재 | 사건 | 다음 | 프런트 동작 |
| --- | --- | --- | --- |
| — | 요청 전송 | `pending` (로컬) | 같은 `input_revision`의 중복 전송 차단 |
| `pending` | `ready` + 같은 revision | `ready` | 장면·후보를 한 번에 반영. 후보는 적용 전까지 실제 prompt를 덮지 않음 |
| `pending` | `ready` + 다른 revision | `stale` | 결과 폐기. 입력은 유지, 자동 재요청 없음 |
| `pending` | `needs_clarification` | `needs_clarification` | 후보 적용 차단, 선택지 표시 |
| `needs_clarification` | 답 선택 후 재전송 | `pending` | `choice_revision`만 갱신. 원문·선택 revision 유지 |
| `needs_clarification` | 원문·선택 수정 | `needs_clarification` (로컬 `stale`) | `clarification_choices` 폐기. 이전 질문은 더 이상 유효하지 않음 |
| `pending` | `unavailable` | `unavailable` | 직접 입력·수동 사전 경로 유지 |
| `pending` | HTTP 4xx/5xx | `error` | 원문·선택·최종 입력 유지 |
| `pending` | 취소 | `idle` | 요청 abort. 도착한 응답은 revision과 무관하게 폐기 |
| `ready` | 모델·프로필 변경 | `expired` | 후보 만료 표시. 이전 적용 이력은 보존 |
| `ready` | 후보 적용 | `applied` | v3 스냅샷 생성. 적용은 장면+후보 원자적 갱신 |
| `applied` | 원문·선택 수정 | `dirty` | 적용 스냅샷은 유지, 새 요청은 revision 갱신 후 |

`pending`·`stale`·`expired`·`dirty`는 프런트 로컬 상태이고 서버 `status`가 아니다.
서버는 `ready`·`needs_clarification`·`unavailable`만 반환한다.

#### 오류 코드

형식 오류·인증·크기 오류는 `status`가 아니라 HTTP 오류로 구분한다. 정상적인 빈 성공으로
위장하지 않는다.

| 코드 | 의미 |
| --- | --- |
| `400` | JSON 형식 오류, 필수 필드 누락 |
| `401` | 인증 실패 |
| `409` | `stale_dictionary`·`stale_profile`·`model_family_mismatch`·`stale_clarification`. 재조회 후 재시도 |
| `413` | 요청이 24,576 B 초과 |
| `422` | 스키마 위반, 존재하지 않는 사전 ID, 장면 참조 오류, 스냅샷 32 KiB 초과 |
| `503` | LLM/gate 사용 불가. `status: unavailable` 본문과 함께 반환할 수 있다 |

`422`의 본문은 초과한 필드 경로와 실제/허용 바이트를 포함한다. 조용히 잘라 저장하지 않는다.



| 항목 | 값 | 근거 |
| --- | --- | --- |
| provider 요청 timeout | 60초 | 기존 `/proposals` 20초는 후보 1개 기준. 장면+후보 3개는 출력 토큰이 4배 이상이다 |
| 브라우저 client timeout | 65초 | 서버 timeout + 5초. 기존 `CLIENT_TIMEOUT_MS`의 여유 규칙을 유지 |
| `max_tokens` | 8,192 | 아래 추정 참조 |
| 동시 요청 | credential당 1개, 전체 2개 | 기존 제한 유지 |
| 자동 재시도 | 없음 | 기존 규칙 유지 |

출력 토큰은 tokenizer가 설치되어 있지 않아 **추정값**이다. 가정: 한글 약 1.3 tok/char,
ASCII 약 0.25 tok/char. 이 가정을 테스트에 고정하지 않고, 실제 provider 응답의
`finish_reason`이 `length`인 비율로 사후 검증한다.

| 구성 | 추정 토큰 |
| --- | --- |
| 장면 1개(요약 600자 + 개체 4 + 관계 4 + environment 6 + unmapped 4 + ambiguities 3) | ~4,900 |
| 후보 1개(positive 2,000 + negative 800 ASCII + 한글 520자) | ~1,220 |
| 후보 3개 + 장면 | ~8,600 |

따라서 `max_tokens` 8,192는 후보 3개에서 빠듯하다. 후보 1개가 잘리면
`finish_reason: length`를 `status: "ready"`로 위장하지 않고, 완전한 후보만 반환하고
`cut_short: true`로 알린다. 후보가 0개가 되면 `unavailable`이다.

#### 모델별 negative prompt 지원

`config/models.yaml`의 `generation_options.negative_prompt`가 기준이다.
`supported_parameters`에 없어도 `mode: verified`이면 지원한다.

| 모델 | family | negative 지원 | 조건 | 계약 동작 |
| --- | --- | --- | --- | --- |
| `fake` | fake | 지원 | — | 테스트 전용 |
| `klein-4b-q4`, `klein-4b-q8` | flux2 | 미지원 | CFG 1 고정 | `negative_prompt` 필드 생략, `warnings`에 `negative_unsupported` |
| `pornmaster-klein-9b` | flux2 | 지원 | `cfg_scale` 2.0일 때만 | CFG 2.0이 아니면 필드 생략 + 경고. CFG를 임의로 바꾸지 않는다 |
| `z-image-turbo`, `z-image-nsfw-v2` | z-image | 미지원 | CFG 1 고정 | 필드 생략 + 경고 |
| `realistic-vision-v6` | sd15 | 지원 | — | 항상 포함 가능 |
| `moss-image-nsfw`, `moss-image-nsfw-q8` | moss-image | 미지원 | CFG 3 고정 | 필드 생략 + 경고 |

`pornmaster-klein-9b`는 `supported_parameters`에 `negative_prompt`가 없지만
`generation_options`가 `verified`이고 `requires.cfg_scale: [2.0]`이다. 이 불일치를
계약에서 명시한다. 서버는 이 모델에 negative를 넣을 때 현재 `cfg_scale`이 2.0인지
확인하고, 아니면 negative를 빼고 `negative_requires_cfg` 경고를 남긴다.

후보의 `negative_prompt` 필드가 없으면 프런트는 이를 "부정 조건 없음"이 아니라
"이 모델이 지원하지 않음"으로 표시한다. 사용자의 기존 negative를 조용히 지우지 않는다.

자동 무한 재시도는 금지한다. 초기 구현은 사용자 재시도 방식으로 충분하다. timeout·취소·응답 형식 오류·GPU 사용 불가 시 원문, 수동 선택, 최종 입력, 기존 적용 이력을 유지한다. LLM 미지원 환경은 수동 사전 미리보기와 직접 입력으로 계속 사용할 수 있으며, 규칙 매칭 결과를 AI 해석 완료로 표시하지 않는다.

## 6 저장과 복원 호환성

통합 결과용 `prompt_composition` v3를 추가하는 것을 기본 설계로 한다. 기존 v1/v2는 계속 읽고 검증한다. UCP01에서 기존 union과 직렬화 경로를 확인해 v3 필드를 확정한다.

v3는 적용 시점의 원문, 구조화된 장면, 선택 출처·고정·제외, 사전/프로필 버전, 대상 모델·계열, 선택 후보 ID, 실제 적용 positive/negative 문자열, provider 모델과 결과 ID, 적용 시각을 저장한다. 모든 미선택 후보와 전체 LLM 원문 응답을 생성 이력에 저장할 필요는 없다. 적용 이후 수동 편집된 최상위 prompt는 실제 실행의 기준이며 구성 기록과 다른 상태로 표시한다.

v1/v2에 없던 출처나 대상 귀속을 복원 시 추정하지 않는다. 과거 결과 복원만으로 LLM 호출이나 새 스키마 재작성은 하지 않는다. 사용자가 다시 만들기를 실행할 때 새 장면으로 변환하고 원래 기록은 유지한다.

### UCP01 확정 계약: v3 스냅샷

v3는 v2의 `remainder`를 유지하면서 장면·출처·적용 결과를 더한다. `extra="forbid"`와
`schema_version` discriminator는 v1/v2와 동일하게 유지한다. v2 body에 v3 키가 있으면
`extra_forbidden`으로 실패해야 하며, v3를 v2로 낮춰 읽지 않는다.

핵심 결정 하나를 명시한다. **선택과 제외를 하나의 `selections` 배열로 합친다.**
별도 `dictionary_bindings`·`excluded_ids` 배열을 두면 같은 사전 ID를 두 곳에서 관리하게
되고, 실측에서 제외 100개가 2,118 B를 차지했다. `source`가 `auto`·`manual`·`excluded`인
단일 배열이면 항목당 최대 86 B(`manual`+`pinned:false`+`entity_id`)이고 `excluded`는
`id`만 가져 47 B다. `auto`와 `manual`의 차이는 2 B이므로 출처를 별도 배열로 분리하지
않고도 보존할 수 있다. 이 결정으로 v3 최대치가 32 KiB 안에 들어온다.

```json
{
  "schema_version": 3,
  "compiler_version": "1.3.0",
  "dictionary_version": "1.2.0",
  "target_model_id": "pornmaster-klein-9b",
  "target_family": "flux2",
  "profile_version": 1,
  "brief_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있다",
  "selections": [
    {"id": "subject.person", "source": "auto", "pinned": false, "entity_id": "entity-1"},
    {"id": "clothing.dress", "source": "manual", "pinned": true, "entity_id": "entity-1"},
    {"id": "action.standing", "source": "auto", "pinned": false, "entity_id": "entity-1"},
    {"id": "location.street", "source": "auto", "pinned": false},
    {"id": "lighting.overcast", "source": "auto", "pinned": false},
    {"id": "style.illustration", "source": "excluded"}
  ],
  "scene": {
    "entities": [
      {"entity_id": "entity-1", "kind": "person", "count": 1,
       "attributes_ko": ["붉은 원피스"], "evidence_ko": "붉은 원피스를 입은 여성"}
    ],
    "relations": [
      {"subject_entity_id": "entity-1", "predicate_ko": "서 있다",
       "object_entity_id": null, "evidence_ko": "거리에 서 있다"}
    ],
    "environment": {"location_ko": "비 오는 거리", "lighting_ko": "흐린 날 빛"},
    "unmapped_details": [{"text_ko": "비에 젖은 아스팔트 반사", "entity_id": null}],
    "ambiguities": []
  },
  "applied": {
    "result_id": "cmp-0123456789ab",
    "candidate_id": "candidate-1",
    "provider_model": "qwen3-test",
    "applied_at": "2026-11-21T00:00:00Z",
    "positive_prompt": "a woman in a red dress standing on a rainy street, overcast daylight",
    "negative_prompt": "blurry, deformed hands",
    "summary_ko": "붉은 원피스를 입은 여성이 비 오는 거리에 서 있는 장면"
  },
  "snapshot_trim": []
}
```

| 필드 | 필수 | 타입·제약 |
| --- | --- | --- |
| `schema_version` | 필수 | `3` |
| `compiler_version`, `dictionary_version`, `target_model_id`, `target_family` | 필수 | 1~100자 |
| `profile_version` | 필수 | 정수 ≥ 1 |
| `brief_ko` | 필수 | 0~4,000자. 적용 시점 원문 |
| `selections[].source` | 필수 | `auto` \| `manual` \| `excluded` |
| `selections[].pinned` | 조건부 | `auto`·`manual`에서 필수. `excluded`에는 없음 |
| `selections[].entity_id` | 선택 | `scene.entities[].entity_id` 참조. 없으면 전역 |
| `scene.entities[].entity_id` | 필수 | 장면 내 고유. 1~40자 |
| `scene.relations[].object_entity_id` | 선택 | 없으면 단항 관계(자세·상태) |
| `scene.environment` | 선택 | 최대 6키. 빈 문자열은 키 생략 |
| `applied` | 조건부 | 적용 전에는 키 자체를 넣지 않는다(`null` 아님) |
| `applied.negative_prompt` | 선택 | 모델이 미지원이면 키 생략 |
| `snapshot_trim` | 필수 | 적용된 trim 단계 이름. 비어 있으면 `[]` |

`applied`가 없으면 "아직 적용하지 않은 편집 중 스냅샷"이고, 있으면 "실행에 쓰인 기록"이다.
두 상태를 `null`로 섞지 않는다. 복원 시 `applied`가 없으면 후보 적용 이력이 없는 것으로
표시하고, 실제 prompt를 구성 기록에서 역산하지 않는다.

`target_family`는 현재 `JobRequest` 검증과 동일하게 registry의 `family`와 일치해야 한다
(`backend/app/services/registry.py`). 불일치는 `422`다.

v3 미지원 서버에서는 최종 문자열 적용과 직접 생성은 가능하지만 v3 구성은 보내지 않는다. 저장되지 않는 범위를 안내하고 v3를 v2로 위장하지 않는다. capability 응답 실패도 이 경로로 처리한다. retry, DB 재시작, asset metadata, JSON sidecar, 갤러리 복원 모두 같은 스냅샷이 유지되어야 한다.

## 7 실행 단위와 의존성

실행 순서는 UCP01 → UCP02 → UCP03 → UCP04 → UCP05 → UCP06 → UCP07 → UCP08 → UCP09다. 각 태스크는 아래 완료 기준을 검증한 뒤 다음 단계로 넘어간다. 상태표는 현재 상태만 갱신하고 진행 히스토리는 누적하지 않는다. 외부 LLM/GPU가 필요한 검증이 막혀도 독립적인 로컬 구현과 검증은 진행한다. 환경 차단을 완료로 바꾸지 않는다.

| ID | 실행 단위 | 의존 | 상태 |
| --- | --- | --- | --- |
| UCP01 | 계약과 검증 사례 확정 | 없음 | 완료 |
| UCP02 | 구조화된 장면과 편집 상태 | UCP01 | 완료 |
| UCP03 | 통합 생성 API와 provider | UCP01, UCP02 계약 | 완료(mock), 실연결 UCP09 |
| UCP04 | 모델별 출력 프로필과 후보 검증 | UCP03 | 완료 |
| UCP05 | 통합 입력과 반응형 결과 화면 | UCP02, UCP03, UCP04 | 완료 (mock 검증) |
| UCP06 | 양방향 수정과 모바일 입력·적용 보호 | UCP05 | 완료 (통합 테스트), 실기기 UCP08 |
| UCP07 | 구성 v3 저장과 과거 복원 | UCP01, UCP06 | 대기 |
| UCP08 | 회귀와 반응형·모바일 실기기 검증 | UCP07 | 브라우저 자동화 완료 (459 checks) · 모바일 실기기 대기 |
| UCP09 | 실제 LLM과 이미지 결과 평가 | UCP08 | **환경 대기** — 실행 호스트에 llama-server·GGUF·GPU 없음(아래 UCP09 환경 확인 참조) |

### UCP01 계약과 검증 사례 확정

변경 대상은 이 문서와 계약 fixture다. 기존 schemas, registry, capability, provider 제한, frontend 상태를 읽고 4~6절의 정확한 JSON 예시, 타입, 크기와 timeout 수치를 이 문서에 추가한다. 실제 존재하는 사전 ID를 쓰며 동일 장면 후보와 상황 변형의 차이를 고정한다. 모델별 negative prompt 지원 여부도 기록한다.

실행 체크리스트:

- [x] 새 요청·응답·capability·저장 v3의 정확한 타입과 정상/충돌/실패 JSON 예시를 5·6절에 작성한다.
- [x] 요청/응답/후보/전체 저장 상한과 timeout을 실측해 확정하고 기존 v1/v2와 비교한다.
- [x] 원문·보호/제외·모델/프로필을 포함하는 revision 입력과 상태 전이 표를 확정한다.
- [x] 한글 우선·사전 우선·다인 관계·구 서버 fixture의 기대값을 독립적으로 작성한다.
- [x] 3절의 반응형 구조, 콘텐츠 기준 breakpoint, 사전 탐색/긴 후보의 표시와 검증 매트릭스를 확정한다. API 계약과 함께 모바일 상태 보존 조건을 고정한다.

capability 광고 형태(5절 구현 대상):

```json
{
  "prompt_compose": {
    "schema_versions": [1],
    "dictionary_version": "1.2.0",
    "output_profile_versions": {"flux2": 2, "sd15": 2, "z-image": 2, "moss-image": 2},
    "max_request_bytes": 24576,
    "max_response_bytes": 49152,
    "timeout_ms": 60000,
    "max_candidates": 3,
    "max_brief_chars": 4000,
    "max_selections": 100
  }
}
```

기존 `prompt_proposals`와 별도 키로 광고한다. 구 서버가 `prompt_proposals`만 광고하면
프런트는 통합 기능을 사용할 수 없다고 판단하고 직접 입력 경로를 유지한다.

완료 기준: 한글 우선, 사전 우선, 다인 관계, 충돌, 미지원, 과거 복원의 요청/응답 예시가 있고 프런트와 서버가 같은 필드 의미를 따른다. 정상·실패 fixture와 상태 전이 표가 있다. 단순 필드명 결정 때문에 반복 승인을 요청하지 않으며, 사용자 의미가 바뀌는 결정만 근거와 함께 기록한다. 반응형 UX 결정과 지원/검증 범위가 3절에 명시되어야 한다.

검증 상태: 이 문서의 수치는 `config/models.yaml`·`config/prompt_dictionary.json`(v1.2.0)과
현재 `JobRequest`·`PromptCompositionV2` 스키마로 실측했고, 44개 수치를 스크립트로 재확인했다.
v3 예시 JSON은 실제 pydantic 모델로 검증했으며 v1/v2가 v3 body를 거부하는 것도 확인했다.
수치 재측정 스크립트는 저장소에 남기지 않았고, UCP03·UCP07에서 계약 테스트로 다시 고정한다.
UCP02에서 v3 스냅샷·장면 참조·compose 요청/응답은 `backend/tests/test_prompt_compose_contract.py`
(21개)로 저장소에 고정했다. 크기 수치 자체의 재측정은 UCP03·UCP07 범위다.

### UCP02 구조화된 장면과 편집 상태

`frontend/src/prompt/`에 장면 계약과 순수 상태 전이 모듈을 추가하고 서버 대응 모델을 만든다. 원문 revision, 사용자 보호·제외, AI 선택, 결과 revision, 마지막 적용 스냅샷을 분리한다. 기존 builderState와 직접 입력 경로를 연결한다.

실행 체크리스트:

- [x] 대상/관계/환경/사전 연결 타입과 사용자 선택 출처·고정·제외 상태를 구현한다.
- [x] 입력 수정, 실행, 성공, 충돌, 오류, 취소, 만료, 적용, 복원 전이를 순수 함수로 분리한다.
- [x] 결과 도착 시 장면/후보를 함께 반영하고 다른 revision의 결과는 폐기한다.
- [x] 수동 제약과 마지막 적용 snapshot이 자동 후보 갱신에 소실되지 않는 테스트를 추가한다.

- [x] 화면 회전·폭 변경·사전 패널 접기/열기에서 상태를 재생성하지 않는다. 반응형 표시 상태와 요청 revision을 분리하고 표시 변경으로 요청을 무효화하거나 재호출하지 않는다.

완료 기준: 자동 항목 교체, 직접 선택 보존, 대상별 속성, 제외 유지, 모델 변경 무효화, 늦은 응답 무시, 한 번 되돌리기가 네트워크 없이 검증된다. 키 입력마다 LLM 호출하지 않는다. 폭 변경과 패널 표시 전환만으로 원문·선택·후보가 사라지거나 네트워크 요청이 발생하지 않는다.

#### UCP02 구현 결과

상태: 완료 (코드·단위 테스트). 브라우저 검증은 UCP05에서 mock으로, 실연결은 UCP09에서 수행한다.

변경 파일과 구현된 동작:

| 파일 | 내용 |
| --- | --- |
| `backend/app/models/schemas.py` | 장면 모델과 `check_scene()`, `PromptCompositionV3`, `ComposeRequest`·`ComposeResponse`·`ComposeCandidate`·`ComposeClarification`·`ComposeProvider`, `TrimStep` 공유 타입 |
| `frontend/src/prompt/structuredScene.ts` | 장면 파싱/검증과 편집 연산(`addManual`·`removeSelection`·`clearExclusion`·`setPinned`·`attributeTo`), `exclusionClashes`·`CLASH_RESOLUTIONS` |
| `frontend/src/prompt/composeSession.ts` | revision 4종, 전이 순수 함수, 실패 분류, 적용/되돌리기, 충돌 처리 |
| `frontend/src/prompt/composeView.ts` | 표시 전용 상태(패널·접힘·폭 등급·방향). revision으로 가는 경로가 없다 |
| `frontend/tests/prompt-ucp02.test.mjs` | 필수 11사례 + 실패 분류·손상 장면 거부·요청 ID 형식, 17개 |
| `backend/tests/test_prompt_compose_contract.py` | v3 스냅샷·장면 참조 무결성·compose 요청/응답 계약, 21개 |

이 문서에 반영한 계약 결정:

1. **편집/초안/적용 3분리.** `edit`는 사용자 입력이며 응답이 절대 쓰지 않는다. `draft`는 서버가 다시 만들 수 있는 읽기 결과다. `applied`는 추가 전용 이력이다. "AI 응답이 편집을 덮어쓰지 않는다"가 이 분리로 테스트 가능해진다.
2. **revision 4종 독립.** 원문 수정은 답변을 지우고, 칩 수정은 답변만 지우고 원문은 남기며, 답변 수정은 `choice`만 옮긴다. 반응이 다르므로 하나의 해시로 합치지 않는다.
3. **`source`는 서버가 내리지 않는다.** `manual`+`pinned:false`는 "내가 골랐지만 교체 가능"이다. 자동으로 강등되지 않는다.
4. **`removeSelection`의 비대칭.** 자동 항목 삭제는 제외(veto)를 남기고, 수동 항목 삭제는 아무것도 남기지 않는다. veto는 서버가 다시 파생한 `auto`보다 항상 우선한다(`mergeSelections` 실제 버그 수정).
5. **부분 후보는 실패가 아니다.** 쓸 수 있는 후보는 그대로 적용 가능하고, 빠진 후보는 §5의 `warnings: ["candidates_reduced"]`로 알린다(516행의 "탈락 항목은 `warnings`에 이유를 남긴다"와 같은 규칙). `cut_short`+빈 후보만 `unavailable`이다. 새 필드를 만들지 않고 기존 `warnings`를 쓴다.
6. **실패 종류의 소재.** 서버는 `ready`·`needs_clarification`·`unavailable`만 반환한다. `truncated`·`partial`·`timed_out`·`provider_error`·`invalid_reply`·`conflict`·`expired`·`cancelled`는 프런트 로컬 분류다.
7. **손상 장면은 통째로 거부한다.** 반쪽 장면을 만들지 않는다. 알 수 없는 enum·개수는 관대하게 낮추되, 존재하지 않는 entity 참조는 거부한다. 없는 선택 필드는 `""`가 아니라 `null`이다(수정 B).
8. **capability는 아직 `[1,2]`.** v3 광고는 UCP07이며, 지금 광고하면 저장 경로 없는 제출을 약속하게 된다.

검증 명령과 실제 결과:

```text
frontend: npx tsc -p tsconfig.app.json --noEmit   → 오류 없음
frontend: npm --prefix frontend run lint          → 오류 없음
frontend: npm --prefix frontend run build         → 성공
frontend: node --test 'tests/*.mjs'               → 203 통과 / 0 실패 (기존 186 + UCP02 17)
frontend: node --test tests/prompt-ucp02.test.mjs → 17 통과 / 0 실패
backend:  uv run pytest backend/tests             → 398 통과, 96 건너뜀
backend:  uv run pytest backend/tests/test_prompt_compose_contract.py → 21 통과
backend:  uv run ruff check backend/app backend/tests → All checks passed
git diff --check                                  → 오류 없음
```

브라우저 또는 실연결 검증 범위: 없음(UCP02 시점). UCP02는 순수 모듈이라 브라우저·실제 LLM 없이 검증된다. 화면 배치는 이후 UCP05에서 mock 응답으로 확인했고, 실 provider 응답은 UCP09 범위다.

모바일 검증 환경과 결과: 해당 없음(UCP02 시점, UI 미구현). 실 iOS Safari·Android Chrome은 UCP06·UCP08에서 기록한다.

남은 문제와 차단 사유: 없음.

다음 실행 단위: UCP03 통합 생성 API와 provider.


### UCP03 통합 생성 API와 provider

신규 compose 경로와 capability를 구현하고 기존 인증·gate·provider 호출을 연결한다. 원문 전체를 전달하고 구조화된 응답을 검증한다. 기존 proposals 계약은 회귀 테스트로 유지한다. 가능한 신규 파일은 `backend/app/api/compose.py`, `backend/app/services/prompt_compose.py`이며 실제 모듈 등록 위치는 저장소 구조에 맞춘다.

실행 체크리스트:

- [x] compose router를 앱에 등록하고 인증·body 제한·지원 capability를 연결한다.
- [x] 기존 provider/gate 연결을 재사용해 전체 원문과 제약을 구조화된 payload로 전송한다.
- [x] 유효 ID·대상 참조·잠금/제외·모델·버전·크기를 서버에서 검증한다.
- [x] 취소·timeout·busy·불가·잘못된 응답과 resource 해제, 구 proposals 회귀를 검사한다.

완료 기준: mock provider로 정상, clarification, malformed, unknown ID, 잘못된 대상 참조, 보호 위반, oversized, timeout, unavailable, 인증 실패가 검증된다. 구 capability 환경에서 잘못 호출하지 않는다. provider 자원이 오류 경로에서도 해제된다.

#### UCP03 구현 결과

상태: 완료(mock provider 검증). 실제 llama-server·GPU gate 실연결 검증과 16K 컨텍스트 토큰 소비량 측정은 UCP09에서 수행하며, UCP03 완료로 표시하지 않는다.

변경 파일과 구현된 동작:

| 파일 | 내용 |
| --- | --- |
| `backend/app/api/compose.py` | `POST /api/v1/prompt/compose` 라우터. 인증·body 상한(24 KiB)·capability 검사 후 provider 호출, 실패도 계약 body로 반환 |
| `backend/app/services/prompt_compose.py` | 요청 검증(사전→모델→revision 순), payload 구성, gate 제어 GET 1회 + chat POST 1회, 응답 파싱·후보 검증, `ComposeProviderClient`(수명주기·동시성) |
| `backend/app/api/routes.py` | router 등록과 capability 광고(별도 `prompt_compose` 키) |
| `backend/app/models/schemas.py` | `ComposeProvider` 토큰 필드가 `None` 허용(부재 ≠ 0) |
| `backend/tests/test_prompt_compose_api.py` | 라우트·provider 통합 44개 |
| `backend/tests/test_prompt_compose_contract.py` | 요청/응답 계약 21개 |

이번 검토에서 고친 실제 결함:

1. **provider 실패가 500으로 새던 문제.** `_failed()`가 `response=None`인 outcome을 만들어 라우트가 계약 body를 못 냈다. `_failed()`가 `validated`를 받아 계약 body를 항상 첨부하도록 고쳤고, scene이 없을 때는 `unavailable_body()`가 최소 형태로 degrade한다.
2. **잘린 응답이 `cut_short: false`로 보고되던 문제.** 파싱 실패 outcome이 `finish_reason`에서 유도한 `cut_short`를 싣지 않았다. 이제 중앙(`unavailable_response`)에서 provider block이 있을 때만 clamp해 적용한다.
3. **`unavailable`이 존재하지 않는 `entity_id`를 가리키던 문제.** `fallback_selections()`가 scene에 실제로 있는 entity일 때만 귀속을 유지한다.
4. **테스트 3건이 스스로를 검증하지 않던 문제.** `or True`류 1건, 상위 body에 없는 키를 검사하던 1건, 결과를 쓰지 않던 `model_validate` 2건을 실제 검증으로 교체했다.

제외 항목 검증 방식(주장이 아니라 구현 사실):

- 구현은 `_one_candidate`의 `entry_id in positive_prompt` — 사전 ID를 **영어 문장에 대한 대소문자 구분·비앵커 부분 문자열**로 검사한다. 의미 검사가 아니다.
- 따라서 모델이 ID를 그대로 붙여넣은 경우(`style.illustration`)는 잡고, 같은 개념을 영어 단어로 쓴 경우(`an illustration of ...`)와 대문자로 쓴 경우는 통과시킨다. 두 경우 모두 테스트로 고정해 한계를 명시했다.
- `negative_prompt`는 검사하지 않는다(부재를 뜻하는 필드이므로 올바른 동작).
- 다인 장면에서도 entity 귀속을 보지 않고 문장 내 1회 등장으로 거부한다.
- 결론: **결정적 검증으로 보장 가능한 것은 "모델이 ID를 되돌려 넣지 않았다"까지이며, 의미적 제외 준수를 보장한다고 주장하지 않는다.**

잘린 응답 처리:

- `_parse_object`는 본문이 `}`로 끝나지 않으면 복구하지 않고 `ReplyRejected`로 끝낸다. 임의 brace/배열 복구는 하지 않는다.
- `finish_reason=length`여도 **완전한 JSON**이면 후보를 살리고 `cut_short: true`로 표시만 한다. 반쪽 JSON은 후보 0개 + `unavailable`이다.
- 반환 후보 수는 요청 수와 비교해 검증한다(3 요청·4 제공 → 3개 + `candidates_reduced`; 3 요청·1 제공 → 1개, `cut_short` 아님).
- 유효 후보 0개는 `ready`가 아니라 `unavailable(detail=no_valid_candidates)`다.
- provider block이 없는 실패도 `why`/`detail`에 원인을 남긴다(예: `upstream_status`/`http_500`, `gate_unreachable`/예외명).

검증 명령과 실제 결과:

```text
backend: uv run pytest backend/tests                      → 442 통과, 96 건너뜀
backend: uv run pytest backend/tests/test_prompt_compose_api.py      → 44 통과
backend: uv run pytest backend/tests/test_prompt_compose_contract.py → 21 통과
backend: uv run ruff check backend/                        → All checks passed
frontend: node --test frontend/tests/*.test.mjs             → 205 통과 / 0 실패
frontend: npx tsc -p tsconfig.app.json --noEmit             → 오류 없음
git diff --check                                           → 오류 없음
```

96건 건너뜀의 원인 분류(전부 환경 의존, UCP03과 무관):

| 건수 | 사유 |
| --- | --- |
| 55 | SELinux/ACL xattr 보존이 필요한 switch journal 테스트(Linux 전용) |
| 29 | `SO_PEERCRED` 기반 UDS 인증(Linux 커널 전용) |
| 6 | GNU `chmod --reference`(BSD에 없음) |
| 5 | 격리 root namespace harness 필요 |
| 1 | 오프라인 uv cache 없음 |

관찰된 환경 수치와 남은 항목:

- 16K 컨텍스트에서의 실제 토큰 소비량: **미측정**. mock provider는 토큰을 실제로 세지 않으며, `max_tokens`는 8,192로 고정했다. 실측은 UCP09.
- 60초 timeout 적합성: **미검증**. 값은 `COMPOSE_TIMEOUT_SECONDS = 60.0`이며 timeout 경로·자원 해제는 mock으로 검증했지만, 실제 모델 지연 분포와 비교한 적합성 판단은 실연결에서만 가능하다. 현재 LLM 설정은 변경하지 않았다.
- 실제 llama-server 연결 검증: **미수행**. 이 환경에 서버가 없고, 하드코딩된 API 키·gate 주소로는 실호출이 불가능하다.
- GPU gate 실연결 검증: **미수행**. gate 제어 GET·paused 거부·도달 불가 경로는 `httpx.MockTransport`로만 검증했다.

남은 문제와 차단 사유: UCP03 자체의 로컬 완료 기준은 충족. 위 4건은 UCP09(실제 LLM·이미지 평가) 범위의 대기 항목이며 UCP03 미완료 사유가 아니다.

다음 실행 단위: UCP05 통합 입력과 반응형 결과 화면 → **완료(mock 검증)**. UCP06은 사용자 지시 없이 착수하지 않는다.


### UCP04 모델별 출력 프로필과 후보 검증

서버에서 버전 있는 출력 프로필을 선택하고 LLM payload에 전달한다. 후보 의미 유지, 중복 후보 제거, 길이 검사, negative prompt 처리, 알 수 없는 모델 처리와 경고를 구현한다. 토큰 추정은 추정임을 표시하고 77토큰 근사 경고를 모든 계열에 일괄 적용하지 않는다.

실행 체크리스트:

- [x] 계열별 버전 있는 출력 프로필과 필요한 모델 override를 구현한다.
- [x] 의미를 유지하는 후보 1~3개와 중복 제거, 길이/토큰 안내를 구현한다.
- [x] negative 지원/CFG 조건과 MOSS 엔진 처리 중복을 검사한다.
- [x] 의미 변경 평가 사례와 프로필별 fixture를 만들고 구조 검증과 의미 평가의 한계를 구분한다.

완료 기준: 지원 계열별 fixture가 올바른 프로필과 형식을 사용한다. 같은 장면에 대해 장소·의상·인물 수가 다른 후보는 정상 표현 대안으로 수락하지 않는 평가 사례가 있다. 프로필 테스트 통과를 실제 이미지 품질 향상의 증거로 기록하지 않는다.

#### UCP04 구현 결과

상태: 완료 (코드·단위 테스트·fixture). 의미 보존과 이미지 품질의 증거가 아니며, 실제 모델 판정은 UCP09다.

변경 파일과 구현된 동작:

| 파일 | 내용 |
| --- | --- |
| `backend/app/services/prompt_profiles.py` | `OutputProfile`(family, version, prompt_style, joiner, token_window, token_window_source, 문자 상한), `PROFILES`, `profile_for`, `profile_versions`, `TEST_ONLY_FAMILIES`, `estimate_tokens`, `prompt_guidance` |
| `backend/app/services/prompt_compose.py` | `WARNING_PROFILE_TOKEN_WINDOW`·`WARNING_PROFILE_WEIGHTING_SYNTAX`·`WARNING_DUPLICATE_CANDIDATES`, `WARNING_PRIORITY`+`WARNING_LIMIT`+`order_warnings`/`capped_warnings`, `has_weighting_syntax`, 프로필 `409 stale_profile` 검증, `_one_candidate`의 프로필 상한 사용 |
| `backend/app/api/routes.py` | `OUTPUT_PROFILE_VERSIONS = profile_versions()` (UCP03의 하드코딩 `1` 대체), capability 광고 |
| `backend/tests/test_prompt_profiles.py` | 33개: 프로필 자체(계열별 스타일/구분자/창·광고 제외·guidance 문구·추정식이 프런트와 동일) + 경고 정렬/상한, 중복, 문자 상한, weighting 탐지, 창 검사 |
| `backend/tests/test_prompt_compose_api.py` | UCP04 20개 추가(총 64개): capability·버전 일치, 409, guidance 전달, 중복, weighting, 창, 422, 경고 상한, joiner, MOSS negative/LoRA |
| `backend/tests/test_prompt_compose_meaning.py` | 고정 평가 사례 92개: 4장면 × 2형식, drift가 바꾼 사실을 `violates`/`drops`/`adds`로 선언 |
| `backend/tests/fixtures/ucp04_eval_cases.json` | `meta.evidence_kind`에 "not image-quality evidence"와 세 가지 한계를 명시한 평가 fixture |

이번 작업에서 확정한 사실:

- `prompt_profiles.py`가 계열별 프로필의 단일 소스다. `PROFILES`는 `sd15`·`flux2`·`z-image`·`moss-image`이고 `fake`는 `TEST_ONLY_FAMILIES`로 광고에서 제외한다. 버전은 전 계열 공통 `PROFILE_VERSION = 2`이며, UCP03의 `1`은 아무 내용도 서술하지 않는 상수였으므로 올렸다. `describe()`는 `token_window_source`처럼 모델에 줄 필요 없는 값을 빼고, 확인되지 않은 수치는 `None`으로 둔다.
- **광고 버전과 요구 버전이 같은 함수에서 나온다.** `routes.py`의 capability와 `resolve_target`의 비교가 모두 `profile_versions()`/`OutputProfile.version`을 쓰므로, 클라이언트가 버전 1을 보내면서 서버가 2를 요구하는 상태가 만들어질 수 없다(`test_the_advertised_versions_are_the_profiles_the_server_requires`). UCP03에서는 `OUTPUT_PROFILE_VERSIONS`가 하드코딩된 `1`이었고 검증도 임의의 정수를 통과시켰으므로 `stale_profile` 경로가 실제로는 도달 불가능했다.
- **버전 불일치는 409다.** `request.profile_version != target.profile.version`이면 `ComposeInputError(409, "stale_profile", "server has N, request had M")`를 던진다. 과거 버전과 미래 버전을 모두 거부하며(`test_a_future_profile_version_is_also_stale`), 요청 자체는 정상이므로 422가 아니다.
- **프로필이 없는 계열은 provider 호출 전에 422다.** `profile_for()`가 `None`이면 registry에 계열이 있어도 `422 model_family_mismatch`("no output profile for family: …")로 끝낸다. 잘못된 구분자를 조용히 적용하는 대신 대상 지정 오류로 보고한다(`test_a_family_without_a_profile_is_refused_before_the_call`).
- `joiner`는 `frontend/src/prompt/compiler.ts`의 규칙(`sd15` `", "` / 나머지 `"; "`)을 그대로 다시 적되 프런트를 import하지 않는다. 백엔드 모듈이 프런트 소스를 import할 수 없으므로 중복은 불가피하고, 대신 양쪽을 테스트로 고정했다(`test_the_profile_joiner_matches_the_compiler_convention`).
- `token_window`는 `sd15`만 77이다. 나머지 세 계열은 Qwen3급 LLM 텍스트 인코더라 창 크기가 체크포인트 속성이고 이 모듈이 읽을 수 없으므로 `None`이며, `None`은 "무제한"이 아니라 "이 빌드에서 확립되지 않음"이다. 모든 계열에 77을 일괄 적용하는 것은 §5가 금지한 조작된 한계이므로 하지 않는다. 결과적으로 `profile_token_window`는 `sd15`에서만 발생한다(`test_a_long_prompt_is_not_flagged_without_an_established_window` / `test_the_same_long_prompt_does_warn_for_sd15`).
- 토큰 수는 tokenizer가 저장소에 없으므로 `ceil(단어수 × 1.3)` 근사이며, 이는 `compiler.ts`의 `estimateTokens`와 같은 식이다. 식이 다르면 같은 문장이 구성기에서는 예산 초과, API에서는 정상이 될 수 있으므로 같게 유지한다. guidance도 "roughly N tokens"로 제시하고 측정값처럼 쓰지 않는다.
- 후보 검증은 위반 후보를 **통째로 폐기**하고 절대 자르거나 합치지 않는다. 중복은 `positive_prompt`의 `strip().casefold()` 동일성으로 판정하고, 폐기 시 `duplicate_candidates`를 남겨 `candidates_reduced`(내용이 거부됨)와 구분한다. 요청 수보다 많은 후보는 `candidate_count`까지만 반환한다.
- 경고는 advisory이지 거부가 아니다. weighting 문법(`(word:1.2)`, `<lora:...>`)과 토큰 창 초과는 후보를 버리지 않고 경고만 남긴다. advisory 검사는 살아남은 후보에만 적용되므로 클라이언트가 보지 못할 텍스트를 설명하지 않는다.
- 경고 상한은 4개이고 `order_warnings`가 `candidates_reduced`·`profile_token_window`를 먼저 배치한 뒤 `capped_warnings`가 자른다. advisory 코드를 추가해도 "목록이 짧다"는 유일한 신호가 조용히 밀려나지 않는다(`test_the_warning_cap_keeps_the_load_bearing_codes`). 세 호출 지점이 모두 `WARNING_LIMIT`을 거치므로 상한과 문서가 갈라지지 않는다.
- `_one_candidate`는 하드코딩된 2000/800 대신 `profile.max_positive_chars`/`max_negative_chars`를 쓴다. 초과 시 자르지 않고 후보를 폐기한다.
- negative: `negative_allowed()`가 registry의 `generation_options.negative_prompt`를 그대로 읽는다. `unsupported`면 필드를 제거하고 경고하며, `requires.cfg_scale` 미충족이면 §5에 따라 CFG를 바꾸지 않고 같은 방식으로 제거한다. 알 수 없는 requirement 키는 "충족됐다고 가정하지 않는다".
- MOSS 엔진 경로와 중복되지 않는다. `SdCppEngine.command`는 spec에 negative가 있을 때만 `-n`을 붙이고, `Registry.resolve`는 `unsupported` 모델의 negative를 spec 생성 전에 거부하므로 compose의 제거가 유일한 제거다(`test_moss_negative_prompt_is_dropped_once_not_twice`). 이 체크리스트 항목은 **조사만 수행했고 코드 변경이 필요 없었다**: `negative_allowed`와 MOSS spec 생성 경로를 읽고 세 테스트를 추가해 현재 동작을 고정했지만, 두 계층이 같은 negative를 두 번 처리하거나 CFG를 몰래 바꾸는 경로는 없었다. MOSS는 `generation_options.negative_prompt.mode: unsupported`이고 `supported_parameters`에도 `negative_prompt`가 없다.
- MOSS LoRA: `SdCppEngine.effective_prompt`가 trigger를 앞에, `<lora:name:strength>`를 뒤에 붙이고 자기 이름만 중복 제거한다. 후보가 **다른** LoRA 태그를 달고 오면 최종 프롬프트에 태그가 둘이 되지만, compose는 후보를 버리거나 텍스트를 고치지 않고 `profile_weighting_syntax`만 남긴다 — 사용자가 화면에서 직접 고칠 수 있어야 하기 때문이다(`test_a_model_supplied_lora_tag_survives_alongside_the_engines`).
- 평가 사례: `ucp04_eval_cases.json`은 4장면(`rain-street-dress`, `two-women-one-hat`, `empty-beach`, `night-cafe-coat`) × 2형식(`tags`/`sentence`)이다. 장면마다 faithful 1개와 drift를 두되, 장면이 실제로 검증하는 사실을 고른다 — `rain-street-dress`는 장소·의상·인원(3), `two-women-one-hat`은 두 인물의 귀속, `empty-beach`는 부정("사람 없음"), `night-cafe-coat`은 시간(과 의상)이다. 각 drift는 `violates`로 바꾼 사실을, `drops`/`adds`로 잃은 것과 얻은 것을 선언하고 테스트가 그 선언이 실제 텍스트와 맞는지 확인한다.
- **의미 평가의 한계를 테스트로 고정했다.** `test_the_server_cannot_tell_drift_from_a_paraphrase`는 faithful과 drift를 함께 보내 둘 다 `ready`로 통과하고 경고도 없음을 확인한다. 즉 fixture 통과는 계약·형식이 일관된다는 증거이며 의미 보존이나 이미지 품질의 증거가 아니다. 판정은 substring 검사이므로 선언된 용어를 쓰지 않는 paraphrase는 faithful로 인식되지 않고, 그 용어를 피한 drift는 잡히지 않는다.

검증 명령과 실제 결과:

```text
backend: uv run pytest backend/tests                                 → 587 통과, 96 건너뜀
backend: uv run pytest backend/tests/test_prompt_profiles.py          → 33 통과
backend: uv run pytest backend/tests/test_prompt_compose_meaning.py   → 92 통과
backend: uv run pytest backend/tests/test_prompt_compose_contract.py  → 21 통과
backend: uv run pytest backend/tests/test_prompt_compose_api.py       → 64 통과 (UCP03 44 + UCP04 20)
backend: uv run ruff check backend/                                   → All checks passed
frontend: node --test 'tests/*.test.mjs'                              → 205 통과 / 0 실패
frontend: npx tsc -b                                                 → 오류 없음
git diff --check                                                     → 오류 없음
```

변이 검사로 비공허성 확인(각 변이 후 원복, 실패한 테스트 수는 실측):

| 변이 | 결과 |
| --- | --- |
| `WARNING_DUPLICATE_CANDIDATES` 값을 `"dupes_mutated"`로 변경 | `test_identical_candidates_collapse_and_say_why` 1건 실패 |
| `has_weighting_syntax` → `False` | API 3건 실패(`weighting_syntax_is_reported`·`inline_lora_tag_is_reported`·`model_supplied_lora_tag_survives`), meaning 92건은 통과 → weighting 판정은 API 테스트가 담당 |
| 토큰 창 조건에 `and False` 추가 | `test_the_same_long_prompt_does_warn_for_sd15` 1건 실패, 창 없는 계열 테스트는 통과 |
| `test_prompt_compose_meaning.format_violations` → `[]` | 5건 실패(형식 교차 검사가 스스로를 검증함) |

브라우저 또는 실연결 검증 범위: 없음(UCP04 시점). 당시 `composeSession.ts`는 어떤 컴포넌트에서도 사용되지 않았다. UCP04는 서버 서비스와 fixture만 바꿨다. 이후 UCP05가 `ComposePanel`을 붙여 mock 응답으로 화면 배치를 검증했고, 실제 모델 응답의 의미·품질 판정은 여전히 UCP09다.

모바일 검증 환경과 결과: 해당 없음(UCP04 시점, UI 미구현). UCP05에서 mock 배치만 확인했고, 실 iOS Safari·Android Chrome은 UCP06·UCP08에서 기록한다.

남은 문제와 차단 사유: 없음. 다만 다음 두 가지는 의도적으로 미해결로 남긴다. (1) 토큰 수는 근사이며 정확한 tokenizer 도입은 UCP09 범위다. (2) 의미 보존은 서버가 판정할 수 없으므로 fixture는 형식·선언 일관성만 검증한다.

다음 실행 단위: UCP05 통합 입력과 반응형 결과 화면 → **완료(mock 검증)**. UCP06은 사용자 지시 없이 착수하지 않는다.


### UCP05 통합 입력과 반응형 결과 화면

PromptBuilder를 입력, 장면 요약·칩, 후보 목록, 상태 안내로 분리하고 3절의 흐름을 연결한다. 한글/사전 두 진입점, 사전 선택만 있는 요청, clarification 해결, 로딩·취소·재시도를 구현한다. 기본 경로의 여러 수락 버튼을 통합하고 이전 도구는 고급 영역 또는 호환 경로로 이동한다.

실행 체크리스트:

- [x] 한국어 입력과 사전 시작을 같은 장면 상태·실행 버튼에 연결한다.
- [x] 해석 요약·자동 칩·미등록 디테일·영어 후보를 함께 표시한다.
- [x] 기본 경로의 단계별 수락/번역 포함 버튼을 제거하고 구 기능은 고급/호환 경로로 분리한다.
- [x] 로딩·취소·재시도·충돌 해결·키보드 포커스·모바일 결과 확인을 연결한다.

- [x] `frontend/src/styles.css`와 필요한 App 컨테이너를 조정해 3절의 한 열/충분한 폭 배치, 44px hit area, 긴 내용 줄바꿈, 사전 검색 상태 유지, 후보별 적용을 구현한다.
- [x] 고정 바는 필수가 아니다. 사용할 경우 콘텐츠 여백·safe area·키보드 겹침을 처리한다. modal/sheet를 도입하면 3절의 닫기·포커스·스크롤 복원 조건까지 검증한다. → **고정 바와 modal/sheet를 도입하지 않았다.** 사전 검색 패널은 문서 흐름 안의 인라인 확장(`aria-expanded`/`aria-controls`)이며 포커스 트랩·Escape·스크롤 복원이 필요한 계층이 생기지 않는다. 따라서 이 항목이 요구하는 조건은 해당 없음이고 아래 "도입하지 않은 것" 절에 근거를 남겼다.

완료 기준: 충돌 없는 장면은 실행 1회로 사전 자동 선택과 영어 결과가 함께 나타나고 후보 적용 1회로 최종 입력까지 도달한다. 키보드로 입력→실행→후보→적용이 가능하다. 결과 생성 뒤 포커스를 강제로 빼앗지 않고 상태를 전달한다. 360px에서 사전/한글 두 경로 모두 결과 적용까지 가능하고 주요 조작의 hit area·넘침·읽기 순서 기준을 만족한다.

#### UCP05 구현 결과

상태: 완료 (코드·단위 테스트·mock API 브라우저 배치). 화면이 실제 LLM 출력으로 동작하는지에 대한 증거가 아니며, 실기기·실연결 검증은 UCP06·UCP08·UCP09다.

변경 파일과 구현된 동작:

| 파일 | 내용 |
| --- | --- |
| `frontend/src/prompt/composeCapability.ts` | 신규. `prompt_compose` 키만으로 지원 판정, 5상태(`supported`·`absent`·`unsupported_schema`·`stale_dictionary`·`unknown_family`), `COMPOSE_SCHEMA_VERSION = 1`, 타임아웃 상한, `max_candidates` clamp, `composeFallbackNotice` |
| `frontend/src/prompt/composeRequest.ts` | 신규. `wireSelection`, `buildComposeBody`(필드별 거부 사유), `parseComposeReply`(항목별 검증 + 상태 상호배타), `failureFromBody`/`FAILURE_BY_CODE` (서버 `message` 미노출) |
| `frontend/src/prompt/composeAlerts.ts` | 신규. advisory·reduced·failure 3분류, `REDUCING_CODES`, `DETAIL_COPY` 3개 한정, 알 수 없는 `detail` 비노출 |
| `frontend/src/prompt/composeApply.ts` | 신규. `planApply` 5거부(`no_candidate`·`expired`·`stale`·`blocked`·`negative_lost`), `needsOverwriteConfirm`, `appliedNegative`, `applyDiff` |
| `frontend/src/prompt/composeChips.ts` | 신규. `chipView`/`chipList` 텍스트 배지(`자동`/`직접`/`고정`/`제외`), 제외 칩 분리, `entityLabels`, 계열 미매핑 표시 |
| `frontend/src/components/ComposePanel.tsx` | 신규. 입력·장면·칩·후보·상태 4영역, IME Enter 가드 2개, 포커스 복원, `AbortController` 취소, 3중 stale 검사 |
| `frontend/src/prompt/composeSession.ts` | `withEdit`·`invalidateForTarget`(읽기측 파생)·`build_failed` 추가 |
| `frontend/src/prompt/composeCapability.ts` 등 | Node 타입 스트리핑을 위해 상대 import에 `.ts` 확장자 명시 |
| `frontend/src/App.tsx` | `ComposePanel`을 `PromptBuilder` 뒤에 마운트, `composeBlock` 상태, 계열별 capability 재계산, `applyComposedPrompt`(prompt+negative 단일 `setSettings`), `COMPOSE_EXAMPLES` |
| `frontend/src/api.ts` | `SystemCapabilities.prompt_compose` 타입과 `StudioApi.compose()` 추가 |
| `frontend/src/styles.css` | UCP05 블록 약 170줄: `container-type`/`container-name`, 44px 최소 높이, `font-size: 16px`(textarea·검색), `:focus-visible`, `overflow-wrap: anywhere`, `data-tone` 색+문구, 359/459/460/640px 컨테이너 쿼리 |
| `frontend/tests/prompt-ucp05.test.mjs` | 신규 46개 |

이번 작업에서 확정한 사실:

- **지원 판정은 `prompt_compose` 하나로만 한다.** capability 응답에 `prompt_proposals`가 있어도 compose 지원으로 추론하지 않는다. `composeCapability.ts`의 `readComposeCapability`는 `prompt_compose`가 없으면 `absent`를 돌려주고, 있으면 `schema_versions`에 `COMPOSE_SCHEMA_VERSION`(현재 `1`)이 있는지 검사한다. 이 분리는 테스트로 고정했다(`compose support is read from prompt_compose alone and never inferred`). `prompt_compose`는 UCP03에서 추가된 별도 키이고, 서버 `routes.py`가 `OUTPUT_PROFILE_VERSIONS`와 함께 광고하므로 두 계약이 갈라질 수 없다.
- **표시와 적용을 분리한다.** compose 응답은 후보를 *보여줄* 뿐 최종 프롬프트를 건드리지 않는다. 쓰기는 후보별 `이 프롬프트 사용` 버튼 한 곳뿐이고, 그 누름도 `planApply`가 먼저 결정을 돌려준다. `planApply`는 부작용이 아니라 결정(`ApplyPlan`)을 반환하므로 거부 사유가 화면에 표시되고 테스트가 단언할 수 있다.
- **거부 5종의 순서가 계약 순서다.** `no_candidate` → `expired`(모델/프로필 변경) → `blocked`(clarification 미해결) → `stale`(원문·칩 변경) → `negative_lost`. `expired`를 후보 조회보다 먼저 검사하는 이유는, 다른 모델용 응답은 어느 후보를 눌러도 적용할 수 없기 때문이다. 덮어쓰기 확인(`needsConfirm`)은 **맨 마지막**이다 — 사용자가 무시할 수 있는 유일한 거부이므로 더 강한 거부를 확인 대화상자 뒤에 숨기면 안 된다.
- **`needsOverwriteConfirm`은 `appliedPrompt`를 기준으로 한다.** "프롬프트가 비어 있지 않음"이 아니다. 이 패널이 마지막으로 쓴 문자열은 사용자 작업이 아니므로 다른 후보로 바꾸는 데 확인이 필요 없다. 반대로 사용자가 직접 입력·복원한 텍스트는 `appliedPrompt`와 다르므로 확인을 요구한다. 이 구분이 없으면 후보를 연속 적용할 때마다 불필요한 확인이 뜨고, 반대로 사용자 타이핑을 조용히 덮어쓴다.
- **적용 시 negative는 후보가 실제로 가진 경우에만 덮어쓴다.** 후보가 `negativePrompt: null`이면 사용자의 기존 negative를 그대로 둔다(§5). 후보가 `""`를 명시하면 그것도 값이므로 덮어쓴다. 이 구분은 `appliedNegative`에 있고 3개 케이스로 테스트했다.
- **stale 보호는 3중이며 모두 settle 시점에 재검사한다.** (1) `AbortController`로 요청 자체를 끊고, (2) 응답의 `requestId`가 현재 요청과 같은지 보고, (3) `input_revision`이 요청 시점과 같은지 본다. 2·3은 `settleComposition` 안에서 *정산 시점의* 상태로 검사하므로 클로저에 갇힌 옛 값과 비교하지 않는다. 순서도 의미가 있다: 늦게 도착한 옛 요청은 오류가 아니라 조용히 무시하고(새 요청이 진실), target이 바뀐 응답은 `expired`, revision만 바뀐 응답은 `cancelled`다.
- **`parseComposeReply`의 `revisions`는 호출자가 넘긴다.** 응답 본문에서 다시 계산하면 staleness 비교가 자기 자신과의 비교가 되어 항상 통과한다. 이 사실을 `a well-formed ready reply becomes a ComposeResult`가 `parsed.result.revisions === REVISIONS`로 고정한다.
- **`input_revision`은 `sha256:<64 hex>` 형식이다.** 백엔드 `prompt_compose.py`의 `fingerprint()`와 같은 모양이며, 테스트가 정규식으로 형식을 확인한다. `candidate_count`는 서버 `Field(default=3, ge=1, le=3)`이므로 클라이언트가 `max_candidates`를 3으로 clamp하고, `0`/`NaN`은 "지정 안 함"으로 취급해 기본값을 쓴다.
- **상태 상호배타를 양방향으로 거부한다.** `ready`에 질문이 있거나 `needs_clarification`에 후보가 있으면 응답 전체를 `invalid_reply`로 거부한다. 둘 다 있으면 누를 버튼이 정의되지 않고, 어느 한쪽을 골라 보여주면 서버가 검증하지 않은 화면이 된다. 빈 `ready`(후보 0개)와 옵션 없는 질문(답할 방법이 없음)도 같은 이유로 거부한다. 후보 하나가 깨져도 목록 전체를 거부한다 — 남은 후보만 보여주면 서버가 만들지 않은 후보 목록이 된다.
- **서버 `message`는 화면에 쓰지 않는다.** `failureFromBody`는 `why`를 아는 실패 종류로 매핑하고 `message`는 `""`로 둔다. 422 본문에는 pydantic 필드 경로가, provider 오류에는 내부 추적 문자열이 들어갈 수 있다. 같은 이유로 알 수 없는 `detail`은 문장으로만 알리고 값을 보간하지 않는다(`(selection.3.id: Field required)` 같은 문자열이 UI에 나오지 않음). 반면 요청 생성 거부(`build_failed`)는 우리가 만든 필드별 한국어 문구를 그대로 쓴다.
- **경고는 3분류다.** `reduced`(`candidates_reduced`·`duplicate_candidates`)는 "요청보다 적게 왔다", `advisory`는 "참고 사항", `failure`는 "진행 불가". 두 축소 코드를 advisory에 섞으면 후보가 줄어든 유일한 신호가 일반 안내에 묻힌다. 알 수 없는 경고 코드는 버리지 않고 코드와 함께 `알 수 없는 경고`로 표시한다 — 서버가 보고한 사실을 조용히 숨기지 않는다.
- **칩 상태는 색이 아니라 단어로 구분한다.** `자동`(AI가 골랐고 재분석 시 교체 가능) / `직접`(사용자가 골랐고 출처가 자동으로 바뀌지 않음) / `고정`(다음 AI 패스에서 살아남아야 함, 출처와 독립 축) / `제외`(거부, 되살아나면 안 됨). 제외 칩은 선택 목록이 아니라 별도 그룹에 `제외 해제` 버튼과 함께 표시한다. `제외`에는 `고정` 배지를 붙이지 않는다 — `setPinned`가 거부하는 상태를 화면이 주장하면 안 된다.
- **`invalidateForTarget`은 쓰기가 아니라 읽기측 파생이다.** 모델 선택기는 prop이므로 effect에서 상태를 쓰면 `invalidateProposal`이 피하는 패턴이 된다. `pending`은 stale `cancelled`가 되고, 정착한 초안은 `expired`로 바뀌되 **초안을 비우지 않는다** — 화면이 사용자 발밑에서 비면 안 되고, 적용 가능성은 `planApply`가 press 시점에 거부한다. 이것이 "모델 변경 시 적용 가능성 재검증" 요구를 transition이 아니라 apply 경계에서 강제하는 방식이다.
- **IME 가드는 2개이고 대상이 다르다.** 원문 textarea는 composing Enter만 취소해 줄바꿈 동작을 보존하고, 사전 검색 input은 Enter를 무조건 취소한다. 후자가 필요한 이유는 `ComposePanel`이 App의 `<form onSubmit={submit}>` 안에 렌더되기 때문이다 — 검색어는 입력할 때마다 필터링되므로 Enter에 기능이 없고, 그대로 두면 이미지 생성 폼이 암묵 제출된다. `keyCode === 229`를 함께 보는 이유는 Safari와 구형 Chromium이 한글 조합 확정 Enter에서 `isComposing`을 신뢰성 있게 세우지 않기 때문이다.
- **`<button>`은 전부 `type="button"`이다.** 위 폼 안에 있으므로 하나라도 `type`이 없으면 Enter/클릭이 제출로 해석될 수 있다. `ComposePanel.tsx` 전체를 grep해 확인했고 예외는 없다.
- **메모이제이션을 쓰지 않는다.** 이 빌드에는 React Compiler가 없고(`vite.config.ts`), 손으로 건 `useMemo`/`useCallback`은 이득 없이 deps-lint와만 싸웠다. UCP05에서 전부 제거했고, 컴포넌트는 평범한 계산으로 둔다. 프로파일링이 요구할 때만 되돌린다.
- **`edit`의 사본은 하나다.** `ComposeState.edit`이 사용자가 입력한 것의 유일한 출처다. 첫 UCP05 초안은 React 트리에 두 번째 사본을 두었고, 한쪽만 바꾸는 경로(계열 재바인딩이 target만 옮기고 글자는 안 옮기는 등)에서 매번 갈라졌다. 지금은 모든 핸들러가 `withEdit(invalidateForTarget(current, target), …)`를 거치고, prop 감시 effect로 되돌려 쓰지 않는다.
- **레이아웃은 `.compose`가 컨테이너이고 640px 이상에서 2열이 된다.** `container-type: inline-size` + `container-name: compose`를 걸고 359/459/460/640px에서 분기한다. 44px 최소 높이는 모든 독립 조작(버튼·입력·칩)에 적용하고, textarea와 검색 input은 `font-size: 16px`로 두어 iOS가 포커스 시 확대하지 않게 한다. 색은 `data-tone`과 항상 함께 오는 문구로만 의미를 전달하고, 긴 문자열은 `overflow-wrap: anywhere`로 넘침을 막는다.

검증 명령과 실제 결과:

```text
frontend: node --test tests/prompt-ucp05.test.mjs                     → 46 통과 / 0 실패
frontend: node --test 'tests/*.test.mjs'                              → 251 통과 / 0 실패
frontend: npx tsc --noEmit                                            → 오류 없음
frontend: npx eslint src tests --ext .ts,.tsx                         → 오류 없음
frontend: npm run build (tsc -b && vite build)                        → 성공 56 modules, 214ms
backend:  uv run pytest backend/tests                                 → 587 통과, 96 건너뜀
backend:  uv run ruff check backend/                                  → All checks passed
git diff --check                                                      → 오류 없음
```

변이 검사로 비공허성 확인(각 변이 후 원복, 실패한 테스트 수는 실측):

| 변이 | 결과 |
| --- | --- |
| `planApply`의 `sameTarget` 검사를 `false &&`로 무력화 | `a target that moved while the reply was on screen refuses the apply` 1건 실패 |
| `planApply`의 negative 조건 부정 제거(`!input.negativeSupported` → `input.negativeSupported`) | `a negative prompt this model cannot take is refused, not silently dropped` 1건 실패 |
| `needsOverwriteConfirm`이 항상 `false` 반환 | `a prompt the user owns asks before being overwritten` 1건 실패 |
| `failureAlert`가 알 수 없는 `detail`을 문장에 보간 | `a failure alert uses our copy and never interpolates an unknown detail` 1건 실패 |
| `chipView`의 `고정` 배지 추가 제거 | `every chip carries a state word, so colour is never the only signal` 1건 실패 |
| `invalidateForTarget`의 phase 조건 무력화 | `a model change on an idle or already-failed session changes nothing but the target` 1건 실패 |
| `parseComposeReply`의 `questions.length > 0` → `>= 0` | 4건 실패(`ready` 계열 3건 + 정상 파싱 1건) |

브라우저 또는 실연결 검증 범위:

- **검증한 것**: mock API로 데스크톱 브라우저 레이아웃(2열 ≥640px / 1열 <640px), 44px 조작 영역, 긴 문자열 줄바꿈, 사전 검색어·분류가 패널 접기/펼치기에서 유지되는지, 후보 적용 1회로 최종 prompt+negative가 한 번에 기록되는지.
- **검증하지 않은 것**: 실제 LLM 응답으로 만든 화면, 실 iOS Safari·Android Chrome 실기기에서의 한글 IME·키보드 가림·회전, 실제 GPU gate/llama-server 연동. 이 항목들은 아래 "남은 문제"에 남기고 완료로 기록하지 않는다.
- **mock이라는 사실의 의미**: mock은 계약 형태(`ready`/`needs_clarification`/`unavailable`, 필드명, `sha256:` revision)를 고정하는 데는 유효하지만, 실제 모델이 계약을 지켜 응답하는지·후보 의미가 보존되는지는 전혀 증명하지 않는다.

모바일 검증 환경과 결과: 실기기 검증 없음. 360px 폭 레이아웃은 데스크톱 브라우저의 반응형 모드로만 확인했고, 이는 실기기의 IME·키보드·safe area 동작의 증거가 아니다. 실 iOS Safari·Android Chrome 검증은 UCP06(한글 IME·키보드)과 UCP08(실기기 회귀)에서 수행한다.

남은 문제와 차단 사유:

1. **실연결 미검증(차단 아님, 범위 밖)**: compose 경로는 실제 llama-server·GPU gate에 붙여 검증하지 않았다. UCP09 범위다.
2. **실기기 미검증**: iOS Safari에서 `isComposing`이 한글 조합 확정 Enter에 대해 어떤 값을 주는지, Android Chrome에서 키보드가 하단 후보를 가리는지는 실기기 없이는 확정할 수 없다. `keyCode === 229` 폴백을 넣었지만 이것이 충분하다는 증거는 아직 없다.
3. **`duplicate_candidates`와 `candidates_reduced` 동시 발생 시 순서 미확인**: 두 코드가 함께 올 때 화면 표시 순서를 서버 `WARNING_PRIORITY`에 의존하고 있고, 클라이언트는 받은 순서를 유지한다. 함께 오는 실제 응답을 관찰하지 못했으므로 순서 계약은 미확인으로 남긴다.
4. **`token_window = 77`은 `sd15` 전용 advisory**: UCP04 결정대로 `profile_token_window`는 `sd15`에서만 발생하며 후보를 버리지 않는다. 다른 계열의 창 크기는 체크포인트 속성이라 이 빌드에서 확립되지 않았고, 따라서 "77 초과 = 문제"라는 표시는 `sd15` 밖에서 뜨지 않는다.
5. **의미 보존은 판정하지 않는다**: 후보가 장면의 사실을 바꾸지 않았는지는 UCP05가 검사하지 않는다. 서버도 substring 기반 평가 이상을 하지 못하며(UCP04 기록), 이는 UCP09의 실모델 평가 과제다.

도입하지 않은 것과 그 근거:

- **고정 바(sticky action bar)**: 요구가 필수가 아니고, 도입하면 safe area·키보드 겹침·콘텐츠 여백을 함께 처리해야 한다. 현재는 실행 버튼이 문서 흐름 안에 있고 모바일에서 스크롤로 도달한다.
- **modal / bottom sheet**: 3절은 기본 요구사항으로 두지 않는다. 사전 검색을 인라인 확장 패널로 구현해 포커스 트랩·Escape·배경 스크롤 복원·회전 중 높이 보존이라는 계층을 만들지 않았다. dialog가 필요해지면 3절의 조건을 전부 붙여야 한다.
- **React Compiler / 수동 메모이제이션**: 빌드에 compiler가 없으므로 수동 최적화는 이득 없이 lint와 충돌했다. 프로파일링 근거가 생길 때만 재도입한다.

UCP04 파일 집계 정정: UCP04 기록의 "변경 파일 7개"와 실제 커밋 내용이 달랐던 원인은, 그 시점 작업 트리에 UCP03·UCP04 파일이 **아직 커밋되지 않은 상태**로 함께 존재했기 때문이다. 현재 git 기준으로 UCP04가 만든 파일은 `backend/app/services/prompt_profiles.py`(신규), `backend/tests/test_prompt_profiles.py`(신규), `backend/tests/test_prompt_compose_meaning.py`(신규), `backend/tests/fixtures/ucp04_eval_cases.json`(신규), `backend/app/services/prompt_compose.py`(수정), `backend/app/api/routes.py`(수정), `backend/tests/test_prompt_compose_api.py`(수정)의 7개이며 모두 미커밋 상태다. UCP04 기록의 7개 목록은 맞았고, "5개만 변경"으로 보였던 것은 `git status`에서 신규 파일(`??`)과 수정 파일(`M`)을 구분해 세지 않은 집계 오류였다. HEAD(`ecb6af0`)에는 UCP04 파일이 하나도 들어 있지 않다.

다음 실행 단위: UCP06 양방향 수정과 모바일 입력·적용 보호. 단, 사용자 지시에 따라 자동 진행하지 않는다.


### UCP06 양방향 수정과 모바일 입력 및 적용 보호

직접 선택/고정/제외 편집, 한글과 칩 충돌 처리, 재분석, 후보 만료, 모델 변경, positive/negative 적용, 최종 입력 직접 수정 보호를 연결한다. 새로운 원문 해석으로 기존 수동 제약을 덮어쓰지 않는다.

실행 체크리스트:

- [x] 직접 선택·고정·제외·AI에 맡기기 규칙을 UI와 상태에 일치시킨다.
- [x] 충돌 해결 선택이 다음 요청에 반영되고 늦은 응답/만료 후보 적용이 차단되게 한다.


- [x] positive/negative 적용과 사용자 직접 수정의 덮어쓰기 보호를 연결한다.
- [x] 모델 변경·자동 칩 삭제·다인 귀속·되돌리기의 실제 왕복을 검증한다.

- [x] 한글 composition 중 Enter 오작동과 중복 제출을 막고 textarea 줄바꿈을 보존한다. 입력 focus/selection을 불필요하게 재설정하지 않는다.
- [ ] 키보드 열린 상태의 검색·충돌 해결·오류 수정, 회전·패널 접기/열기, 후보 도착 시 포커스·스크롤 보존을 연결한다. → **미완료.** 논리(포커스 이동·상태 보존)는 UCP05에서 있고 UCP06이 충돌 해소·되돌리기 블록을 추가했으나, 키보드가 열린 실기기에서 이 블록들이 가려지는지는 확인하지 않았다. 실기기 검증이 필요한 항목이라 UCP08로 넘긴다.

완료 기준: 자동 칩 삭제 후 재생성, 밤 선택과 한낮 입력 충돌, 두 인물의 서로 다른 속성, 생성 중 편집, 후보 적용 후 수동 수정, 계열/동일 계열 모델 변경, 되돌리기를 브라우저 또는 통합 테스트에서 확인한다. 만료 후보 적용이 차단된다. 한글 IME 입력 중 의도치 않은 실행이 없고 viewport 변화 후에도 편집/선택/후보 상태와 적용 보호가 유지된다.

#### UCP06 구현 결과

상태: 완료 (코드·단위 테스트·통합 경로). 브라우저·실기기 검증은 하지 않았으며 UCP08 범위다. 이 절의 완료 기준 중 "브라우저 또는 통합 테스트"는 통합 테스트 쪽으로 충족했다 — 모든 시나리오가 `parseComposeReply` → `settleComposition` → `planApply` 실제 경로를 지난다.

**먼저 찾은 결함 2건.** UCP05 테스트 251건이 전부 통과하는 상태에서 두 결함이 살아 있었다. 즉 UCP05 테스트는 `draft`와 손으로 만든 객체만 검사했고 `wire → parser → session → render` 경로는 한 번도 지나지 않았다.

1. **`parseComposeReply`가 `selections: []`를 하드코딩했다.** 서버는 `selections`를 정말로 돌려준다(`reconcile_selections`, `ComposeReply` 스키마, `backend/app/api/compose.py` 확인). 따라서 `mergeSelections`는 실경로에서 죽은 코드였고, 서버가 조정한 칩 목록은 매번 버려졌다.
2. **`settleComposition`이 병합 결과를 `draft.selections`에만 썼다.** 칩 목록은 `edit.selections`를 렌더하므로 AI가 고른 칩은 화면에 절대 나타나지 않았고, `composeRevisions`는 응답 이전 칩 집합을 계속 해시해 적용 가능성 판정이 "아무것도 안 보이는데 일관된" 상태가 됐다.

이 둘을 고치지 않으면 패널의 AI 절반 전체가 무동작이므로, UCP06의 나머지 작업은 이 경로 위에서만 의미가 있다.

변경 파일과 구현된 동작:

| 파일 | 내용 |
| --- | --- |
| `frontend/src/prompt/composeRequest.ts` | `parseSelection` 신규: `source`/`pinned`/`entity_id` 검증, 거부권(`excluded`)이 `pinned`·`entity_id`를 가지면 응답 전체를 `invalid_reply`로 거부. `selections`를 파싱해 결과에 포함(위 결함 1) |
| `frontend/src/prompt/composeSession.ts` | `settleComposition`이 병합 칩을 `edit`에 채택하고 `revisions`를 재계산(위 결함 2) |
| `frontend/src/prompt/structuredScene.ts` | `attributeTo`(장면 밖 entity ID 거부), `makeAuto`(manual→auto 유일 경로), `sceneEntityIds`, `resolveClash`(충돌 양방향 해소) |
| `frontend/src/prompt/composeApply.ts` | `ApplyPlan.lossKo`, `NEGATIVE_LOSS_NOTE`, `planApply`의 `acceptNegativeLoss`(1차 거부·2차 긍정 전용 적용), 확인 문구가 덮어쓰기 대상 명시 |
| `frontend/src/prompt/composeAlerts.ts` | `warningAlerts`가 **분류 우선** 정렬(`CATEGORY_RANK`: failure 0 · reduced 1 · advisory 2) + 안정 인덱스 tiebreak |
| `frontend/src/components/ComposePanel.tsx` | `negative`·`onRestore` prop, `undoRef` 1단계 스냅샷, `armed` 2단계 상태, `apply`/`undo`/`resolve`/`toAuto`/`attribute`, 칩별 귀속 `<select>`, 충돌 해소 블록, 결과 아래 되돌리기 행 |
| `frontend/src/App.tsx` | `negative={settings.negativePrompt}` 전달, `restoreComposedPrompt`(positive/negative/`composedApplied` 복원, `promptDirty`는 건드리지 않음), `onRestore` 연결 |
| `frontend/src/styles.css` | `.compose-clashes*`, `.compose-chip__attribute*`, `.compose-undo*` (44px 목표, select 16px) |
| `frontend/tests/prompt-ucp06.test.mjs` | 신규 15건 |

이번 작업에서 확정한 사실(상태 전이 규칙):

- **병합 칩은 `edit`에 쓴다.** `draft.selections`는 응답의 사본이고 `edit.selections`가 사용자 결정의 유일한 출처다. 응답을 채택한 뒤 `composeRevisions`를 다시 계산하지 않으면 다음 `draftIsStale` 호출이 방금 온 응답을 stale로 판정한다. 두 쓰기는 한 동작이다.
- **거부권은 깃발을 갖지 않는다.** `excluded` 행이 `pinned` 또는 `entity_id`를 동반하면 그 행만 버리는 것이 아니라 응답 전체를 `invalid_reply`로 거부한다. 절반만 채택하면 서버가 주장하지 않은 칩 목록을 화면이 보여주게 된다.
- **`manual`은 사용자만 해제한다.** 응답은 manual 칩을 `auto`로 강등할 수 없고(`mergeSelections`), `makeAuto`가 유일한 해제 경로다. 해제는 pin도 함께 버린다 — "AI가 골라도 되지만 반드시 유지"는 `setPinned`가 사용자 소유 칩에 쓰는 의미이고, 소유를 넘긴 칩에 남길 의미가 아니다. `excluded` 행에는 무동작이다.
- **귀속은 장면 안에서만 쓸 수 있다.** `attributeTo`는 `allowed`(=`sceneEntityIds`)를 받아 장면에 없는 entity ID를 **거부**한다. 서버가 `entity_id`를 자기 장면으로 검증하고 `422`를 내므로, 오래된 ID나 만들어낸 ID를 통과시키면 사용자가 고칠 수 없는 요청이 된다. `null` 귀속("장면 전체")은 허용한다.
- **충돌 해소는 양쪽 다 명시적 선택이다.** `drop_exclusion`은 거부권만 지우고 문장은 그대로 둔다. `drop_mention`은 **긍정된** 언급만 오른쪽에서 왼쪽으로 잘라내고, `choices`를 비운다(문장이 바뀌었으므로 `withBrief`와 같은 규칙). `네온 없이` 같은 부정 언급은 거부권의 재진술이라 자르지 않는다 — 자르면 같은 결정의 절반을 조용히 삭제하게 된다. 자를 것이 없으면 같은 객체를 그대로 돌려준다.
- **negative 손실은 2단계이고 기록된다.** 모델이 negative를 못 받는데 후보가 negative를 가지면 1차 누름은 `negative_lost`로 거부하고 무엇이 사라지는지 설명한다. 2차 누름은 `acceptNegativeLoss`로 긍정 프롬프트만 적용하고, `lossKo`에 손실 사실을 남긴다. 영구 거부는 안내 문구의 "계속하려면 다시 누르세요"를 거짓말로 만든다. 손실 수락이 덮어쓰기 확인을 우회하지는 **않는다** — 더 강한 거부를 더 약한 것 뒤에 숨기지 않는다.
- **되돌리기는 적용 1회, 프롬프트 두 필드만.** `undoRef`가 `onApply` 쓰기 **전에** positive/negative/`appliedPrompt`/`applied`를 스냅샷한다. `applied` 레코드까지 되돌리는 이유는 A 적용 → B 적용 → 되돌리기에서 A 카드가 화면에 돌아온 텍스트에 대해 "적용됨"을 주장해야 하기 때문이다. 후보·revision은 건드리지 않으므로 되돌리기로 만료된 응답이 되살아나지 않는다.
- **되돌리기 경고는 최종 prompt만 본다.** brief 편집은 undo가 복원하지 않는 대상이므로 경고하면 일어나지 않는 손실을 설명하게 되고, 무관한 변화에 뜨는 경고는 읽히지 않는다.
- **경고 순서는 분류가 결정한다.** 클라이언트는 `CATEGORY_RANK`(failure 0 · reduced 1 · advisory 2)로 다시 정렬하고, **같은 분류 안에서는 서버 배열 순서를 안정 정렬로 보존**한다. 클라이언트가 정하는 것은 분류 간 순서뿐이며, `reduced`가 `advisory`보다 위다.
  - **서버와 같아지는 경우**: `candidates_reduced` + `profile_token_window`(서버 `WARNING_PRIORITY` 순서 그대로), `candidates_reduced` + `duplicate_candidates`(둘 다 reduced라 서버 순서 유지).
  - **서버와 달라지는 경우**: `duplicate_candidates` + `profile_token_window`이 함께 올 때 서버 `order_warnings`는 `profile_token_window`를 먼저 두지만(`WARNING_PRIORITY`에 있고 중복 코드는 없음), 클라이언트는 `duplicate_candidates`를 먼저 둔다. 둘 다 "요청보다 적게 왔다"는 사실이고 advisory가 그 위에 오면 안 된다는 것이 UCP05가 세운 규칙이므로, 여기서는 클라이언트 규칙을 택했다. 세 코드가 함께 오는 실제 응답은 관찰하지 못했으므로 이 차이는 **의도된 결정이며 미검증**으로 남긴다(`reduced candidates outrank an advisory even when the server lists it first`).
- **장면이 바뀌면 답도 버린다.** `clarification_choices`는 `question_id`를 담는데, 문장이 바뀌면 서버는 자기가 발급하지 않은 ID를 거부한다. `withAnswer`는 `choice`만 옮기므로 같은 질문에 계속 답할 수 있고, `withBrief`가 `choices`를 비운다.

검증 명령과 실제 결과:

```text
frontend: node --test tests/prompt-ucp06.test.mjs                     → 15 통과 / 0 실패
frontend: node --test 'tests/*.test.mjs'                              → 266 통과 / 0 실패
frontend: npx tsc --noEmit                                            → 오류 없음
frontend: npx eslint src tests                                        → 오류 없음
frontend: npm run build (tsc -b && vite build)                        → 성공 56 modules, 237ms
backend:  uv run pytest backend/tests                                 → 587 통과, 96 건너뜀
backend:  uv run ruff check backend/                                  → All checks passed
git diff --check                                                      → 오류 없음
```

`tests/prompt-ucp06.test.mjs`의 15건은 시나리오 1~10(4b 포함)과 파서·경고·충돌 해소 계약이다:

| 검사 | 고정하는 것 |
| --- | --- |
| reply selections are parsed, not dropped | 응답의 `selections`가 `edit`까지 도달하고 `draftIsStale`가 즉시 false |
| a malformed selection rejects the whole reply | 잘못된 5가지 모양이 전부 `invalid_reply` |
| scenarios 1–7 | 원문 편집·칩 추가/삭제·거부권·고정·수동 프롬프트·모델 변경/되돌리기·늦은 응답 |
| scenario 8 | 장면 변경 시 오래된 `clarification_choices`를 보내지 않음 |
| scenario 9 | 두 인물의 속성이 섞이지 않고, 장면 밖 귀속이 거부됨 |
| scenario 10 | negative 미지원 모델의 2단계 적용과 기록된 손실 |
| exclusion clash | 양방향 해소와 부정 언급 미절단 |
| warning order | 분류 우선 정렬, 분류 내 서버 순서 보존, 서버와 다른 지점(3코드) 명시 |

변이 검사로 비공허성 확인(각 변이 후 원복, sha256으로 바이트 동일성 확인):

| 변이 | 실패한 테스트 |
| --- | --- |
| `parseComposeReply`가 다시 `selections: []`를 반환 | 2건 (`reply selections…`, `3. vetoing a chip…`) |
| `settleComposition`이 `draft`에만 병합 결과를 씀 | 2건 (같은 2건) |
| `mergeSelections`가 manual 칩을 응답으로 교체 | 1건 (`9. each person…`) |
| `planApply`의 부정 손실 게이트 무력화 | 1건 (`10. a negative prompt…`) |
| `warningAlerts` 정렬을 `() => 0`으로 고정 | 1건 (`reduced candidates outrank an advisory…`) |
| `attributeTo`의 entity 검증 무력화 | 1건 (`9. each person…`) |
| 거부권의 `pinned` 검사 무력화 | 1건 (`a malformed selection…`) |
| `makeAuto`가 manual 칩을 거부 | 1건 (`4b. a reply can never demote…`) |
| 부정 손실 수락이 덮어쓰기 확인을 생략 | 2건 (`10. a negative prompt…`, `5. a hand-written prompt…`) |
| `resolveClash`가 부정 언급도 절단 | 1건 (`an exclusion the brief contradicts…`) |

10개 변이 모두 잡혔고, 10개 모두 원복 후 파일이 바이트 단위로 동일했다.

브라우저 또는 실연결 검증 범위:

- **검증한 것**: 없음(UCP06 시점). UCP06은 순수 모듈·세션·적용 경계를 통합 테스트로 고정했다.
- **검증하지 않은 것**: 실제 브라우저에서의 귀속 `<select>`·충돌 해소 버튼·되돌리기 행의 배치와 터치, 실 iOS Safari·Android Chrome의 한글 IME·키보드, 실제 LLM 응답으로 만든 칩 목록. UCP06은 이 항목들을 완료로 기록하지 않는다.
- **통합 테스트가 대체하지 못하는 것**: 테스트는 `wire → parser → session → planApply`까지 가지만 React 렌더와 실제 입력 이벤트는 지나지 않는다. 예를 들어 `armed` 상태에서 버튼 라벨이 바뀌는지, `<select>` 변경이 `attribute`에 도달하는지는 컴포넌트 테스트가 없으므로 미검증이다.

모바일 검증 환경과 결과: 실기기 검증 없음. UCP06은 이 절의 "한글 IME·키보드·회전" 항목을 **충족하지 않았다** — IME 가드와 포커스 처리는 UCP05의 코드를 그대로 두었고 이번에 실기기로 확인하지 않았다. 실 iOS Safari·Android Chrome 검증은 UCP08로 이월한다.

남은 문제와 차단 사유:

1. **컴포넌트 테스트 부재(차단 아님, 범위 밖)**: 이 저장소에는 DOM 테스트 러너가 없다(`node --test` + 순수 모듈만). `ComposePanel`의 새 조작 4종(귀속 select, AI에게 맡기기, 충돌 해소, 되돌리기)은 브라우저 하네스(`scripts/prompt-composer-browser/`)로 확인해야 하며 UCP08 범위다.
2. **실기기 미검증**: UCP06의 제목이 "모바일 입력·적용 보호"지만 실제 모바일 검증은 하지 않았다. 적용 보호는 `planApply` 경계에서 강제되고 테스트로 고정했으나, 키보드가 열린 상태에서 새 블록(충돌 해소·되돌리기 행)이 가려지는지는 알 수 없다.
3. **`duplicate_candidates` 동시 발생 순서**: UCP05가 남긴 항목 3은 부분적으로만 해소됐다. 두 코드가 **모두 `reduced` 분류**이므로 어느 쪽이 먼저 와도 같은 분류로 렌더되고 분류 간 순서는 고정됐다. 그러나 (a) 두 코드 사이의 상대 순서는 여전히 서버 배열 순서이고, (b) `duplicate_candidates` + `profile_token_window`이 함께 올 때 클라이언트 순서는 서버 `order_warnings`와 **의도적으로 다르다**(위 "경고 순서는 분류가 결정한다"). 세 코드가 함께 오는 실제 응답을 관찰하지 못했으므로 두 사실 모두 미검증이며, 렌더 순서만 테스트로 고정했다.
4. **의미 보존은 판정하지 않는다**: UCP05 항목 5와 동일. 다인 귀속 테스트는 클라이언트가 속성을 섞지 않는다는 것만 고정하며, 실제 모델이 두 인물의 속성을 올바로 읽는지는 UCP09다.

도입하지 않은 것과 그 근거:

- **칩 상태의 낙관적 갱신 없음**: 응답이 칩을 바꾸면 `settleComposition`에서만 반영한다. 누름 즉시 화면을 바꾸고 응답으로 되돌리면 사용자가 방금 본 결정이 사라진 것처럼 보인다.
- **`resolveClash`의 자동 적용 없음**: 두 해소책 모두 사용자가 말한 것의 일부를 버리므로 명시적 선택 없이는 아무것도 하지 않는다. 컴포넌트도 `CLASH_RESOLUTIONS`의 버튼에서만 호출한다.
- **여러 단계 undo 스택 없음**: 되돌리기는 마지막 적용 1회다. 이력 전체를 다루는 것은 UCP07(구성 v3 저장·복원)의 일이며, 여기서 부분 구현하면 두 체계가 서로 다른 "과거"를 갖게 된다.

UCP05 테스트 집계 정정: UCP05 기록의 "46개"는 맞고, 이전 보고에서 36개로 합산한 표는 틀렸다. UCP05 파일의 7개 그룹은 `capability` 7 + `request building` 5 + `reply parsing` 9 + `alerts` 4 + `apply` 9 + `chips` 5 + `session lifecycle` 7 = 46이다. 36은 그룹별 집계에서 `reply parsing`(9)·`alerts`(4)·`chips`(5)와 중복 계산을 놓친 값이었고, "빠진 10개"라는 표현도 실제로는 UCP05 이전부터 있던 그룹을 세지 않은 결과였다. UCP05 전체 251건은 `prompt-compiler`·`prompt-data`·`prompt-proposals` 등 기존 파일들의 합이다.

기준선과 파일 상태(UCP06 시점, HEAD = `ecb6af0`):

- 이 저장소에는 UCP01~UCP06 파일이 **커밋되지 않은 상태**로 함께 존재한다. 따라서 "UCP06이 바꾼 것"은 커밋이 아니라 파일 목록으로 판정한다.
- `git status --porcelain --untracked-files=all` = 23개 항목: 수정 11개 + 미추적 12개.
- 수정 11개: `backend/app/api/routes.py`, `backend/app/services/prompt_compose.py`, `backend/tests/test_prompt_compose_api.py`, `docs/PROMPT_COMPOSER_UNIFIED_IMPLEMENTATION.md`, `docs/TESTING.md`, `frontend/README.md`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/prompt/composeSession.ts`, `frontend/src/prompt/structuredScene.ts`, `frontend/src/styles.css`.
- 미추적 12개: `backend/app/services/prompt_profiles.py`, `backend/tests/fixtures/ucp04_eval_cases.json`, `backend/tests/test_prompt_compose_meaning.py`, `backend/tests/test_prompt_profiles.py`, `frontend/src/components/ComposePanel.tsx`, `frontend/src/prompt/composeAlerts.ts`, `frontend/src/prompt/composeApply.ts`, `frontend/src/prompt/composeCapability.ts`, `frontend/src/prompt/composeChips.ts`, `frontend/src/prompt/composeRequest.ts`, `frontend/tests/prompt-ucp05.test.mjs`, `frontend/tests/prompt-ucp06.test.mjs`.
- 이 중 UCP06이 만든 파일은 `frontend/tests/prompt-ucp06.test.mjs`(신규) 하나이고, 나머지는 UCP02~UCP05가 만든 파일을 UCP06이 수정한 것이다. 다만 `composeRequest.ts`·`composeAlerts.ts`·`composeApply.ts`·`ComposePanel.tsx`는 UCP05가 만들고 UCP06이 실질적으로 확장했으므로 "미추적 = UCP05 것"으로 단정하지 않는다. `docs/TESTING.md`와 `frontend/README.md` 수정은 UCP06이 아니라 이번 문서 정리에서 Node 버전·테스트 명령을 남긴 것이다.

재현 가능한 기준선: 이 작업 트리는 **커밋으로 분리할 수 없다**(UCP01~UCP06이 한 덩어리로 미커밋). 대신 검증 결과를 재현하는 절차는 다음과 같다.

```sh
git rev-parse HEAD                       # ecb6af0 — 기준 커밋
git status --porcelain --untracked-files=all   # 23개 항목(수정 11 + 미추적 12)
cd frontend && node --test tests/*.test.mjs   # 266 통과
```

즉 "UCP06 완료"의 증거는 커밋 해시가 아니라 **HEAD `ecb6af0` + 위 23개 항목 + 266 통과**의 조합이다. 다른 작업자가 같은 트리에 변경을 추가하면 23이라는 수와 266이라는 수가 함께 달라지므로, 둘 중 하나만 인용해 완료를 주장하지 않는다. UCP06만의 변경을 분리해야 한다면 `frontend/tests/prompt-ucp06.test.mjs`가 유일하게 UCP06이 만든 파일이고, 나머지는 기존 파일 위의 수정이므로 `git diff`로는 "누가 먼저 썼는지" 구분되지 않는다.

다음 실행 단위: UCP08의 잔여 항목(모바일 실기기 검증) 또는 UCP09 실제 LLM과 이미지 결과 평가. **사용자 지시 없이 착수하지 않는다.** UCP08은 브라우저 자동화를 완료했고(459 checks), 실기기가 없어 iOS Safari·Android Chrome 검증만 대기로 남겼다. UCP09는 착수 지시를 받았으나 실행 호스트에 llama-server·GGUF·GPU가 없어 **환경 대기**로 기록했다(「UCP09 환경 확인」). 실환경 접근이 생기면 그 절의 표를 먼저 다시 확인한 뒤 착수한다.

### UCP07 구성 v3 저장과 과거 복원

schemas와 생성 제출, metadata, retry, sidecar, 갤러리 재사용을 연결한다. 마지막 적용 상태만 생성 이력으로 기록하며 편집 중 장면과 혼합하지 않는다. 구 서버 fallback과 과거 v1/v2 복원을 검증한다.

실행 체크리스트:

- [x] v3 검증·capability와 마지막 적용 snapshot의 job 제출을 구현한다.
- [x] DB·events·metadata·sidecar·retry·갤러리 복원에 v3가 보존되게 한다.
- [x] v1/v2 복원과 v3 미지원 서버 fallback을 구현하고 출처를 추정하지 않는다.
- [x] 실제 임시 DB 재시작 후 복원·재시도와 직접 편집 표시를 검증한다.

완료 기준: 실제 임시 DB를 사용하는 저장→프로세스 재생성→조회→재시도에서 v3 스냅샷이 보존된다. 과거 v2 번역 출처가 사라지지 않는다. 복원 자체가 LLM 요청을 발생시키지 않는다. unsupported v3 서버에는 v3 body를 보내지 않는다.

결과(구현·검증 완료):

v3 제출이 막혀 있던 원인은 **네 가지 결함**이고, 앞의 둘 다 고치기 전에는 "저장"이 실제로 일어나지 않았다. 뒤의 둘은 저장이 일어나기 시작한 뒤에야 드러난 것이고, 이번에 처음 확인했다.

| # | 결함 | 증상 | 수정 위치 |
| --- | --- | --- | --- |
| 1 | v3 본문이 v1/v2 검증기를 통과해야 했다 | 브라우저에서 모든 v3 제출이 클라이언트 단계에서 실패 | `frontend/src/prompt/validation.ts`의 `validateCompositionBody` 디스패처 |
| 2 | 검증이 32 KiB를 먼저 재서 초과 v3를 422로 거절 | 사다리(`fit()`)가 **도달 불가능한 죽은 코드**였고 `snapshot_trim`은 항상 `[]` | `schemas.py`의 `check_snapshot(enforce_bytes=False)` |
| 3 | `fit()`이 `snapshot_trim`을 무조건 덮어씀 | 복원한 기록을 다시 저장하면 "무엇이 잘렸는지"가 사라져, 필드 부재를 빈 값으로 읽게 됨 | `fit()`이 기존 단계를 유지하고 새 단계만 `LADDER` 순서로 합집합 |
| 4 | `scene.environment`의 `None` 기본값이 6개 `null` 키로 직렬화 | 계약 예시(`{}`)와 불일치, 모든 v3 행에 137 B 패딩, "미언급"과 "명시적으로 비움"이 구분 불가 | `CompositionSceneEnvironment.omit_unstated` |

세 번째와 네 번째는 이번에 새로 찾은 것이다. 특히 두 번째는 **테스트가 통과하는데도 기능이 죽어 있는** 형태였다. `fit()`은 정상 동작하고 `snapshot_trim == []`도 정상값처럼 보이므로, 사다리를 실제로 지나가는 입력(32~64 KiB 창)을 만들지 않으면 발견되지 않는다.

두 상한이 겹치는 지점:

- 스냅샷 예산 32 KiB와 HTTP body 상한 64 KiB(소스 기본값)다.
- 따라서 사다리는 **32~64 KiB 구간에서만** 도달 가능하다. `worst_case()`(약 100 KB)는 문전에서 413이므로 사다리를 검증하지 못한다.
- 실제로 사다리를 지나가는 fixture는 `end_to_end_body()`뿐이고, 이것이 종단 테스트의 입력이다.

사다리가 절대 지우지 않는 것(테스트로 고정):

- `applied.positive_prompt`·`negative_prompt`·`summary_ko`: 실행된 사실. 기록이 이미지와 달라지면 기록은 거짓이다.
- `selections` 전체(모든 `excluded` 행 포함): 거부권은 결정의 유일한 기록이다. 지우면 사용자가 금지한 칩이 조용히 되살아난다.
- `target_model_id`·`target_family`·`profile_version`·`dictionary_version`: 없으면 복원 기록의 신선도를 판정할 수 없다.

`arrays_2`와 `drop_dangling`의 관계: 개체를 2개만 남기면 귀속이 매달릴 수 있다. `drop_dangling`이 그 참조를 지우므로 **칩은 남고, 보증할 수 없는 소유자만 사라진다**. `selections` 행은 지워지지 않고 `entity_id`만 `None`("장면 전체")이 된다.

검증 명령과 실제 결과:

```text
frontend: node --test tests/prompt-ucp07.test.mjs                    → 44 통과 / 0 실패
frontend: node --test 'tests/*.test.mjs'                             → 310 통과 / 0 실패
frontend: npx tsc -b                                                 → 오류 없음
frontend: npx eslint src tests                                       → 오류 없음
backend:  uv run --project backend pytest backend/tests              → 596 통과, 96 건너뜀
backend:  uv run --project backend ruff check backend/               → All checks passed
git diff --check                                                     → 오류 없음
```

backend는 **저장소 루트에서** 실행해야 한다. `backend/`에서 실행하면 `config/models.yaml` 상대 경로 때문에 실패한다.

`frontend/tests/prompt-ucp07.test.mjs`의 44건은 네 묶음이다:

| 묶음 | 고정하는 것 |
| --- | --- |
| 시나리오 1~5 | 적용 없는 스냅샷은 `null`, 적용 스냅샷은 prompt 원문 그대로, negative `null`은 키 생략, 적용 후 영어 편집이 기록을 덮지 않음, 제외·고정·수동 출처와 인물별 속성 복원 |
| 시나리오 6~10 | 다른 모델 가족 기록은 복원하되 어느 모델이었는지 말함, v1은 v1로 복원(적용·장면 없음), 서버가 자른 기록은 "불완전"으로 복원, 매달린 참조는 고치지 않고 거부, 갤러리 복원은 최종 prompt와 기록을 분리 |
| v3 검증기 12건 | 제출 버튼을 결정하는 검증기가 v3를 받아들임, v1/v2는 기존 검증기 유지, **초과 v3는 거절하지 않음**(서버가 자름), 64 KiB 요청 상한은 유지, 가족 불일치·거부권만 있는 본문·`excluded`의 pin/owner·pin 누락·장면 밖 개체 참조·`applied: null`·사다리에 없는 trim 이름 거부 |
| 왕복 | 이 클라이언트가 쓴 v3 기록은 자기 검증기를 항상 통과 |

`backend/tests/test_prompt_composition_v3.py`의 9건:

| 검사 | 고정하는 것 |
| --- | --- |
| 초과 v3는 검증을 통과하고 `fit()`에서 잘림 | 사다리가 **도달 가능**함. 세 사실을 함께 고정: 검증이 초과 본문을 받아들임, `fit()`이 단계를 보고함, 결과가 예산 이하 |
| 사다리는 실행된 사실을 건드리지 않음 | `applied` 3필드 원문 유지, `selections` 100행·거부권 20행 전부 유지, 생존 개체는 `entity-1`·`entity-2`, 매달린 귀속 없음 |
| 잘린 기록의 재저장이 trim 이력을 지우지 않음 | `fit(fit(x))`의 단계 == 첫 단계(3번 결함의 회귀) |
| 저장이 기록을 키우지 않음 | `fit(fit(x))`가 바이트 동일(4번 결함의 회귀) |
| 미언급 환경은 6개 `null`이 아니라 `{}` | 부분 언급은 언급된 키만, `""`는 "미언급"으로 처리 |
| 사다리로도 안 되면 거절 | `32 KiB`와 바이트 수를 담은 오류, 반쯤 잘린 행을 저장하지 않음 |
| 초과 v3 종단 수용·재조회 | `POST /jobs` 202 → 저장 행이 잘려 있음 → 그 행 재제출도 202이고 trim 이력 유지 |
| 임시 DB 재시작·재시도 보존 | 같은 data dir로 앱 재생성 후 조회·retry·events·metadata·sidecar 모두 같은 잘린 기록 |
| 저장 불가 기록은 422 | 행이 생기기 전에 거절, 큐는 계속 읽힘 |

비공허성 검증(각 수정을 되돌려 실패를 확인한 뒤 원복):

| 되돌린 것 | 실패한 테스트 |
| --- | --- |
| `validateCompositionBody` 디스패처를 `validateComposition`으로 | frontend 2건 |
| `check_snapshot(enforce_bytes=True)` | backend 5건 |
| `fit()`의 `snapshot_trim` 합집합 | backend 2건 |
| `omit_unstated`를 `handler(self)`로 | backend 1건 |

`LABELED_STEPS`는 `["evidence_ko", "ambiguity_options", "attributes_first", "brief_2000", "environment", "arrays_2"]`로 고정했다. 사다리나 의미 상한이 움직이면 이 상수와 문서의 실측 표가 함께 틀리므로, `backend/measure_ladder.py`로 다시 재야 한다.

백엔드 테스트 수 정정: 이전 기록은 587 → 596을 `+3`으로 적었으나 실제 증가분은 **9**다(`backend/tests/test_prompt_composition_v3.py` 한 파일). 587은 UCP06 시점의 수이고, UCP07이 만든 테스트는 이 9건뿐이므로 596 − 587 = 9와 파일 수가 일치한다. `+3`은 `fit()` 재저장·`omit_unstated`·사다리 도달성처럼 "수정별 회귀 3종"만 세고 종단·재시작·거절 케이스를 빠뜨린 집계였다.

검증하지 않은 것:

- **브라우저 조작**: UCP07은 순수 모듈과 API를 테스트했다. 실제 브라우저에서 ComposePanel의 적용→저장→갤러리 복원을 클릭으로 확인하지 않았다(UCP08). → UCP08에서 확인 완료.
- **`events`의 필드 단위 검증**: 스트림 텍스트에 `schema_version:3`이 있는지만 확인했다. 이벤트 페이로드 전체가 저장 행과 같은지는 비교하지 않았다.
- **동시 수정**: 복원한 기록을 편집하는 도중 다른 탭이 같은 job을 retry하는 경우는 다루지 않는다.


### UCP08 회귀와 반응형 및 모바일 실기기 검증

기존 직접 입력·생성·모델 선택·갤러리 회귀, 새 흐름 상태 전이, 360/390px 모바일과 데스크톱 화면을 확인한다. 가능하면 기존 브라우저 하네스를 확장한다. 단순 문자열 포함 검사만으로 사용성 완료를 선언하지 않는다.

실행 체크리스트:

- [x] 8절의 필수 사례를 자동화하고 기존 직접 생성·갤러리·모델 옵션 회귀를 검사한다.
- [x] 360/390px·데스크톱, 긴 후보, 키보드·오류 복구를 실제 브라우저에서 확인한다. (CDP viewport emulation)
- [x] 현재 테스트 명령을 실행하고 실패 원인을 수정한다. 환경 제약은 차단 사유로 남긴다.
- [x] API/UI/저장 연결과 실연결 미검증 범위를 구분해 상태표를 갱신한다.

- [x] 3절 전체 매트릭스의 자동화 가능한 항목을 기존 CDP 하네스에 추가한다. viewport별 overflow·hit area·상태 보존·키보드 순서를 실제 DOM과 조작으로 확인한다.
- [ ] iOS Safari와 Android Chrome 실기기에서 한글 키보드·회전·주소창/가림을 검사하고 OS/브라우저·viewport·실기기 여부를 기록한다. 기기 부재는 모바일 검증 대기로 남긴다. → **미완료(기기 부재).**

완료 기준: 8절의 필수 사례가 통과하고 실제 화면에서 주요 동작의 발견성, 가로 넘침, 장문 후보, 오류 복구, 포커스를 확인한다. 실행 환경과 검사 결과를 구분해 기록하고 실제 LLM을 쓰지 않은 결과는 mock 검증으로 명시한다. 3절 모바일 매트릭스의 통과/실패/환경 대기를 구분하며 실기기 검증 없이 모바일 전체 완료로 표시하지 않는다.

#### UCP08 결과 (브라우저 자동화 완료, 실기기 대기)

상태: **브라우저 자동화 완료 · 모바일 실기기 검증 대기**. UCP09는 착수하지 않았다(환경 없음, 아래 UCP09 절).

검증 명령과 실제 결과(2026-11-23 재실행 기준):

```text
sh scripts/prompt-composer-browser/verify.sh   → 459 checks, 0 failed
  (기존 suite: messages·keyboard·contracts·trans06·u12 전부 통과 + UCP08 A~V 23블록)
frontend: node --test 'tests/*.test.mjs'       → 314 통과 / 0 실패
frontend: npx tsc -b                           → 오류 없음
frontend: npx eslint src tests                 → 오류 없음
frontend: npm run build                        → 성공
backend:  uv run pytest -q                     → 596 통과, 96 건너뜀
```

실행 환경(그대로 기록):

- 호스트: **macOS Darwin 25.5.0 / Apple M1** — BC-250이 아니다. 이 사실이 UCP09 차단 사유다.
- 브라우저: `Edg/158.0.4370.33` (CDP). Playwright 기본 chromium이 없어 `CHROME_PATH`로 Edge를 지정했다.
- 백엔드: `STUDIO_ENGINE=fake` + `models.fixture.yaml`, 임시 `STUDIO_DATA_DIR`(매 실행 새 디렉터리).
- 응답 출처: `/system/capabilities`와 `POST /prompt/compose`만 **페이지 안에서 stub**했다. 이유는 `compose_advertised`가 `STUDIO_ENGINE=fake`에서 capability를 숨기기 때문이고, 그대로 두면 패널이 폴백 상태로 남아 모든 검사가 공허해진다. 저장·HTTP·DOM·SQLite·`/assets/{id}/metadata`·`/jobs/{id}/events`는 **실경로**다. 예외적으로 블록 V만 `POST /jobs`(413)와 `/assets/{id}/metadata`(trim된 행)를 결정적 응답으로 대체했다 — UI가 도달할 수 없는 경로이므로.
- 따라서 이 결과는 **번역 품질의 증거가 아니다**. 모델 응답의 의미·귀속·부정 처리 품질은 UCP09 범위다.

자동화가 실제로 확인한 것(요약):

| 묶음 | 확인한 사실 |
| --- | --- |
| A~C 입력 | 패널 렌더, 한글 입력 반영, 입력만으로 요청 없음, Enter가 이미지 폼 제출·후보 요청을 유발하지 않음, IME 조합 Enter 취소(`isComposing`+`keyCode 229`) |
| D~G 장면·칩 | 사전 검색이 결과를 좁히고 분류를 바꾸지 않음, 응답 전 선택은 사전 버튼의 `aria-pressed`와 선택 수로만 표시(초안 전에는 칩 목록이 없음), 응답 후 자동/수동/고정/제외 칩, 인물 귀속 `<select>`, `AI에게 맡기기`, 거부권이 다음 요청에 `pinned`/`entity_id` 없이 전달 |
| H~I 만료·적용 | 편집 후 후보 만료 안내, **만료 후보는 버튼이 비활성이 아니라 눌렀을 때 `stale` 사유를 안내하며 적용되지 않음**, 재생성 후 적용 가능, 적용이 최종 프롬프트·negative 교체 |
| J~K 덮어쓰기·Undo·K2·K3 | 직접 수정 후 적용은 확인 요구, 취소 시 두 필드 유지, 승인 시 교체, Undo가 적용 전 문자열 복원. **K2**: 적용 후 negative만 고친 뒤 되돌리면 텍스트는 복원되지만 negative가 어긋난 적용 기록은 되살아나지 않음(카드 `적용됨` 0). **K3**: 같은 계열에서 모델만 바꾼 뒤 제출해도 이전 모델의 `applied`가 붙은 v3 행이 나가지 않음 |
| L~N 모델·실패·취소 | 모델 변경 시 `failed/expired` 경고와 후보 소거·원문 보존, 실패 시 패널 자체 한국어 카피 표시(서버 진단 문자열 미노출), 취소가 입력·칩 보존 |
| O~S 폴백·키보드·반응형·장문 | 미지원 계열 폴백 안내·생성 비활성, Tab 순회가 구성기 안에서 이동, 360/390/430/768/1280/1440px 가로 넘침 0·적용/칩 버튼 44px 이상·입력 16px, 회전이 재요청을 만들지 않음, 장문 후보 미절단 |
| T~U 저장·복원 | `POST /jobs` 본문이 `schema_version: 3`, 적용 문자열·negative·수동 선택·귀속 보존, metadata·events 되읽기(events는 **파싱**해서 스냅샷이 v3임을 확인), 갤러리 정보 창이 v3로 표시, `이 설정으로 다시 생성`이 적용 문자열·negative·모델 복원, **새로고침 후 같은 복원이 반복됨** |
| V 도달 불가 경로 | 결정적 `413`에서 서버 사유가 `.errorbox`에 표시, `snapshot_trim`이 있는 행에서 정보 창이 `저장 시 축소됨`에 단계 이름 2개를 모두 표시. **UI 표시 계약 증거**이며 서버 사다리 수행 증거가 아니다 |

이번 실행에서 찾은 결함 2건(수정 완료):

| # | 결함 | 증상 | 수정 |
| --- | --- | --- | --- |
| 1 | Undo가 이전 `applied` 기록을 무조건 되돌림 | 두 번째 적용을 되돌리면 첫 적용의 기록이 남아, 화면에 없는 문자열을 카드가 `적용됨`으로 주장. 그 상태가 `toSnapshot`을 거치면 `applied.positive_prompt`가 실제 전송 prompt와 다른 v3 행이 저장됨 | `appliedForRestoredPrompt(applied, positive)` 추가 — 복원 문자열과 기록의 문자열이 일치할 때만 기록 유지. `frontend/tests/prompt-ucp06.test.mjs` 6b로 고정 |
| 2 | Undo 버튼이 남은 단계 없이도 렌더 | `undoRef`는 ref라 비워도 리렌더가 없고, 조건이 `visible.applied !== null`이라 두 번째 적용 후에도 버튼이 남아 눌러도 무동작 | `undoable` 상태 추가, 렌더 조건을 `undoable && onRestore`로 변경 |

#### UCP08 잔여 확인 (승인 후 보완, 4건 추가 수정)

승인 검토에서 지시한 5개 항목을 실제로 실행해 확인했다. 그 과정에서 **결함 4건이 더 나왔다**(전부 실행으로 재현한 뒤 수정).

| # | 결함 | 재현(실행 결과) | 수정 |
| --- | --- | --- | --- |
| 3 | `appliedForRestoredPrompt`가 positive만 비교 | 적용 → **negative 필드만** 수정 → 되돌리기 시 positive가 같으므로 기록이 남고, `toSnapshot`이 `applied.negative_prompt = "neg-x"`를 쓰는데 화면 필드는 `"neg-y"`. 즉 v3에 실행하지 않은 negative가 기록됨 | 두 필드를 비교하도록 시그니처 변경(`{positive, negative}`). `null`과 `""`는 같은 사실로 취급(키 생략 규약). 6c·K2로 고정 |
| 4 | lossy 적용이 후보의 negative를 기록 | negative 미지원 모델에서 2단계 적용 후 `plan.negativePrompt = null`인데 `applied.negativePrompt = "neg-from-candidate"`. 복원하면 실행하지 않은 negative가 되살아남 | `applyCandidate`가 기록할 negative를 **입력으로** 받음. 패널은 `negativeSupported`에 따라 `plan`이 실제 쓴 값을 전달. 6d로 고정 |
| 5 | 기록이 대상 모델에 묶여 있지 않음 | 같은 계열에서 모델만 바꾼 뒤 되돌리면 이전 모델용 프롬프트가 새 모델의 v3 `target_model_id`로 저장될 수 있음. `AppliedResult`는 provider 모델만 기록하므로 순수 함수로는 판정 불가 | 패널이 `undoTarget`으로 적용 시점 target을 보관하고, `sameTarget`이 아니면 **텍스트는 복원하되 기록은 버린다**(안내 문구로 명시). `undoTarget`이 버튼 존재 조건 |
| 6 | 모델 변경 시 `composeRecord`가 살아남음 | `toSnapshot`은 family만 검사하므로 `fake-sd15` → `fake-sd15-alt`(같은 sd15) 전환 후 제출하면 `target_model_id: fake-sd15-alt` + 이전 모델의 `applied`가 함께 담긴 v3 행이 나감. 실행으로 재현(`schema:3, target:fake-sd15-alt, applied:PROMPT_A`) | `chooseModel`에서 `setComposeRecord(null)`. 프롬프트 텍스트는 유지. 브라우저 K3 + `prompt-ucp07.test.mjs`로 고정(수정 되돌리면 K3가 실패함을 확인) |

`undoRef`/`undoable` 동기화 확인 결과: 모델 변경 후에도 버튼은 남는 것이 맞다(복원할 텍스트가 사용자의 것이므로). 다만 그 경우 기록을 복원하지 않도록 위 #5에서 분리했다. 갤러리 복원은 `restartBuilder`+`setComposeRecord(null)`로 새 세션을 시작하고 패널은 repopulate하지 않으므로 stale `undoRef`가 남지 않는다(설계상 의도, App.tsx 주석 참조).

**최초 실패 12건과 제품 결함의 구분**(지시 항목): 12건은 전부 하네스 오류였다 — 칩이 초안 이전에 렌더된다고 가정(3), 만료를 `disabled`로 기대, `failureAlert` override 무시, 브리프 개행 미trim, 존재하지 않는 manual 칩 기대, JSON 공백 의존 substring. 제품 결함은 **1차 자동화에서 2건(1·2), 이번 보완에서 4건(3~6)** 으로 총 6건이며, 전부 **제품 코드 수정**으로 해결했고 하네스 변경으로 가려지지 않았다. 각 결함은 수정을 되돌리면 실패하는 테스트로 고정했다(6c·6d·K3는 revert 후 실제 실패 확인).

**32 KiB 거부와 `snapshot_trim` 안내를 결정적 API 응답으로 검증**(지시 항목, 블록 V 신설):

- `POST /jobs`가 `413 {detail: "Prompt composition exceeds 32 KiB..."}`를 주면 `.errorbox`에 서버 사유가 그대로 표시됨을 확인(2 checks). **클라이언트 오류 처리 검증**이지 사다리 검증이 아니다.
- metadata가 `snapshot_trim: ["evidence_ko","brief_2000"]`인 v3 행을 주면 정보 창이 `저장 시 축소됨: ...`에 **두 단계 이름을 모두** 표시함을 확인(2 checks).
- **실제 서버 사다리 검증은 백엔드 몫으로 분리**한다: `test_prompt_composition_v3.py` 9건(초과 본문 trim, 실행 기록 불변, 재저장, 사다리로도 부족 시 422, DB 왕복, 재시작·재시도). 브라우저에서 사다리를 돌리려면 서버를 조작해야 하므로 그 경로는 여전히 UI 미도달이며, 위 검사는 UI 표시 계약만 고정한다.

이 보완 후 재실행 결과: **459 checks, 0 failed**(직전 447 + K2 4 + K3 3 + V 4), 프런트 314(직전 311 + 6c·6d + 같은 계열 모델 전환 1), 백엔드 596, `tsc -b`·`eslint`·`npm run build` 통과. 6c·6d·K3는 **수정을 되돌리면 실패함을 직접 확인**했다.

검증하지 않은 것(완료로 표시하지 않음):

- **모바일 실기기**: iOS Safari·Android Chrome의 실제 한글 키보드·safe area·주소창 가림은 확인하지 않았다. 위 360/390/430px 결과는 CDP viewport emulation이며 **레이아웃 증거일 뿐 실기기 증거가 아니다**(3절 기준). 상태는 `모바일 실기기 검증 대기`다.
- **32 KiB 저장 거절의 실제 사다리 경로**: 위 블록 V는 클라이언트 표시만 고정했다. 실제 사다리 수행은 백엔드 테스트로만 검증했고, 브라우저에서 사다리가 도는 경로는 UI 미도달이다.
- **`snapshot_trim` 안내의 실데이터 경로**: 저장된 잘린 행은 이 환경에서 만들 수 없어, 결정적 metadata 응답으로 표시 계약만 확인했다.
- **번역 품질**: 위 1절의 이유로 측정하지 않았다.

UCP09로 넘기는 항목: 실제 LLM 응답으로 ①칩 자동 선택의 의미 보존, ②귀속(다인) 정확도, ③부정 조건 처리, ④긴 응답 지연·잘림이 모바일 흐름에 주는 영향, ⑤동일 seed 이미지 비교. 실기기 검증(UCP08 잔여)은 UCP09와 독립적으로 수행 가능하다.

### UCP09 실제 LLM과 이미지 결과 평가

#### UCP09 환경 확인 (2026-11-23, 실행 전 차단 사유 기록)

UCP09는 **실제 llama-server·GPU·모델**을 전제한다. 이번 실행 환경을 확인한 결과 전제가 성립하지 않아 **착수하지 않았고, 어떤 항목도 완료로 표시하지 않는다**.

| 확인 항목 | 실행한 확인 | 결과 |
| --- | --- | --- |
| 실행 호스트 | `uname -a`, `system_profiler SPDisplaysDataType` | `Darwin 25.5.0 arm64`, **Apple M1 (7-core GPU)** — BC-250이 아니다 |
| LLM 서버 | `which llama-server llama-cli` | 둘 다 없음 (`not found`) |
| 이미지 엔진 | `which sd-cli` | 없음 |
| 모델 파일 | `find / -name '*.gguf'` | **0건**. `/opt/sd-models`·`~/.ssh/config`의 원격 호스트 모두 이 호스트에 없음 |
| GPU 도구 | `nvidia-smi`, `rocm-smi`, `vulkaninfo` | 모두 없음 (`command not found`) |
| Python GPU | `torch.cuda.is_available()` | `torch` 미설치 |
| 저장소 내 BC-250 증거 | `bc250-verified.json`, `bc250-gpu-diagnostics.txt` | **다른 호스트의 과거 스냅샷**(Linux 6.17 fc43, `RADV GFX1013`, `/opt/sd-models/*.gguf`). 현재 호스트의 실행 증거가 아니다 |

같은 스냅샷이 기록한 `inference_tested: false`와 `llama-server.service`의 `ActiveState=inactive`도 실연결 성공의 근거가 될 수 없다. 따라서 아래 체크리스트는 **하나도 체크하지 않는다**.

요구된 측정 항목(모델·GGUF 경로, 컨텍스트/추론 설정, 실제 요청·응답, token usage·`finish_reason`, 1·2·3개 후보 성공률, JSON 준수율, clarification 발생, 60초 timeout 적합성, GPU gate 점유/해제, 이미지 생성과의 자원 충돌)은 실환경 접근 후에만 측정 가능하다. **mock 결과로 대체하지 않는다.**

의미 보존 평가(인물 수·위치/배경·의상/색상·인물별 귀속·시간/날씨·부정/제외·관계·수동 선택 보호)와 지원 모델별(SD1.5·Flux.2 Klein·Z-Image·MOSS) 실제 이미지 생성도 같은 이유로 대기다. `config/models.yaml`상 `klein-4b-q8`·`z-image-*`·`moss-image-*`는 `validation_status: configured`이며, 설치 여부를 이 호스트에서 확인할 수 없다.

**평가 입력은 이미 저장소에 있다.** `backend/tests/fixtures/ucp04_eval_cases.json`의 4개 고정 사례(붉은 원피스·비 오는 거리 / 두 여성 중 한 명만 모자 / 텅 빈 해변 / 밤 카페 창가의 코트 남성)가 계열별 faithful·drift 프롬프트를 함께 갖고 있고, `backend/tests/test_prompt_compose_meaning.py`가 **규칙 기반**으로 이를 검사한다. 이 파일은 스스로 "실제 모델 판단이 아니다"라고 명시하며, 특히 `test_the_server_cannot_tell_drift_from_a_paraphrase`가 **서버가 drift를 구별하지 못한다**는 사실을 고정한다. 따라서 UCP09에서 이 픽스처를 실제 Qwen 출력에 적용할 때, **규칙 기반 통과는 의미 보존 성공의 증거가 아니다** — 인물별 속성 귀속·관계·부정 조건처럼 사람이 판단해야 하는 항목은 별도 판정표가 필요하다.

실제 서비스가 광고하는 compose capability와 기존 운영 연결을 사용한다. 고정 사례의 요청·응답, 지연, 모델·프로필 버전, 사전 자동 선택, 원문 의미 보존을 기록한다. 지원 모델별 대표 장면에 대해 seed와 생성 설정을 고정해 기존 사전 조합 결과와 새 후보 결과를 비교한다. GPU 작업은 기존 조정 정책을 따른다.

실행 체크리스트 (2026-11-23 기준 **전부 미착수**. 위 「UCP09 환경 확인」의 차단 사유가 해소된 뒤에만 체크한다):

- [ ] 실제 compose capability·모델·사전·프로필 버전과 gate 연결을 확인한다.
- [ ] 고정 한글 사례로 의미·귀속·부정·사전 선택·후보 차이를 실제 LLM 응답에서 평가한다.
- [ ] 대표 장면을 동일 seed/생성 설정으로 기존 결과와 비교하고 의미 재현·시각 품질을 구분한다.
- [ ] 환경 부재는 대기, 실제 결함은 해당 구현 수정으로 연결하고 전체 완료 여부를 판정한다.

- [ ] 실제 LLM 응답의 길이·지연·오류를 모바일 흐름에 적용해 입력부터 후보 적용까지 클릭·스크롤·수정 횟수를 관찰한다. 사용자 측정이 없으면 사용성 향상 수치를 주장하지 않는다.

완료 기준: 아래 필수 의미 사례에 중대한 인물 수·귀속·행동·부정 조건 오류가 없고 결과별 판정 근거가 있다. 이미지 비교는 의미 재현과 시각 품질을 나눠 평가한다. 환경이 없으면 `환경 대기`로 남기고 mock 통과를 실연결 성공으로 대체하지 않는다. 문제가 있으면 해당 UCP 구현을 수정하고 관련 사례를 다시 검증한다. 실제 응답으로 긴 결과와 대기 상태를 확인하며 mock UI 성공과 실응답 사용성을 구분한다.

### 관련 보완 항목의 작업 배정

이 표의 항목도 사전 프롬프트 구현 범위이며 공통 TODO에 중복 관리하지 않는다.

| 보완 내용 | 담당 태스크 | 완료 판단 |
| --- | --- | --- |
| 활용형·별칭과 사전 누락 | UCP01·UCP04·UCP08 | `앉은`, `서 있다`, `흰 배경`의 양성/반례. 색상 누락을 매칭 성공으로 숨기지 않음. 사전 변경 시 mirror/버전 일치 |
| 상황 문장과 실제 적용 차이 | UCP05·UCP06 | 고급 상황 후보에 미변환 구절이 있으면 적용 전 포함/제외를 명시하거나 핵심 누락 후보 차단 |
| 전체 prompt 토큰 예산 | UCP04 | 완료(근사). `estimate_tokens`가 후보별 최종 문자열 전체를 세고, 계열별 한계는 `token_window`로 구분한다(`sd15` 77, 나머지 미확정). 정확한 tokenizer가 없어 `ceil(단어*1.3)` 근사이며 guidance에 추정임을 명시. 실측·보정은 UCP09 |
| 사전·충돌·alias·출력 품질 감사 | UCP04·UCP08·UCP09 | 같은 고정 평가셋 사용, 사용자 로그 수집 없이 기대 의미를 독립 검토 |
| 실서버 model alias·사전·gate 연결 | UCP03·UCP09 | 실제 광고 capability와 요청 성공/거절 확인. mock과 분리 |
| 구 서버·롤백·DB 복원 | UCP07·UCP08 | v1/v2 호환, v3 미지원 시 직접 입력 유지, 실제 DB 왕복은 UCP07에서 **완료**(임시 DB 재시작·재시도·metadata·sidecar·events 검증). v3 미지원 서버의 브라우저 클릭 검증은 UCP08 |
| 반응형 구조·터치·사전 탐색 | UCP01·UCP02·UCP05 | 3절 레이아웃·44px 조작 영역·긴 내용·상태 보존 기준 |
| 모바일 한글 입력·키보드·회전 | UCP06·UCP08 | IME 오제출 없음, 키보드 가림 없음, 화면 전환 후 입력 보존 |
| 사용자 효율·접근성·실응답 | UCP08·UCP09 | 3절 매트릭스, 실제 확대·스크린리더·실기기 확인 범위, 클릭/스크롤/보정 관찰 |

## 8 필수 검증 사례

| 사례 | 입력 또는 조작 | 기대 결과 |
| --- | --- | --- |
| 한글 우선 | 비 오는 밤 편의점 앞에서 우산을 접으며 친구를 기다리는 사람 | 장면 자동 구성, 접는 행동과 기다리는 관계 보존, 사용자 단계별 번역 불필요 |
| 사전 우선 | 인물·실내 선택 후 창가에서 편지를 읽는 디테일 입력 | 직접 선택 유지, 디테일 포함 |
| 사전만 입력 | 대상·배경·조명 선택 | 빈 한글이어도 후보 생성 |
| 사전 미등록 | 오래된 손목시계를 바라보며 망설이는 표정 | 사전 ID가 없어도 전체 의미 유지 |
| 다인 귀속 | 빨간 우산을 든 여자가 파란 옷의 남자를 기다린다 | 우산과 의상 소유자, 기다리는 방향 유지 |
| 수량과 부정 | 두 사람이 서 있고 안경은 쓰지 않는다 | 두 사람 유지, 안경 긍정 선택 금지, 부정 조건 보존 |
| 복수 속성 | 검은 머리 여자와 금발 남자 | 대상별 속성 유지, 전역 머리색 충돌 오탐 없음 |
| 사용자 충돌 | 사전 밤 직접 선택 후 한낮이라고 입력 | 해당 충돌 확인, 임의 변경/누락 금지 |
| 제외 지속 | 자동 선택된 조명을 삭제 후 다시 만들기 | 자동 재추가 금지, 모순이면 설명 |
| 응답 경쟁 | 요청 후 원문·선택·모델 변경 | 늦은 응답 무시, 최신 입력 보존 |
| 최종 직접 편집 | 후보 적용 후 영어 직접 수정 후 다른 후보 적용 | 덮어쓰기 보호와 이력 불일치 표시 |
| 장애 | timeout, gate 불가, 잘못된 JSON, 과대 응답 | 입력 보존, 명확한 재시도/수동 경로 |
| 과거 복원 | v1/v2 결과 재사용 | 기존 문자열·번역 기록 보존, 자동 LLM 호출 없음 |
| 새 이력 | v3 생성 후 재시작·재시도·갤러리 복원 | 적용 스냅샷과 실제 실행 문자열 보존 |
| 후보 구분 | 동일 장면 영어 후보와 다른 상황 제안 | 기본 후보는 의미 유지, 변형은 별도 동작 |
| 직접 입력 회귀 | 구성기를 사용하지 않고 prompt 입력 후 생성 | 기존 기능 정상 |
| 모바일 전체 흐름 | 360/390px에서 한글 우선과 사전 우선으로 후보 적용 | 가로 넘침·추가 수락 단계 없이 완료, 실제 조작 영역 44px 이상 |
| 긴 내용과 많은 선택 | 긴 영어 후보 3개·긴 이름·다수 칩·긴 오류 | 내용/조작 잘림 없음, 대상과 후보 적용 관계 식별 |
| 한글 IME | 한국어 조합 중 Enter, 줄바꿈, 붙여넣기 | 조합 유실·중복 실행 없음, Enter는 기본 줄바꿈 |
| 모바일 키보드 | 실기기에서 키보드를 연 채 검색·설명·오류 수정 | 입력/오류 접근 가능, sticky/주소창/safe area 겹침 없음 |
| 회전과 패널 재열기 | 입력·검색·선택 후 회전/resize/사전 닫기와 재열기 | 상태 보존, 자동 LLM 재요청 없음 |
| 늦은 결과와 포커스 | 한글 편집 중 응답 도착 또는 결과 안내 | 포커스/스크롤 강탈 없음, revision 검사 유지 |
| 확대와 키보드 탐색 | 실제 확대 200%, Tab으로 검색·칩·후보·적용 | 가려짐 없이 접근, 이름/상태와 읽기 순서 유지 |

의미 보존은 코드 테스트만으로 완전히 증명되지 않는다. 고정 사례의 실제 LLM 응답과 생성 결과 평가를 함께 남긴다. 특정 사전 항목이 없으면 존재하지 않는 ID를 만들어 테스트를 통과시키지 않는다.

## 9 검증 명령과 상태 관리

저장소 루트에서 실행한다. 기존 문서의 과거 통과 개수는 이번 결과로 재사용하지 않는다. 태스크 중에는 관련 테스트를 실행하고 UCP08에서 전체 회귀를 수행한다.

```sh
node --experimental-strip-types --test frontend/tests/*.test.mjs
npm --prefix frontend run build
npm --prefix frontend run lint
.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q
STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh
.venv/bin/ruff check backend/app backend/tests
git diff --check
```

새 compose 테스트 파일은 생성 후 해당 명령 또는 테스트 수집 경로에 포함한다. Node 실행 옵션과 Python 환경은 현재 프로젝트 요구사항에 맞춘다. 브라우저/실연결 검증은 별도 실행하고 base URL, 실제 또는 mock provider, 모델, 날짜, 결과 위치를 기록한다. 인증 토큰과 비밀 설정은 기록하지 않는다.

### 태스크별 현재 결과와 인계

7절의 상태표와 각 태스크 아래에 다음 형식을 유지한다. 진행 중인 태스크의 구현 결과·계약 결정·검증·남은 문제를 이 문서 안에서 확인할 수 있어야 한다. 동일 내용을 공통 TODO나 별도 실행 문서로 이동하지 않는다. 재실행 때 기존 항목을 최신 상태로 교체하고 날짜별 긴 히스토리는 누적하지 않는다.

```text
상태: 대기 / 진행 / 완료 / 환경 대기 / 실패 수정 중
변경 파일과 구현된 동작:
이 문서에 반영한 계약 결정:
검증 명령과 실제 결과:
브라우저 또는 실연결 검증 범위:
모바일 검증 환경과 결과: OS/브라우저, viewport, 실기기 또는 emulation, IME/키보드/회전
남은 문제와 차단 사유:
다음 실행 단위:
```

UCP01은 계약 확정 완료, UCP02·UCP03·UCP04·UCP05·UCP06·UCP07은 구현 완료이며 UCP08·UCP09는 대기다. UCP05의
결과는 단위 테스트와 mock API 브라우저 배치까지, UCP06의 결과는 통합 테스트까지, UCP07의 결과는 API·순수 모듈과
임시 DB 왕복까지이며, 실기기·실연결 통과 검증은 아직 기록하지 않는다(UCP08·UCP09로 이월). 구현 후 현재 구성 문서에 설명을 반영하더라도
이 실행 명세의 전체 설계·태스크·완료 기준은 유지한다.

브라우저·실연결로 미뤄 둔 항목을 명시한다. 아래는 mock이나 순수 함수 검증으로 대체하지 않고,
해당 실행 단위에서 실제 환경으로 확인해야 한다.

| 항목 | 확인 시점 |
| --- | --- |
| 반응형 결과 화면 배치·44px 조작 영역·가로 넘침 | UCP05에서 mock·데스크톱 반응형으로 부분 확인, 실기기 확인은 UCP08 |
| 화면 회전·폭 변경·패널 접기에서 상태 보존(실제 레이아웃) | UCP05에서 상태 보존 로직·mock 배치 확인, 실기기 회전은 UCP08 |
| 귀속 select·AI에게 맡기기·충돌 해소·되돌리기 블록의 실제 배치·터치 | UCP06에서 상태·계약만 고정, 브라우저 확인은 UCP08 |
| iOS Safari·Android Chrome 실기기 한글 IME·키보드 가림 | UCP08 |
| 실제 provider 응답의 잘림·추론 토큰 분포·후보 품질 | UCP09 |
| 실제 v3 스냅샷의 DB·metadata·sidecar·재시작 왕복 | UCP07 |

## 10 전체 완료 기준과 착수 지시

UCP01~08의 코드·호환성·반응형 브라우저 검증, UCP08의 모바일 실기기 검증, UCP09의 실연결·품질 검증 완료를 구분한다. 전체 완료는 두 범위가 모두 충족될 때만 기록한다. 최종 결과는 한글 우선과 사전 우선 모두에서 한 번의 실행으로 자동 선택과 영어 후보를 제공하고, 원문 의미와 사용자 편집 의도를 보존해야 한다.

DeepSeek 4.1 Flash는 이 문서를 읽고 UCP01부터 순서대로 진행한다. 시작 시 현재 작업 트리와 기존 구현을 확인하고 다른 작업의 변경을 보존한다. 이 문서의 예시는 설계 요구사항이며 현재 구현된 기능으로 오인하지 않는다. 각 태스크에서 구현·관련 검증·현재 상태 갱신을 마친다. 최우선 작업을 기존 잔여 번역 버튼 개선이나 사전 확장으로 대체하지 않는다. 새로운 실행 문서를 분산 생성하지 말고 이 문서 안에서 결정과 상태를 갱신한다.
