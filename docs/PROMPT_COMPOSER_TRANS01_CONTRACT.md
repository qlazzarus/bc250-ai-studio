# TRANS01 계약 결정: 사전 밖 잔여 구절의 번역 제안

작성일: 2026-11-19 · 기준 HEAD `16f3a34` · 선행: 없음

**이 문서는 결정문이며 계약 후보다. 코드·스키마·테스트를 수정하지 않았다.** 승인 전까지 현재 v1 동작("사전 ID만 선택으로 승격, 번역 제안 미지원")이 유일한 사실이다. 이 문서의 결정은 TRANS03 착수를 위한 입력이며, 승인 없이 TRANS03을 시작하지 않는다.

> **이행 기록 (2026-11-19)**: 이 문서의 §8 승인 요청은 **채택되어 TRANS03–TRANS05로 구현됐다.** 아래 결정·측정값은 구현 후에도 그대로 유효하며, 구현 상태와 인계는 [단일 실행 태스크](PROMPT_COMPOSER_EXECUTION_TASKS.md) §1의 각 태스크에 있다. 이 문서는 결정 시점의 근거로 보존하고, 구현으로 바뀐 사실만 §0·§8에 표시한다.

활성 태스크 상태는 [단일 실행 태스크](PROMPT_COMPOSER_EXECUTION_TASKS.md) §1 TRANS01이 소유한다. 설계 금지선과 배경은 같은 문서 §1, 원칙은 [LLM 자동화 문서](PROMPT_COMPOSER_LLM_AUTOMATION.md) §2를 따른다.

## 0. 판정 요약

| # | 결정 항목 | 결정 | schema v2 필요 |
| --- | --- | --- | --- |
| 1 | 필드 형태 | `PromptComposition`에 선택 필드 `remainder`(구절 단위 배열)를 추가한다. `unresolved` 항목 확장은 채택하지 않는다. | **필요** |
| 2 | 한도 | 항목 8개 · `source_ko` 200자 · `suggested_en` 200자. 별도 바이트 상한을 두지 않고 기존 구성 32 KiB가 구속한다. 요청 쪽은 구절 원문이 아니라 **오프셋**으로 보낸다(TRANS03). | 한도는 v2와 함께 |
| 3 | 재현성 기록 | 항목마다 `proposal_id`·`proposal_model`·`accepted_at`을 남긴다(원칙 7). 이는 새 필드이므로 v2에 포함한다. | **필요** |
| 4 | 어휘 판정 | `draft_prompt`에 합치지 않는다. 최종 프롬프트는 `applyDraft` 한 곳에서 `draft` + `\n` + 수락된 번역문으로 만든다. sd15 77토큰 경고는 **최종 프롬프트**로 다시 계산한다. | 불필요(계산 규칙) |

**승인 대기 항목은 하나였다: schema v2 채택 여부.** 2026-11-19에 채택되어 TRANS03이 v2를 구현했고, TRANS04·TRANS05가 그 위에서 화면과 저장을 완성했다(§8 이행 기록).

## 1. 실측 근거

모두 이 저장소의 현재 코드로 측정했다. 재현 명령은 §9.

### 1.1 구성 스냅샷(`PromptComposition`, 상한 32 KiB)

| 조합 | 현재 바이트 | 32 KiB 대비 여유 |
| --- | --- | --- |
| 선택 20 · 원문 4,000자 · 초안 2,000자 · unresolved 3×200자 | 19,243 | +13,525 |
| 선택 0 · 원문 4,000자 · 초안 8,000자 · unresolved 3×200자 | 22,060 | +10,708 |
| 선택 100 · 원문 1,000자 · 초안 2,000자 · unresolved 1×200자 | 21,697 | +11,071 |
| 선택 20 위 조합 + remainder 8개(ko 200 + en 200) | 25,937 | +6,831 |
| 선택 20 위 조합 + remainder 8개 + 항목별 출처 3필드 | 26,849 | +5,919 |
| 선택 100 위 조합 + remainder 8개 + 항목별 출처 3필드 | 29,303 | +3,465 |
| 선택 100 · 원문 4,000자 · 초안 8,000자 · unresolved 2건 | **48,738 (이미 초과)** | −15,970 |
| 선택 100 · 원문 4,000자 · 초안 8,000자 · unresolved 101×4,000자 | 1,252,197 | −1,219,429 |

**측정이 뒤집은 전제 두 개.**

첫째, **필드별 상한은 구성을 실제로 제한하지 않는다.** `unresolved`는 101개·항목 4,000자([schemas.py:72,83](../backend/app/models/schemas.py))라 이론상 1.25 MB(1,252,197 B)이고, 그것이 `validate_snapshot`의 32 KiB 검사([schemas.py:90-92](../backend/app/models/schemas.py))에서 거부된다. 즉 상한표는 "UI가 만들 수 있는 모양"을 서술할 뿐이고, 저장 가능성을 결정하는 것은 오직 UTF-8 바이트 합계다. 그러므로 새 필드의 한도는 **바이트 안전이 아니라 의미(화면에 몇 개를 보여줄 것인가)로** 정해야 한다.

둘째, **32 KiB는 이미 빡빡하다.** 선택 100 + 원문 4,000자 + 초안 8,000자를 동시에 채우면 오늘도 48,738 B로 거부된다. 그러므로 "새 필드가 예산을 나눠 쓴다"는 서술은 정확하지 않다. 새 필드는 **현실적인 조합에서만** 여유가 있고(5.9–6.8 KB), 이미 초과인 조합에서는 아무것도 잃지 않는다.

### 1.2 제안 응답(상한 16 KiB)

`remainder_translation` 응답 8개 항목 + 항목별 출처 3필드 = **8,066 B / 16,384 B** (여유 +8,318). 응답 쪽은 병목이 아니다.

### 1.3 제안 요청(상한 8 KiB) — 가장 좁은 곳

| 조합 | 바이트 | 8 KiB |
| --- | --- | --- |
| 오늘: 선택 100 · 한글 800자 | 7,966 | 여유 226 |
| 오늘: 선택 100 · 한글 1,000자 | **8,566** | **이미 초과** |
| 오늘: 선택 60 · 잠금 60 · 한글 1,000자 | 7,474 | 여유 718 |
| 구절 원문을 요청에 실음: 선택 0 · 한글 1,000자 · 8×200자 | 8,183 | 초과 |
| 구절 **오프셋**으로 보냄: 선택 0 · 한글 1,000자 · 8개 | 3,487 | 여유 4,705 |
| 구절 원문을 요청에 실음: 한글 4,000자 · 8×200자 | 17,183 | 초과 8,991 |

**구절 원문을 요청에 싣는 방식은 폐기한다.** 200자 한글 구절 하나가 611.9 B인데, 오프셋 쌍 하나는 27.5 B다(33배). `free_text_ko`가 이미 요청에 실려 있으므로 원문을 반복 전송할 이유가 없고, 8 KiB에서 그 33배는 감당할 수 없다. 요청은 `{start, end}` 오프셋만 보내고 **서버가 `free_text_ko`에서 잘라 쓴다**(TRANS03).

반면 **구성 스냅샷에는 `source_ko` 원문을 저장한다.** 스냅샷은 요청이 아니라 기록이고, `free_text_ko`가 나중에 편집되면 오프셋이 어긋나기 때문이다. 두 표현이 다른 것은 의도이며, TRANS03은 구성 필드를 요청 본문으로 복사해서는 안 된다.


## 2. 결정 1 — 필드 형태

### 결정 1 요약

`PromptComposition`에 **최상위 선택 필드 `remainder`** 를 추가한다. 항목은 구절 단위다.

```python
class CompositionRemainder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_ko: str = Field(min_length=1, max_length=200)     # 사전이 덮지 못한 원문 구절
    suggested_en: str = Field(min_length=1, max_length=200)  # 사용자가 포함을 선택한 번역문
    proposal_id: str = Field(min_length=8, max_length=64)
    proposal_model: str = Field(min_length=1, max_length=200)
    accepted_at: str = Field(min_length=20, max_length=20)   # ISO-8601 UTC, 초 단위

class PromptComposition(BaseModel):
    ...
    remainder: list[CompositionRemainder] = Field(default_factory=list, max_length=8)  # v2 only
```

`unresolved`는 **건드리지 않는다.** `unresolved` 항목에 `suggested_en`을 다는 대안(태스크 문구의 두 번째 선택지)은 채택하지 않는다. 이유는 §2.3.

### 2.1 왜 최상위 배열인가

`remainder`는 `unresolved`와 수명이 다르다. `unresolved`는 **컴파일 결과**이고(`compileScene`이 원문 전체 1건을 넣는다, [compiler.ts:116](../frontend/src/prompt/compiler.ts)), `remainder`는 **사용자가 수락한 편집**이다. 한 필드에 두면 `kind`로 분기하는 두 가지 의미가 한 배열에 섞이고, `unresolved`를 다시 컴파일할 때(`restoreComposition` → 재생성) 번역문이 컴파일 산출물처럼 떠내려간다. 별도 배열이면 "재생성은 `remainder`를 지우지 않는다"를 필드 이름만으로 표현할 수 있다.

또한 `unresolved`는 필드 상한이 101개이고 서버가 최대 8개로 자른다([prompt_proposals.py:25](../backend/app/services/prompt_proposals.py) `MAX_UNRESOLVED`). 번역은 사용자가 명시적으로 포함을 누른 것만 남으므로 개수 의미가 다르다.

### 2.2 `extra="forbid"`와 구서버 422

`PromptComposition`은 `extra="forbid"`다([schemas.py:76](../backend/app/models/schemas.py)). 실측으로 확인했다: 현재 v1 모델에 `remainder`를 넣으면 `Extra inputs are not permitted [type=extra_forbidden]`로 거부된다.

배포 영향은 **읽기와 쓰기가 다르다.**

| 경로 | 구서버 + 신클라이언트 | 영향 |
| --- | --- | --- |
| `POST /api/v1/jobs` (구성 포함) | **422** | 구서버가 `remainder` 키를 모르므로 작업 제출이 거부된다. |
| `GET /assets/{id}/metadata` (읽기) | 통과 | 서버는 저장된 JSON을 그대로 돌려주고 응답에서 스키마 검증을 하지 않는다([routes.py:682-690](../backend/app/api/routes.py)). |

즉 **쓰기가 먼저 깨진다.** 이 위험은 배포 순서로만 없앨 수 있고 필드 형태로는 없앨 수 없다. 조치:

1. 프론트는 `prompt_composition.schema_versions`에 `2`가 있을 때만 `remainder`를 **보낸다**. 이미 `compositionSupported`가 이 값을 읽는다([App.tsx:166-171](../frontend/src/App.tsx)). v1 서버에는 v1 모양 그대로 보내므로 422가 나지 않는다.
2. 서버는 배포 후 `schema_versions: [1, 2]`를 광고한다. 그때 프론트가 2를 고른다.
3. 반대 조합(신서버 + 구클라이언트)은 안전하다. 구클라이언트는 `remainder`를 보내지 않고 서버 기본값은 빈 배열이다.

**서버는 두 버전을 동시에 받아야 한다.** `schema_version: Literal[2]`로 올리면 v1 스냅샷 복원·재제출이 전부 깨진다. 저장된 자산의 `prompt_composition`은 과거 사실이므로 마이그레이션하지 않는다(§2.4).

### 2.3 채택하지 않은 대안: `unresolved` 항목 확장

`CompositionUnresolved`에 `suggested_en`을 다는 방식은 셋 때문에 탈락한다.

- `unresolved`는 `compileScene`이 만드는 산출물이라 재생성 시 통째로 교체된다. 사용자가 수락한 번역이 재생성 한 번으로 사라진다. 이는 "적용은 명시적"(원칙 3)과 자동 변형 금지에 정면으로 어긋난다.
- `unresolved`의 `text`는 **원문 전체 1건**이다([compiler.ts:116](../frontend/src/prompt/compiler.ts)). 구절 단위 번역을 담으려면 배열 의미를 바꿔야 하는데, 그것은 기존 필드의 의미 변경이다(설계 금지선).
- 서버는 `unresolved`를 8개로 자른다. 사용자가 수락한 항목이 잘리는 것은 표시 문제가 아니라 **데이터 손실**이다.

### 2.4 마이그레이션 없음

기존 저장 스냅샷에는 `remainder`가 없다. 읽을 때 `[]`로 채우고 **다시 저장하지 않는다**(기존 스냅샷 재결속 금지). `restoreComposition`은 v1 스냅샷을 그대로 복원하고 `remainder`를 빈 배열로 둔다. `schema_version`은 **기록된 값 그대로** 보존하며, 복원한 상태를 다시 저장할 때만 현재 버전으로 올린다.

## 3. 결정 2 — 한도

### 결정 2 요약

| 대상 | 상한 | 근거 |
| --- | --- | --- |
| 항목 수 | **8** | 서버 `MAX_UNRESOLVED = 8`과 동일. 한 응답이 만들 수 있는 최대치에 맞춘다. |
| `source_ko` | **200자** | 서버 `MAX_UNRESOLVED_CHARS = 200`과 동일. 새 숫자를 만들지 않는다. |
| `suggested_en` | **200자** | 위와 동일. 영어는 한국어보다 짧아 실제로는 여유가 있다. |
| `proposal_id` | 8–64자, `[A-Za-z0-9_-]` | 기존 `proposal_id` 문법과 동일 |
| `proposal_model` | 1–200자 | `ProposalProvider.model`과 동일 |
| `accepted_at` | ISO-8601 UTC 20자 (`YYYY-MM-DDTHH:MM:SSZ`) | 초 단위. 밀리초는 기록 목적에 불필요 |
| 별도 바이트 상한 | **두지 않는다** | 구성 전체 32 KiB가 유일한 구속력(§3.1) |

**8개·200자의 출처는 새 판단이 아니라 기존 상한의 재사용이다.** 브라우저가 8개를 넘게 받을 수 없고, 서버가 200자를 넘는 구절을 만들 수 없다. 그러므로 이 숫자는 "새로 정한 예산"이 아니라 "이미 존재하는 계약의 상한을 구성 쪽에 반영한 것"이다.

### 3.1 바이트: 32 KiB가 유일한 실효 상한

§1.1의 측정대로 필드별 상한은 구성을 제한하지 않는다(`unresolved` 101×4,000자는 1,252,197 B). 실효 상한은 `validate_snapshot`의 32 KiB UTF-8 검사 하나다([schemas.py:90-92](../backend/app/models/schemas.py)).

현실적 최대치에서 `remainder` 8개 + 출처 3필드는 **+7,606 B**를 쓴다(19,243 → 26,849). 32 KiB 안에 5,919 B가 남는다. 그리고 이미 32 KiB를 넘는 조합(선택 100 + 원문 4,000 + 초안 8,000 = 48,738 B)에서는 `remainder`가 추가로 잃을 것이 없다 — 그 조합은 오늘도 거부된다.

**따라서 별도 바이트 예산을 만들지 않는다.** 별도 상한을 두면 두 개의 진실이 생기고, 둘 중 하나만 갱신되는 순간 `validateComposition`과 서버 검증이 어긋난다. 대신 TRANS05가 32 KiB를 재측정한다(태스크 문구의 요구).

### 3.2 요청 8 KiB — 구절 원문을 보내지 않는다

TRANS01에서 가장 중요한 발견이다.

- 오늘 이미 **선택 100 + 한글 1,000자 = 8,566 B**로 8 KiB를 넘는다. 새 필드를 위한 여유가 없다.
- 구절 원문 200자 한글 = **611.9 B**. 오프셋 쌍 하나 = **27.5 B**. 33배 차이다.
- 구절 원문을 요청에 실으면 한글 1,000자 + 8구절 = 8,183 B로 즉시 초과한다.
- 오프셋으로 보내면 같은 조건이 3,487 B다.

**결정: 요청은 `remainder_spans: [{start, end}]` 오프셋만 보내고, 서버가 `free_text_ko`에서 잘라 쓴다.**

이 결정은 `frontend/src/prompt/matching.ts`의 기존 표현과 정확히 같다. `PhraseOccurrence`가 이미 `start`(포함)·`end`(배제) 인덱스를 쓴다([matching.ts:30-38](../frontend/src/prompt/matching.ts)). TRANS02가 이 값을 그대로 돌려주면 되고 새 좌표계를 만들 필요가 없다.

**주의 — 구성 스냅샷은 반대로 원문을 저장한다.** 스냅샷은 기록이고, `free_text_ko`가 나중에 편집되면 오프셋이 무의미해진다. 요청은 "지금 이 원문의 어디"이고 기록은 "그때 무엇이었나"다. 두 표현이 다른 것은 의도이며, **TRANS03은 구성 필드를 요청 본문으로 복사해서는 안 된다.**

### 3.3 요청 크기 가드

`remainder_translation` 요청은 `selections`를 보내지 않는다(번역은 사전과 무관하다). 이 경우 오프셋 8개가 붙어도 8 KiB 안에 충분히 들어간다(한글 2,000자 + 8오프셋 = 6,487 B). 다만 `proposalBody`의 기존 전신 바이트 검사([llmProposals.ts:271](../frontend/src/prompt/llmProposals.ts))를 그대로 통과시켜야 하며, 초과 시 기존 `too_large` 코드로 거절한다. 새 오류 코드를 만들지 않는다.

## 4. 결정 3 — 재현성 기록

### 결정 3 요약

`remainder`의 각 항목에 `proposal_id`·`proposal_model`·`accepted_at`을 **필수**로 남긴다. 최상위 한 벌이 아니라 항목별 필드다.

### 4.1 왜 항목별인가

원칙 7은 "LLM 제안을 적용한 구성에는 `compiler_version`이 아니라 `proposal_id`·`proposal_model`·`accepted_at`을 남긴다"고 요구한다([LLM 자동화 §2](../docs/PROMPT_COMPOSER_LLM_AUTOMATION.md)). 한 구성에 서로 다른 호출의 번역이 섞일 수 있으므로(구절 하나를 다시 번역하면 새 `proposal_id`), 최상위 한 벌로는 어느 문장이 어느 호출에서 왔는지 기록할 수 없다.

### 4.2 원칙 7의 나머지 절반: `compiler_version`을 오염시키지 않는다

`compiler_version`은 계속 `compileScene`의 버전만 가리킨다([builderState.ts:32](../frontend/src/prompt/builderState.ts)). 번역문이 최종 프롬프트에 섞여도 `compiler_version`을 올리지 않는다. 이 분리가 원칙 7의 핵심이며, TRANS03·TRANS04가 `COMPILER_VERSION`을 건드리면 위반이다.

같은 이유로 `draft_prompt`도 건드리지 않는다 — `draft_prompt`는 컴파일러 산출물로 남고, 번역문은 `remainder`에만 있다(§5).

### 4.3 저장하지 않는 것

`proposal_model`은 **모델 이름**이지 응답 원문이 아니다. 다음은 저장하지 않는다.

- 번역 신뢰도(`confidence`): 화면 표시용이며 구성 기록에는 넣지 않는다.
- `finish_reason`·`latency_ms`: 호출 관측값이며 구성의 사실이 아니다.
- 거절·보류 목록: 사용자가 수락하지 않은 것은 구성에 존재하지 않는다.
- 시스템 프롬프트·원시 응답: 원칙 8의 신뢰 경계 밖 데이터다.

이 경계는 C02-5("제안 이력은 저장되지 않는다")를 바꾸지 않는다. 저장되는 것은 **수락된 번역문과 그 출처 3필드**뿐이고 호출 이력은 여전히 없다. TRANS01이 C02-5를 완화한다고 주장해서는 안 된다.

### 4.4 schema v2

결정 1의 `remainder`와 결정 3의 3필드는 모두 `extra="forbid"` 스키마에 새 키를 넣는다. 따라서 **schema bump가 필요하다.** 태스크 문구대로 이는 별도 승인 사항이며, 이 문서는 승인을 요청할 뿐 수행하지 않는다.

승인 시 형태:

- `schema_version == 1` → `remainder` 키가 **없어야** 한다(`extra="forbid"`가 이미 보장).
- `schema_version == 2` → `remainder` 허용, 기본값 `[]`.
- 광고는 `{"schema_versions": [1, 2]}`로 확장한다([routes.py:199](../backend/app/api/routes.py)의 현재 `[1]`).

`schema_version`을 `Literal[2]`로 올리는 안은 채택하지 않는다. v1 스냅샷 재제출이 422가 되고, 그것은 §2.2의 위험을 스스로 만드는 일이다.



## 5. 결정 4 — 어휘 판정: 합치는 위치와 77토큰

### 결정 4 요약

`draft_prompt`에 번역문을 **합치지 않는다.** 최종 프롬프트는 `applyDraft` 한 곳에서만 `draft` + `\n` + 수락된 번역문으로 만든다. sd15 77은 문자 수가 아니라 **토큰** 예산이므로, 번역문을 포함한 최종 프롬프트에 같은 `estimateTokens`를 다시 호출해 경고를 계산한다.

### 5.1 위치: `draft_prompt`에 합치지 않는다

태스크 문구는 "`draft_prompt`에 번역문을 합칠 위치"를 결정하라고 한다. **합치지 않는 것이 결정이다.**

현재 구조에서 `state.result.draft`는 컴파일러 산출물이고, **최종 프롬프트에 실제로 쓰이는 문자열은 `state.result.draft`가 아니라 컴포넌트 밖의 `value` prop**이다. `applyDraft`가 `onChange(state.result.draft)`로 그 prop을 바꾼다([PromptBuilder.tsx:356-367](../frontend/src/components/PromptBuilder.tsx)). 즉 조립 지점은 이미 하나뿐이고, 그 지점에서 번역문을 더하면 된다.

`draftComposition`이 저장하는 `draft_prompt`는 `state.result.draft`다([builderState.ts:36](../frontend/src/prompt/builderState.ts)). 여기에 번역문을 합치면:

- `draft_prompt`가 더 이상 `compileScene`의 출력이 아니게 되어 §4.2의 `compiler_version` 분리가 무너진다.
- `restoreComposition`이 `draft_prompt`를 초안으로 복원하므로([builderState.ts:68-70](../frontend/src/prompt/builderState.ts)), 번역문이 컴파일러 초안으로 둔갑한다.
- 재생성 시 번역문이 중복될 위험이 생긴다.

**결정: 번역문은 `remainder`에만 존재하고, 최종 프롬프트는 `applyDraft` 한 곳에서 `draft` + `\n` + 수락된 번역문들로 만든다.**

### 5.2 구분자: 개행(`\n`)

- `, ` 는 sd15에서 "한 구절"로 읽히므로, 원문과 다른 출처의 문장이 섞이면 사용자가 의미를 오해한다.
- `; ` 는 `naturalLanguageFamilies`가 이미 쓰는 구분자다([compiler.ts:129](../frontend/src/prompt/compiler.ts)). 번역문에도 `; `를 쓰면 "컴파일러가 만든 문장 구분"과 "사용자가 덧붙인 문장"이 구별되지 않는다.
- `\n`은 이미 `verbatim` 모드가 쓰는 방식이다. `withGeneratedDraft`가 `verbatim`일 때 `${result.draft}\n${raw}`로 합친다([builderState.ts:23-24](../frontend/src/prompt/builderState.ts)). **같은 선례를 재사용한다.**

순서는 `draft` 먼저, 수락된 번역문을 `remainder` 배열 순서대로 뒤에 붙인다. 사용자가 카드를 수락한 순서가 곧 `remainder` 순서이므로 화면에서 본 순서와 최종 프롬프트의 순서가 일치한다.

### 5.3 77토큰 경고는 최종 프롬프트로 다시 계산한다

`SD15_TOKEN_WINDOW = 77`은 **문자 수가 아니라 토큰 예산**이다([compiler.ts:9](../frontend/src/prompt/compiler.ts)). 계산은 `estimateTokens`가 공백·쉼표·세미콜론으로 나눈 단어 수 × 1.3으로 근사하고([compiler.ts:76-78](../frontend/src/prompt/compiler.ts)), `scene.targetFamily === "sd15"`일 때만 경고한다([compiler.ts:140-145](../frontend/src/prompt/compiler.ts)). 즉 77은 "77자"가 아니고, 판정 대상은 **최종 프롬프트 문자열**이다. 번역문은 영어이므로 이 계산에 그대로 포함된다.

따라서:

1. `compileScene`의 경고 계산은 **바꾸지 않는다.** 컴파일러는 컴파일러 산출물만 판정한다.
2. 번역문을 포함한 최종 프롬프트에 대해서는 **같은 `estimateTokens` 함수를 다시 호출**해 경고를 별도로 만든다. 새 추정식을 만들지 않는다(숫자가 두 개가 되면 하나는 반드시 틀린다).
3. 새 경고 코드를 만들지 않고 기존 `token_budget`을 재사용한다. `explainWarning`의 기존 분기([proposals.ts:238](../frontend/src/prompt/proposals.ts))를 확장하되, 문구는 "번역 제안을 포함한 최종 프롬프트가 SD 1.5 텍스트 창을 넘을 수 있습니다"로 구분한다.

**"번역문 때문에 새로 발생하는 경우"의 표시**: 번역문 없이는 77 이하이고 포함하면 77을 넘는 경우, 이것은 **포함 선택의 결과**이므로 포함 버튼 옆에 미리 표시한다(수락 후가 아니라 수락 전). 이미 77을 넘던 초안에 번역문을 더하는 경우는 새 경고를 만들지 않는다 — 이미 경고가 있고 원인은 번역문이 아니다.

이 사전 표시는 TRANS04의 "포함 시 결과가 '사전 초안 + 사용자가 고른 번역문'임을 적용 전에 명시한다"와 같은 요구를 만족한다.

## 6. 기존 필드로 대체 가능한가 — 대안 검토

| 대안 | 가능성 | 판정 |
| --- | --- | --- |
| `free_text_ko`에 번역문을 덮어쓴다 | 불가 | 원칙 2 위반. 원문 불변은 타협 불가다. |
| `draft_prompt`에 번역문을 미리 합쳐 저장 | 불가 | §5.1. `compiler_version` 분리가 깨지고 재생성 시 중복된다. |
| `unresolved` 항목에 `suggested_en` 추가 | 불가 | §2.3. 재생성으로 소실되고 서버가 8개로 자른다. |
| `selections`에 가짜 항목으로 넣는다 | 불가 | 설계 금지선. 사전 밖 표현은 끝까지 사전 밖으로 식별 가능해야 한다. |
| **현행 유지(새 필드 없음)** | 가능 | 사용자는 번역 제안을 볼 수 있지만 **최종 프롬프트에 넣을 수 없다.** 이 경우 TRANS03–05를 취소하고 TRANS02만 남긴다. |
| 최종 프롬프트 문자열만 늘리고 구성에는 기록하지 않는다 | 부분 가능 | 저장 스냅샷이 최종 프롬프트와 어긋나고 원칙 7을 위반한다. 재현성 없음. |

**"현행 유지"가 유일하게 안전한 대안이다.** 이것이 schema bump를 승인하지 않을 때의 경로이며, 기능을 포기하는 대신 계약을 하나도 건드리지 않는다. TRANS05의 조건부 문구("`PromptComposition`에 필드가 실제로 추가된 경우에만 착수")가 이 경로를 이미 전제하고 있다.

## 7. 소유권 — DATA01/DATA02와 중복 방지

| 항목 | 소유 ID | 이유 |
| --- | --- | --- |
| `remainder` 필드의 존재·형태·한도 | **TRANS01** (구현은 TRANS03) | 번역 제안 고유의 필드다. |
| `proposal_id`·`proposal_model`·`accepted_at`을 `remainder` 항목에 두는 결정 | **TRANS01** | 원칙 7의 적용 형태를 이 필드에 대해 확정한 것. |
| schema v2 채택 여부와 버전 협상 규칙 | **TRANS01** (승인) / **DATA02** (전반 전략) | TRANS01은 "이 필드 때문에 v2가 필요한가"만 판정했다. 일반적인 v1 확장·v2·현행 유지 전략과 rollback·migration 계획은 DATA02가 소유한다. |
| 저장/미저장 표, provenance 일반 서술 | **DATA01** | TRANS01은 `remainder` 3필드에 대해서만 §4.3에서 저장/미저장을 정했다. 전체 스냅샷 표는 DATA01. |
| 새 `kind`(`remainder_translation`)와 요청 필드 `remainder_spans` | **TRANS03** | TRANS01은 "오프셋으로 보낸다"는 제약만 정했다. 응답 스키마·검증은 TRANS03. |
| `applyDraft`의 결합 지점, 개행 구분자, 77토큰 재계산 | **TRANS04** (구현) / TRANS01 (결정) | §5가 결정이고 구현은 TRANS04. |
| 32 KiB 재측정, 왕복·구이력 회귀 | **TRANS05** | TRANS01은 현재 값을 측정만 했다. |

**TRANS01이 DATA02를 선점하지 않는다.** 이 문서는 "이 필드 하나 때문에 v2가 필요하다"는 사실만 확정했고, schema 버전 전략 전체를 결정하지 않았다. DATA02가 다른 이유로 v2를 택하거나 v1 확장을 택하면, `remainder`는 그 결정에 종속된다.

## 8. 승인 요청과 거절 시 동작

### 승인 요청 (한 건)

> **schema v2를 채택하고, `PromptComposition`에 `remainder`(최대 8개, 항목당 `source_ko` 200자 + `suggested_en` 200자 + 출처 3필드)를 추가한다. 서버는 v1과 v2를 동시에 받고 `schema_versions: [1, 2]`를 광고한다.**

### 승인 시 다음 작업

> **2026-11-19 이행 완료.** 아래 1–4는 모두 수행됐다. 구현 결과는 [단일 실행 태스크](PROMPT_COMPOSER_EXECUTION_TASKS.md)의 TRANS02–TRANS05 인계에 있다.

1. TRANS02(클라이언트 순수 계산)를 먼저 또는 병행 수행 — 서버·계약과 무관하므로 승인을 기다리지 않아도 된다.
2. TRANS03은 §3.2의 오프셋 요청과 §4.4의 판별 모델을 구현한다.
3. TRANS04는 §5의 결합 지점과 사전 표시를 구현한다.
4. TRANS05는 32 KiB 재측정과 왕복 회귀를 수행한다.

### 거절 시 다음 작업

1. TRANS02만 수행하고 종료한다. 이 태스크는 "어느 부분이 사전 밖인지"를 화면에 보여주는 것까지이며, 그것 자체로 실측 사례(미커버 85.7%)의 가시성을 해결한다.
2. TRANS03–05는 "현행 유지"로 종료하고, 활성 태스크 문서에 그 사실을 기록한다.
3. TRANS01의 이 문서는 삭제하지 않는다. 나중에 같은 질문이 다시 나올 때 측정값과 판정 근거가 재사용되어야 한다.

## 9. 재현 명령

이 문서의 모든 수치는 아래 **자족 스크립트**로 재측정한다. 스크립트를 저장소 밖 임시 파일(예: `/tmp/trans01_measure.py`)에 저장하고 실행한다. 저장소에 커밋하지 않는다 — 이 문서의 표가 정본이고 스크립트는 재현 수단이다.

```python
import json, sys
sys.path.insert(0, "/Users/monoless/Works/bc250-imagegen/backend")
from app.models.schemas import PromptComposition

CAP = 32768
def size(v):
    return len(json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

def snap(selections=20, free_chars=4000, draft_chars=2000, spans=(200, 200, 200), remainder=()):
    return {
        "schema_version": 1, "compiler_version": "1.3.0", "target_family": "sd15",
        "selections": [{"id": f"appearance.item_{i:03d}", "category": "appearance",
                        "label_ko": "금발", "dictionary_version": "2026.11.18-1",
                        "mapping_status": "mapped" if i % 5 else "unavailable",
                        "rendered": "blonde hair" if i % 5 else None} for i in range(selections)],
        "free_text_ko": "비" * free_chars, "draft_prompt": "x" * draft_chars,
        "unresolved": [{"kind": "free_text", "id": None, "text": "가" * n} for n in spans],
        **({"remainder": list(remainder)} if remainder else {}),
    }

def item(provenance=False):
    it = {"source_ko": "가" * 200, "suggested_en": "x" * 200}
    if provenance:
        it.update({"proposal_id": "prop-" + "a" * 18, "proposal_model": "z-image-llm-small",
                   "accepted_at": "2026-11-19T06:39:30Z"})
    return it

# §1.1 rows
for label, kw in [("20sel/4000ko/2000draft/3spans", {}),
                  ("0sel/4000ko/8000draft/3spans", dict(selections=0, draft_chars=8000)),
                  ("100sel/1000ko/2000draft/1span", dict(selections=100, free_chars=1000, spans=(200,)))]:
    print(label, size(snap(**kw)))
print("20sel + 8 remainder + provenance:", size(snap(remainder=[item(True) for _ in range(8)])))
print("100sel + 8 remainder + provenance:",
      size(snap(selections=100, free_chars=1000, spans=(200,),
                remainder=[item(True) for _ in range(8)])))
print("100sel/4000ko/8000draft (already over):",
      size(snap(selections=100, free_chars=4000, draft_chars=8000, spans=(200, 4000))))

# §1.1 / §2.2: v1 rejects the new key
try:
    PromptComposition.model_validate(snap(remainder=[item()]))
    print("v1 accepts remainder: YES")
except Exception as e:
    print("v1 accepts remainder: NO ->", "extra_forbidden" in str(e))
```

요청 쪽(§1.3)은 같은 방식으로 `app.services.prompt_proposals.ProposalRequest`의 필드를 흉내 낸 dict를 `size()`로 재면 된다. 핵심 비교는 **`free_text_ko`에 구절 원문을 넣은 경우 vs `{start, end}` 오프셋만 넣은 경우**이며, 200자 한글 구절 611.9 B 대 오프셋 쌍 27.5 B(33배)가 그 결과다.


## 10. 검증 상태

| 항목 | 상태 |
| --- | --- |
| v1 스키마의 `extra_forbidden` 거부 | **실측 확인** · 구현 후에도 유지(테스트 고정) |
| 구성 32 KiB 예산과 `remainder` 기여분 | **실측 확인** · `test_remainder_fits_the_measured_budget`이 실모델로 재계산 |
| 요청 8 KiB 포화와 오프셋 우위 | **실측 확인** · TRANS03이 오프셋 요청으로 구현 |
| 응답 16 KiB 여유 | **실측 확인** |
| 77이 토큰 예산임 | **코드 확인** (`SD15_TOKEN_WINDOW`, `estimateTokens`) |
| 실제 LLM 번역 품질 | **미검증** — QUALITY/LIVE 계열 소관 |
| 브라우저 화면 동작 | **미검증** — TRANS04가 구현했으나 실제 브라우저 관찰은 U11/AT01 소관 |
| schema v2 채택 | **승인·구현 완료(2026-11-19)** — TRANS03–05 |

이 문서는 작성 시점에 코드·스키마·테스트를 수정하지 않았다. §9의 스크립트는 `/tmp`에만 있고 저장소 상태에 영향이 없다. 2026-11-19의 구현은 별도 태스크(TRANS03–05)에서 이뤄졌다.

