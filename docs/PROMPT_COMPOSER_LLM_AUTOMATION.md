# Prompt Composer LLM 자동화 제안 설계

작성일: 2026-11-15 · 상태: **제안 설계 + A5/A7 결정론 선행 구현** · 상위: [P5 문서의 P8](PROMPT_COMPOSER_P5.md) · 진행 추적: [후속 작업 추적](PROMPT_COMPOSER_FOLLOWUP.md)

이 문서는 Prompt Composer에서 LLM으로 자동화할 수 있는 지점을 우선순위와 계약 경계까지 정리한 제안이다. A5(원문 → 사전 후보)와 A7(경고 해설)은 **LLM 없이 결정론적 규칙으로 먼저 구현**해 UI와 계약을 고정했고, 나머지는 여전히 `설계만`이다. LLM 호출·제안 API·스키마·CI·운영 설정은 변경하지 않았다. 승인 전까지 나머지 항목은 완료로 표시하지 않는다.

## 1. 현재 구조에서 확인한 사실

제안의 근거가 되는 현황이다. 모두 현재 저장소 코드에서 확인했다.

| 사실 | 근거 |
| --- | --- |
| 사전은 100개 항목, 13개 카테고리 | `frontend/src/prompt/dictionary.ts` (`DICTIONARY`) |
| 4개 family 모두 100/100 매핑 완료, `fake`만 0/100 | `familyCoverage`, `MODEL_FAMILIES` |
| legacy 12개는 sd15/z-image/flux2/moss에 **같은 문자열** 재사용 | `legacyEntries` 매핑 블록 |
| expanded 88개만 sd15/natural 2컬럼으로 구분 | `expandedEntries` 튜플 구조 |
| 충돌 쌍 12개·배타 그룹 1개를 **손으로 하드코딩** | `conflictPairs`, `exclusiveGroups` (`compiler.ts`) |
| 토큰 수는 단어 수 × 1.3 근사, SD15 77토큰 창 | `estimateTokens`, `SD15_TOKEN_WINDOW` |
| 최종 prompt 조립은 결정론적 compiler가 수행 | `compileScene`, `COMPILER_VERSION = "1.3.0"` |
| 클라이언트·서버 검증이 미러 구조 | `validation.ts`, `backend/app/models/schemas.py` |
| LLM은 llama-server(8080) + admission gate(8081) | `docs/LLM_GATE.md`, `GateSettings` |
| LLM과 이미지 생성이 **같은 GPU를 공유**하고 정책으로 중재 | `policy: manual/chat_priority/image_priority`, `GPUManager.leased/blocked` |
| 브라우저→LLM 직접 접근은 금지, 통합 chat proxy 없음 | `integrated_chat_proxy: False`, `docs/NEXT_PROJECT_LLM_CLIENT.md` |

## 2. 설계 원칙 (타협 불가)

LLM을 넣으면서 지켜야 하는 경계다. 이걸 어기면 지금까지 만든 재현성·검증이 무너진다.

1. **LLM은 제안만, 조립은 compiler가 한다.** 최종 prompt 문자열은 항상 결정론적 `compileScene`이 만든다. LLM 출력이 최종 prompt를 직접 대체하지 않는다.
2. **원문은 불변.** `free_text_ko`는 저장·표시 시 절대 변형하지 않는다. LLM 번역/보강은 별도 필드의 제안으로만 존재한다.
3. **적용은 명시적.** 사용자가 제안을 확인·승인해야 반영된다. 자동 적용·자동 저장·무단 재결속 없음. A5의 현재 구현은 사용자가 버튼을 눌러야만 제안을 계산하고, 각 항목을 개별적으로 수락해야 선택에 들어간다.
4. **출력은 구조화 스키마.** 자유 서술을 파싱하지 않는다. JSON Schema + `extra="forbid"` + 개수/길이 상한. 스키마에 없는 `id`는 거부.
5. **결정론적 validator를 재사용한다.** LLM 제안도 `validateDictionary()`·`compileScene` 경고·32 KiB/8000자/4000자/100개 상한을 통과해야 채택 후보가 된다.
6. **GPU 경합을 기본 전제로 둔다.** 온라인 호출은 gate 경유 + 명시적 트리거 + 짧은 타임아웃. 실패 시 사전/직접 생성이 그대로 동작해야 한다(P8 요구).
7. **재현성 기록.** LLM 제안을 적용한 구성에는 `compiler_version`이 아니라 `proposal_id`·`proposal_model`·`accepted_at`을 남긴다. 컴파일러 버전을 오염시키지 않는다.
8. **free text는 신뢰 경계 밖 데이터.** 시스템 프롬프트에 이어붙이지 않고 별도 user 메시지의 데이터로만 취급한다(프롬프트 인젝션 방어).

## 3. 자동화 후보

각 항목은 "LLM이 하는 일 / 결정론이 지키는 것 / 측정 방법"으로 나눈다. 아래는 **효과와 난이도 기준 나열**이며, 실제 착수 순서는 이 절 끝의 권장 순서를 따른다. 오프라인 배치(A1–A4)는 GPU를 거의 쓰지 않고 효과가 크므로 먼저, 온라인 제안(A5–A7)은 P8 계약과 함께, 평가 보조(A8)는 P6-Q02와 함께 간다.

### A1. 사전 커버리지 갭 탐지 (오프라인 배치)

현재 `free_text_ko`에 사용자가 쓴 표현이 사전 100개에 없으면 그대로 unresolved로 남는다. 어떤 개념이 반복적으로 미등록인지 지금은 알 방법이 없다.

- **LLM:** 축적된 `free_text_ko`(동의·익명화 후)를 배치로 읽어 "사전에 없는 반복 개념"을 카테고리·한국어 라벨·alias·family별 표현 후보로 제안한다.
- **결정론:** `validateDictionary()`(id 형식·중복·카테고리 유효성·빈 매핑 금지)를 통과한 후보만 리포트에 남긴다. 사전 파일은 사람이 승인해야 수정된다.
- **측정:** 미매칭 토큰 비율, 상위 N개 갭의 빈도, 승인된 항목이 실제 검색 hit rate를 올렸는지.

### A2. 충돌 쌍·배타 그룹 후보 발굴 (오프라인)

`conflictPairs` 12개와 `exclusiveGroups` 1개는 100개 항목(=4,950 조합)에서 손으로 고른 것이다. 누락이 있을 수 있고, 항목이 늘면 관리 불가능해진다.

- **LLM:** 카테고리별 항목 쌍을 받아 "동시에 성립하기 어려운 조합"과 그 이유를 제안한다.
- **결정론:** 제안은 `conflictPairs` 형식으로만 채택. 이미지 생성 없이 `compileScene` 회귀(경고 발생 여부)로 검증한다.
- **측정:** 새로 발견된 유효 충돌 수, 오탐률(사람 검토), 기존 12쌍 재현율.

### A3. alias 확장 (오프라인)

`aliases`는 한국어 구어체·오타·은어를 흡수하는 장치다. 지금은 항목당 1~2개로 손으로 채워져 있다.

- **LLM:** 각 `labelKo`에 대해 실제 사용자가 칠 법한 변형(띄어쓰기·조사·줄임말·흔한 오타)을 제안한다.
- **결정론:** 기존 alias와 중복 금지·길이 상한·`validateDictionary` 통과. 검색 함수(`searchDictionary`)로 실제 hit만 채택.
- **측정:** 검색어→선택 전환율, "결과 없음" 검색 비율 감소.

### A4. family별 표현 품질 감사 (오프라인)

legacy 12개는 4개 family에 **같은 문자열**을 쓰고 있다. 자연어 지향 모델(z-image/flux2/moss)에서 `"a person"` 같은 태그형 표현이 어색할 수 있는데, 지금은 이걸 판정할 근거가 없다.

- **LLM:** 각 항목×family 표현이 해당 family의 서술 스타일에 맞는지 감사하고 대안 문구를 제안한다. P6-Q01 renderer profile 후보와 직결된다.
- **결정론:** 문자열 길이·중복 표현(`duplicate_phrase`) 검사. 품질 판정은 하지 않고 후보만 낸다.
- **측정:** 감사에서 지적된 항목 수, P6-Q02 GPU 비교에서 개선이 확인된 비율. **GPU 결과 없이 "더 좋다"고 주장하지 않는다.**

### A5. 원문 → 사전 후보 분해 제안 (온라인, P8 핵심)

가장 실용적인 온라인 기능이다. 사용자가 한국어로 자유 서술하면 지금은 직접 항목을 골라야 한다.

- **LLM:** `free_text_ko`를 읽고 "이 문장이 가리키는 사전 항목 후보 + 신뢰도 + 매칭된 구절"을 구조화 JSON으로 제안한다.
- **결정론:** 후보 id는 반드시 현재 사전에 존재해야 하고, 사용자가 체크해야 `selections`에 들어간다. 원문은 `free_text_ko`에 그대로 남는다. 최종 prompt는 승인 후 compiler가 만든다.
- **측정:** 제안 수락률, 제안으로 줄어든 평균 선택 시간, 잘못된 매칭(사용자 거부) 비율.

**선행 구현 (2026-11-15, 결정론):** `frontend/src/prompt/proposals.ts`의 `suggestSelections()`. LLM 없이 사전 `labelKo`·`aliases` 부분 문자열 매칭으로 동작한다.

| 구현 사실 | 내용 |
| --- | --- |
| 호출 시점 | 타이핑 중에는 아무것도 하지 않는다. 사용자가 **"원문에서 사전 항목 찾기"**를 눌렀을 때만 계산한다(1회 호출 원칙을 UI에서 먼저 지킴) |
| 후보 출처 | 현재 사전의 `active` 항목만. 존재하지 않는 id·번역·표현을 만들지 않는다 |
| 신뢰도 | 구절 길이 + 라벨 일치 여부 + 계열 매핑 가능 여부로 계산한 결정론적 값(0.05~0.98). LLM 확률이 아님 |
| 투명성 | `matchedPhrase`(원문에서 실제로 일치한 부분 문자열)를 함께 표시. 최소 2자 |
| 원문 불변 | `freeTextKo`를 읽기만 한다. 수락해도 원문은 그대로 남는다(테스트로 고정) |
| 수락 경로 | 수동 선택과 **같은** `selectEntry()`를 호출한다. 즉 수락 결과는 손으로 고른 것과 완전히 동일 |
| 이미 선택된 항목 | 제안에서 제외 |
| 계열 미매핑 | `available: false`로 표시하고 신뢰도를 낮춘다. 숨기지 않는다 |

**LLM 교체 지점:** `suggestSelections()`가 지금은 순수 함수다. LLM을 붙일 때는 이 함수의 **입출력 타입(`ProposalRequest`/`SelectionHint`)을 그대로 유지**하고 서버 호출 구현만 갈아끼운다. 그러면 UI·테스트·수락 경로를 바꾸지 않아도 된다. LLM 응답은 반드시 사전 id 화이트리스트를 통과해야 하며, 실패 시 결정론 결과로 조용히 폴백한다.

### A6. 다인 장면 속성 귀속 제안 (온라인, P7 연결)

"빨간 머리 여자와 금발 남자"처럼 속성이 섞이면 현재 단일 actor 모델로는 귀속이 모호하다.

- **LLM:** 문장을 actor별 속성 묶음으로 분해 제안한다.
- **결정론:** P7 Scene v2 스키마가 승인되기 전에는 **제안만 표시**하고 저장하지 않는다. v1에는 반영하지 않는다.
- **측정:** 분해 정확도(사람 평가), P7 승인 후 왕복 보존.

### A7. 경고·충돌의 자연어 설명과 해소 제안 (온라인, 소규모)

현재 `conflict`/`duplicate_phrase` 경고는 코드와 id만 보여준다.

- **LLM:** 발생한 경고를 한국어 한 줄로 설명하고 "둘 중 무엇을 빼면 되는지" 후보를 제안한다.
- **결정론:** 제안은 선택 해제 액션으로만 표현되고 자동 삭제하지 않는다. 경고 자체는 compiler가 계속 계산한다.
- **측정:** 경고 후 사용자 이탈률, 해소까지 걸린 조작 수.

**선행 구현 (2026-11-15, 결정론):** `proposals.ts`의 `explainWarning()` + `PromptBuilder.tsx`의 `prompt-warning--action` 행.

| 경고 | 표시 문구 | 자동 해소 |
| --- | --- | --- |
| `conflict` | "함께 쓰기 어려운 조합입니다: A / B. 둘 중 하나를 해제하세요." | **없음** — 어느 쪽이 틀렸는지는 사용자만 안다 |
| `duplicate_phrase` | "같은 표현이 겹쳐 한 번만 사용했습니다: … 뒤쪽 중복만 해제할 수 있습니다." | 뒤쪽 중복만 "중복 해제" 버튼 제공 |
| `duplicate` | 중복 id 안내 + 뒤쪽만 해제 | 뒤쪽 중복만 |
| `over_limit` | 선택 개수/초안 길이 중 어느 쪽인지 구분한 문장 | 없음 |
| `token_budget` | SD 1.5 텍스트 창 초과 가능성과 영향 | 없음 |
| `unsupported_family` | 계열 변환 미제공 안내 | 없음 |

해소 버튼은 `removeIds`가 비어 있지 않을 때만 렌더한다. `duplicate_phrase`가 id를 1개만 줬을 때는 **유일한 복사본을 지우지 않도록** 빈 배열을 반환한다(테스트로 고정).

### A8. 품질 평가 채점 보조 (오프라인/별도 GPU)

P6-Q02는 12장면 × seed 17/42/123을 사람이 눈으로 비교해야 한다. 이게 가장 느린 병목이다.

- **LLM(vision):** 생성 이미지에 대해 "선택 요소 반영/불필요한 의미 추가/인물별 귀속 오류/아티팩트" 항목을 채점한다.
- **결정론:** 채점은 **보조 지표**다. 최종 판정은 사람이 한다. 채점 프롬프트·모델·버전을 기록해 재현 가능하게 한다.
- **측정:** 사람 평가와의 일치도(κ), 채점 소요 시간 절감.

### 우선순위 요약

| ID | 계층 | GPU | 선행 조건 | 기대 효과 | 상태 |
| --- | --- | --- | --- | --- | --- |
| A1 | 오프라인 배치 | 낮음 | 익명화·동의 정책 | 사전 확장 속도 | 설계만 |
| A2 | 오프라인 배치 | 낮음 | 없음 | 충돌 감지 누락 방지 | 설계만 |
| A3 | 오프라인 배치 | 낮음 | 없음 | 검색 정확도 | 설계만 |
| A4 | 오프라인 배치 | 낮음 | P6-Q01 초안 | family별 표현 품질 | 설계만 |
| A5 | 온라인 1회 | 중간 | P8 계약 승인 | 입력 시간 단축 (최대) | **결정론 선행 구현** — LLM 교체만 남음 |
| A7 | 온라인 1회 | 낮음 | P8 계약 승인 | 오류 이해도 | **결정론 선행 구현** — LLM 교체만 남음 |
| A6 | 온라인 1회 | 중간 | P7 Scene v2 승인 | 다인 정확도 | 설계만 |
| A8 | 별도 배치 | 높음 | P6-Q02 실행 환경 | 평가 속도 | 설계만 |

권장 순서: **A2·A3 → A1 → A4 → A5 → A7 → A8 → A6**. A2/A3는 스키마 변경 없이 사전 파일만 건드리므로 승인 부담이 가장 낮다. A5/A7은 결정론 버전이 이미 들어갔으므로, 남은 일은 계약 승인 후 `suggestSelections`/`explainWarning`의 구현을 서버 호출로 교체하고 Fake LLM 회귀를 붙이는 것이다.

## 4. 제안 API 계약 (초안)

브라우저는 LLM·gate에 직접 접근하지 않는다. Studio 백엔드가 gate를 통해 호출하고, 결과를 **제안 객체**로 정규화해 돌려준다. 아래는 승인 전 초안이며 실제 엔드포인트는 구현하지 않았다. **A5/A7의 현재 구현은 브라우저 안에서 결정론적으로 계산하며 서버를 호출하지 않는다.** 이 계약은 LLM을 붙일 때의 목표 형태이고, 응답 필드는 이미 `SelectionHint`/`WarningExplanation` 타입과 호환된다.

```text
POST /api/v1/prompt/proposals        (제안 생성, 명시적 트리거만)
GET  /api/v1/prompt/proposals/{id}   (결과 조회)
POST /api/v1/prompt/proposals/{id}/accept   (수락 → selections 반영은 클라이언트)
```

요청(개념):

```json
{
  "kind": "selection_hint | attribute_split | warning_explain | translation",
  "target_family": "sd15",
  "dictionary_version": "1.2.0",
  "selections": [{ "id": "subject.person", "category": "subject" }],
  "free_text_ko": "네온이 비치는 골목에 선 여자",
  "limits": { "max_suggestions": 8 }
}
```

응답(개념) — 모든 필드가 상한을 갖는다:

```json
{
  "proposal_id": "...",
  "kind": "selection_hint",
  "provider": { "model": "...", "version": "...", "latency_ms": 812 },
  "suggestions": [
    { "id": "lighting.neon", "confidence": 0.82, "matched_phrase": "네온이 비치는",
      "reason_ko": "조명 조건을 가리킵니다" }
  ],
  "rejected": [{ "raw_id": "lighting.glow", "why": "not_in_dictionary" }],
  "truncated": false
}
```

계약 규칙:

- `id`는 **현재 사전에 존재하는 항목만** 통과. 나머지는 `rejected`에 사유와 함께 남겨 관측 가능하게 한다.
- `suggestions`는 `max_suggestions` 이하, `reason_ko` 길이 상한, `confidence`는 0~1.
- 응답 전체가 32 KiB·개수 상한을 넘으면 잘라서 `truncated: true`로 알린다(조용한 절단 금지).
- 응답은 `extra="forbid"` Pydantic 모델로 검증하고, 스키마 불일치는 422가 아니라 **`status: "unavailable"` 제안**으로 반환해 UI가 조용히 degrade하게 한다.
- 수락 시 저장되는 것은 LLM 원문이 아니라 **`id` 목록 + `proposal_id`**다. 문구는 항상 사전에서 다시 읽어 compiler가 조립한다.

`kind`와 3절 후보의 대응:

| `kind` | 대상 후보 | 온라인 여부 |
| --- | --- | --- |
| `selection_hint` | A5 | 온라인 1회 |
| `attribute_split` | A6 (P7 승인 전에는 표시만) | 온라인 1회 |
| `warning_explain` | A7 | 온라인 1회 |
| `translation` | A5의 원문 번역 변형 | 온라인 1회 |

A1–A4·A8은 대화형 API가 아니라 **오프라인 배치 산출물**이다. 파일(JSON/CSV)로 리포트만 남기며 위 엔드포인트를 쓰지 않는다.

## 5. GPU 경합과 호출 시점

LLM과 이미지 생성은 같은 GPU를 공유한다(`policy`). 제안 호출이 생성 작업을 굶기면 안 되고, 생성 중 호출이 큐를 막아도 안 된다.

| 상황 | 동작 |
| --- | --- |
| `image_priority` + 생성 중 | 온라인 제안 **비활성**. UI는 "이미지 생성 중에는 LLM 제안을 쓸 수 없습니다"를 표시하고 사전/직접 생성을 유지 |
| `chat_priority` | 생성 경계에서 양보 가능. 제안 호출은 gate 대기 허용하되 짧은 타임아웃 |
| `manual` | 관리자가 grant한 경우에만 온라인 제안 |
| `gpu.blocked` (복구 필요) | 온라인 제안 **전면 차단**. 오프라인 배치는 별도 배치 창구 |
| gate/admission 상태 불명 | **fail closed** — 제안 비활성, 오류 아님(정보 안내) |

- 온라인 제안은 사용자가 버튼을 누를 때 **1회만** 호출한다. 타이핑마다 호출하지 않는다(비용·GPU·지연).
- 타임아웃·게이트 실패·모델 미기동 시 **현재 사전/직접 생성 흐름은 그대로** 동작해야 한다(P8 요구).
- 오프라인 배치(A1~A4, A8)는 이미지 큐와 **별도 스케줄**로 돌리고, 결과만 파일로 남긴다. 대화형 경로에 끼워 넣지 않는다.

## 6. 측정·검증 계획

"LLM을 넣었다"가 아니라 "무엇이 개선됐는지"를 수치로 남긴다. 각 항목은 채택 전/후를 같은 조건에서 비교한다.

| 지표 | 정의 | 대상 |
| --- | --- | --- |
| 사전 미매칭률 | `free_text_ko` 중 사전 alias로 안 잡히는 토큰 비율 | A1, A3 |
| 검색 무결과율 | 검색 후 결과 0건인 비율 | A3 |
| 제안 수락률 | 표시된 제안 중 사용자가 체크한 비율 | A5 |
| 오매칭률 | 제안됐지만 사용자가 거부한 비율 | A5 |
| 경고 해소 조작 수 | 경고 발생 → 해소까지 클릭/선택 변경 수 | A7 |
| 충돌 감지 재현율 | 기존 12쌍을 새 방법이 다시 찾아내는 비율 | A2 |
| 채점 일치도 | LLM 채점 vs 사람 채점 Cohen's κ | A8 |

검증 원칙:

- 오프라인 항목은 **이미지 생성 없이** `validateDictionary()`·`compileScene` 회귀와 픽스처 비교로 검증한다.
- 온라인 항목은 Fake LLM(현재 `FakeLLM`)으로 결정론적 응답을 주입해 API·UI 회귀를 검증한다. 실제 llama 호출은 별도 승인·환경에서만.
- 품질 우위(A4, A8)는 **GPU 결과 없이는 주장하지 않는다.** P6-Q02와 같은 조건 통제를 따른다.

**A5/A7 결정론 구현 검증 (2026-11-15):**

```sh
node --experimental-strip-types --test frontend/tests/prompt-proposals.test.mjs
node --experimental-strip-types --test frontend/tests/*.test.mjs
cd frontend && npx tsc -b && npm run lint && npm run build
```

| 검사 | 결과 |
| --- | --- |
| 단위 테스트 9건(`prompt-proposals.test.mjs`) | 통과 — id 화이트리스트, matchedPhrase 원문 포함, 원문·사전 불변, 결정론·정렬·상한, 수락=수동선택 동일, 중복 꼬리만 해제 |
| 프런트 전체 단위 테스트 | 38건 통과(기존 29 + 신규 9) |
| `tsc -b` / `eslint` / `vite build` | 통과 |
| 실제 Chromium(360·1280px) | 타이핑만으로 제안 없음, 버튼 클릭 시 4건 제안(65/65/45/45%), 수락 시 칩 반영·원문 유지, 선택 항목 제안 제외, 충돌 경고 문장·자동 해제 버튼 없음, 360px 가로 넘침 0 |

**아직 검증하지 않은 것:** 실제 LLM 응답 품질, 제안 수락률/오매칭률 기준선, GPU 동시 사용 시 지연. 이 수치 없이 "입력 시간이 줄었다"고 주장하지 않는다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 프롬프트 인젝션 (free text에 지시문 삽입) | 제안 오염·오작동 | free text를 시스템 프롬프트에 합치지 않고 데이터로만 전달, 출력은 스키마 강제, 사전에 없는 id 거부 |
| 환각 항목 생성 | 존재하지 않는 선택지 | `id` 화이트리스트 검증, `rejected`로 관측, UI는 사전 항목만 렌더 |
| GPU 굶김·생성 지연 | 생성 SLA 저하 | 정책별 호출 차단표(5절), 온라인 1회 호출, 짧은 타임아웃, fail closed |
| 결정론 붕괴 | 같은 입력에 다른 최종 prompt | LLM은 제안만, 최종 조립은 compiler. `proposal_id`만 기록하고 compiler_version 불변 |
| 원문 변형 | 사용자 의도 손실 | `free_text_ko` 불변 규칙, 번역은 별도 필드 |
| 비용·지연 | 응답 느림 | 1회 호출·상한·캐시(동일 입력 해시), 오프라인 우선 |
| 개인정보/민감 표현 | 유출 | 배치 입력 익명화·동의 정책(A1 선행 조건), 로그에 원문 미기록 |
| 모델 교체 시 재현 불가 | 과거 제안 재현 불가 | `provider.model/version`·프롬프트 해시·응답 원문(별도 보관) 기록 |

## 8. 승인 경계

이 문서는 제안이며 다음은 **승인 전 수행하지 않는다.**

- 사전 스키마·저장 계약 변경 (A2/A3도 사전 파일 형식이 바뀌면 별도 승인)
- Scene v2·actor 귀속 저장 (A6)
- 제안 API 엔드포인트·응답 스키마 추가
- LLM/vision 모델 추가 기동, 운영 GPU 사용, gate 경로 변경
- CI·배포 파이프라인 변경

이미 수행한 것(A5/A7 결정론 선행 구현)은 위 항목에 해당하지 않는다. 브라우저 내 순수 함수, 새 UI 두 곳, 단위 테스트뿐이며 서버·스키마·GPU·배포를 건드리지 않았다. LLM을 실제로 붙이는 순간부터는 위 승인이 필요하다.

구현 착수 시 필요한 것: 대상 항목 확정, 계약 승인, Fake LLM 기반 회귀 테스트, 측정 지표 기준선 수집. GPU가 필요한 항목(A4·A8)은 P6-Q02 실행 환경과 함께 별도 승인한다.

## 9. 변경 파일 목록

| 파일 | 변경 내용 |
| --- | --- |
| `docs/PROMPT_COMPOSER_LLM_AUTOMATION.md` | 신규. 본 제안 설계 + A5/A7 결정론 구현 기록 |
| `frontend/src/prompt/proposals.ts` | 신규. `suggestSelections()`·`explainWarning()` 순수 함수(LLM 교체 지점) |
| `frontend/tests/prompt-proposals.test.mjs` | 신규. 9건 — id 화이트리스트·원문 불변·결정론·해소 안전성 |
| `frontend/src/components/PromptBuilder.tsx` | 제안 패널, 경고 해설 행, `acceptHint`/`removeRedundant` |
| `frontend/src/styles.css` | `.prompt-proposals`, `.prompt-proposal`, `.prompt-warning--action`, 460px 미디어 쿼리 |
| `docs/PROMPT_COMPOSER_FOLLOWUP.md` | LLM 제안 8항목 추적 행 + A5/A7 상태 반영 |
| `docs/PROMPT_COMPOSER_P5.md` | P8 절에서 본 문서 참조 |
| `README.md` | 문서 목록에 추가 |

서버·사전 데이터·스키마·CI·운영 설정·모델 파일은 변경하지 않았다. LLM 호출 코드도 추가하지 않았다.
