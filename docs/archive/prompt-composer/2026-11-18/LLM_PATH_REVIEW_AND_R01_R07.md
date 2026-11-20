# LLM 제안 경로 리뷰와 선행 정합성 태스크 (LLM-R01–R07)

> 2026-11-18 보관본. 활성 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다. 완료 표시는 당시 로컬 검증 범위에 한정하며 실제 LLM·GPU 품질 검증을 뜻하지 않는다.

이 파일은 활성 문서의 §0 전체를 **내용 변경 없이** 옮긴 것이다: 리뷰 판정, 확인된 파이프라인, 유지할 강점, 결함↔태스크 매핑, LLM-R01–R07 명세와 구현 인계, 문서 반영 범위. R01–R07의 계약 서술 정본은 이 보관본이며, 활성 문서는 태스크 상태만 관리한다.

리뷰 목적은 LIVE02에서 "모델이 틀렸다"와 "서버·요청이 틀렸다"를 구분할 수 있게 만드는 것이었다. R01–R07 구현·로컬 검증으로 그 전제조건 5건(R01–R05)이 충족됐다.

---

## 0. LLM 경로 구조 리뷰와 선행 정합성 태스크 (2026-11-18)

읽기 전용 리뷰 결과다. 제품 코드를 읽고 확인한 사실만 적었고, 모델 응답 품질은 여전히 미측정이다. **목적은 LIVE02에서 "모델이 틀렸다"와 "서버·요청이 틀렸다"를 구분할 수 있게 만드는 것**이다.

### 확인된 파이프라인

```text
원문(한국어) ─┬─→ [규칙 경로·오프라인] proposals.ts + matching.ts → SelectionHint → 사용자가 수락
              └─→ [LLM 경로·서버] POST /api/v1/prompt/proposals → provider → gate /v1/chat/completions
                       → parse_reply → validate_reply → fit_budget → cards → 사용자가 수락
최종 prompt = compileScene() 이 사전 mappings 에서만 조립 (compiler.ts:81)
```

### 유지할 강점 (변경 금지)

| 성질 | 근거 |
| --- | --- |
| LLM은 id만 고르고 문장은 컴파일러만 만든다 | `prompt_proposals.py:8`, `compiler.ts:81`. 모델이 문장을 창작할 경로 없음 |
| 사전이 유일한 id 권위 | `_dictionary_listing`(`proposal_provider.py:126`)이 화이트리스트를 프롬프트에 넣고 `validate_reply`가 재검증 |
| 2중 검증(서버+클라이언트) | `prompt_proposals.py:412-455` ↔ `proposalCards.ts:128-150`. 스텁·구버전 서버 방어 |
| revision 지문으로 stale 차단 | `llmProposals.ts:160-171` |
| 실패가 5xx가 아니라 200+문장 | `proposals.py:107-129` |
| GPU 상태를 읽기만 함 | `proposal_provider.py:100-111` |
| prefix 캐시 친화 payload | 고정부(system)·가변부(user) 분리 |
| 사전 mirror drift 테스트 | `test_proposal_api.py:311-333` |

### 결함과 태스크 매핑

| # | 결함 | 실측 근거 | 태스크 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | 서버 부정 가드가 규칙 경로보다 약함 | `_negated_in_source`는 `없다/없음/없는` 미탐지·절 경계 무시. `사람은 없다`→affirmed, `사람. 안경 없이 걷는다`→negated | **LLM-R01** | 완료 |
| 2 | 카탈로그가 id+category만 보냄 | 라벨 100·별칭 122개가 모델에게 전달되지 않음. 실측 2,939B(id만) → 5,733B(라벨+별칭) | **LLM-R02** | 완료(5,717B) |
| 3 | `partial_change`가 현재 선택을 안 보냄 | `build_payload`(`proposal_provider.py:196-243`)에서 `selections`는 variant 분기에만 존재 | **LLM-R03** | 완료 |
| 4 | 요청 크기 단위 불일치 | 클라 4,000자(`llmProposals.ts:123,218`) vs 서버 8,192바이트(`proposals.py:199`). 실측 2,592자에서 8,194B | **LLM-R04** | 완료(잔여 위험 있음) |
| 5 | `finish_reason`이 모델 자기신고 | `provider.finish_reason`은 모델이 JSON에 써넣는 값(`prompt_proposals.py:176,491`). 봉투 값은 `reply_bytes`가 버림 | **LLM-R05** | 완료 |
| 6 | `target_groups` 어휘가 사전과 미검증 | 카탈로그는 `action`/`location`, 요청은 `pose`/`setting`. `DISPLAY_GROUP`(`:67`)이 런타임에만 흡수 | **LLM-R06** | 완료(422 거절) |
| 7 | `active` 플래그의 단일 소스 없음 | `dictionary.ts:126,134` 하드코딩, mirror는 테스트가 정규식으로 생성. `inactive_entry` 분기가 도달 불가 | **LLM-R07** | 완료(생성 스크립트) |

추가로 기록만 남기는 사실:

- 규칙이 두 벌씩 존재한다(부정 `matching.ts:43` ↔ `prompt_proposals.py:62`, 잠금/범위 `prompt_proposals.py:412` ↔ `proposalCards.ts:128`, 그룹 `presentation.ts:8` ↔ `prompt_proposals.py:67`, 충돌 `compiler.ts:29`는 클라이언트만). 2중 검증 자체는 의도된 설계이므로 삭제하지 않되, **정본/사본 관계를 코드 주석에 명시**한다(R01·R05에서 함께).
- 현재 fixture 화면은 `engine == "fake"`면 제안 버튼이 없다(`proposal_provider.py:77-83`). 따라서 precision 100%·미분류 3.3%는 **규칙 엔진 단일 경로** 수치이며 LLM 품질 지표가 아니다.

### LLM-R01 — 서버 부정 가드를 규칙 경로와 동등하게 · 완료 (2026-11-18)

- 선행: 없음. 연결: RULE01(구현 완료). **LIVE02의 선행.**
- 근거: `matching.ts:42-47`은 어간 `없/아니/않/빼고/제외/말고/금지` + `CLAUSE_BREAK`(`:47`)로 절 경계에서 멈춘다. 서버 `prompt_proposals.py:62-65`는 `없이/아닌/아님/아니/않/안 /못 /말고/빼고/제외`에 `MATCH_AFTER_WINDOW = 8` 고정 창을 쓴다. 그래서 (a) `사람은 없다`는 서버가 affirmed로 통과시키고, (b) `사람. 안경 없이 걷는다`는 다음 절 표지가 앞 절 명사를 오염시켜 정상 제안을 `polarity_conflict`로 보류한다. 둘 다 실행으로 확인했다.
- 수정: `backend/app/services/prompt_proposals.py`의 `NEGATION_MARKERS`/`_negated_in_source`를 규칙 경로와 같은 의미로 맞춘다. 어간 `없` 추가, 절 경계(`[.!?,、。·\n]`)에서 창을 자른다. `backend/tests/test_prompt_proposals.py`에 양성/부정/혼합/절 경계 케이스를 추가한다.
- 금지: 규칙 경로(`matching.ts`)의 문구·동작 변경. 두 경로를 한 코드로 합치는 리팩터링(언어가 다르므로 범위 밖).
- 완료: 아래 케이스가 서버에서도 규칙 경로와 같은 판정을 낸다. `사람은 없다`→held, `없는 사람`→held, `사람은 없고 고양이는 있다`→사람만 held, `사람. 안경 없이 걷는다`→사람 affirmed·안경 held, `안경 없이 짧은 머리의 사람`→짧은 머리 affirmed(기존 테스트 유지). P 및 S 통과.
- 주의: 이 가드는 어휘 휴리스틱이지 의미 이해가 아니다. 완료 후에도 `글자 없이` 같은 사례를 "해결됨"으로 일반화하지 않는다.
- **구현 인계 (2026-11-18)**: `MATCH_AFTER_WINDOW` 삭제, `CLAUSE_BREAK`까지의 창 + "가장 가까운 표지가 이긴다"로 통일. `NEGATION_MARKERS`에 `없` 추가. 테스트 3건 추가: `test_negation_guard_keeps_a_positive_half_of_a_mixed_clause`, `test_negation_guard_survives_an_affirmation_before_the_negation`, `test_server_negation_stems_match_the_rule_engine_source`(matching.ts에서 어간 목록을 정규식으로 뽑아 서버 상수와 직접 비교 — 서버 목록이 사본이므로 드리프트가 실패로 드러난다). 기존 `test_negation_guard_stops_at_the_clause_boundary`·`test_negation_guard_reads_the_marker_stem_not_one_inflection`는 그대로 통과. **L 106건·F 133건 통과.**

### LLM-R02 — 모델 카탈로그에 라벨·별칭 제공 · 완료 (2026-11-18)

- 선행: LLM-R01. 연결: RULE03(사전 alias 보강)과 같은 데이터를 쓰므로 순서를 붙여 수행. **LIVE02의 선행.**
- 근거: `_dictionary_listing`(`proposal_provider.py:126-139`)은 `- setting.cafe (setting)`만 보낸다. 사전에는 라벨 100개·별칭 122개가 있고(`dictionary.ts`), 모델은 한국어 원문과 id 사이의 어휘적 다리를 하나도 받지 못한다. 실측 크기: id만 2,939B, id+라벨 4,077B, id+라벨+별칭 5,733B. 8 KiB 상한은 **브라우저→서버 본문**에만 적용되고 시스템 프롬프트는 포함되지 않으므로(`proposal_provider.py:52-54`) 이 증가는 요청 상한과 무관하다.
- 수정: `config/prompt_dictionary.json`과 `prompt_dictionary.py`의 `DictionaryEntryRef`에 `label_ko`, `aliases`를 추가하고(렌더 표현이 아니라 **검색용 한국어 어휘**임을 docstring에 명시), `_dictionary_listing`이 `- <id> (<display_group>) <label_ko> | <alias> | ...` 형식으로 출력하게 한다. `prompt_dictionary.py`의 "Python은 렌더 표현을 갖지 않는다" 원칙은 유지한다: label/alias는 최종 prompt에 들어가지 않고 모델 입력으로만 쓰인다.
- 완료: payload 단위 테스트로 카탈로그에 라벨·별칭이 포함되고 id 집합은 불변임을 확인. mirror drift 테스트(`test_proposal_api.py:311`)가 새 필드까지 검증. 토큰·바이트 증가량을 인계에 실측 기록. P·S 통과.
- 금지: 최종 prompt 문자열에 label/alias가 섞이는 변경. `compileScene` 출력 의미 변경.
- **구현 인계 (2026-11-18)**: `DictionaryEntryRef`에 `label_ko`/`aliases` 추가(렌더 표현 아님을 docstring에 명시), mirror에 두 필드 생성, `_dictionary_listing`이 `- <id> (<display_group>) <label_ko> | <alias> ...` 출력. 실측 **렌더된 카탈로그 5,717B / 100항목**(수정 전 id+category 2,939B, 리뷰 추정 5,733B와 16B 차이는 표시 그룹·구분자 형식 때문). JSON mirror 파일 자체는 12,063B이지만 그 파일은 모델에 전송되지 않는다. 시스템 프롬프트는 8 KiB 본문 상한 밖이므로 요청 크기 영향 없음. 테스트 3건: 라벨·별칭 포함/무별칭 처리/비활성 미노출, id 집합 불변, 크기 범위(4–9 KB)와 렌더 표현 미포함.

### LLM-R03 — `partial_change`에 현재 선택 전달 · 완료 (2026-11-18)

- 선행: LLM-R02(같은 payload 함수를 고치므로 순차). **LIVE02의 선행.**
- 근거: `build_payload`(`proposal_provider.py:196-243`)에서 `selections`는 `VARIANT_KIND` 분기에만 있다. 그래서 `조명만 변경`에서 모델은 "지금 조명이 `lighting.low_key`"임을 모르고, 이미 고른 값을 다시 제안하거나(서버가 조용히 무시, `prompt_proposals.py:425`) `compiler.ts:29`의 충돌 쌍에 걸리는 값을 제안해 카드가 차단된다. 모델이 틀린 게 아니라 정보를 받지 못한 것이다.
- 수정: `partial_change` 요청에도 `selections`(id+category)와 `locked_ids`를 함께 넣는다. 시스템 프롬프트 규칙에 "이미 선택된 id는 제안하지 않는다. `locked_ids`는 바꿀 수 없다"를 명시한다. 요청 크기 영향은 LLM-R04와 함께 측정한다.
- 완료: payload 단위 테스트로 `partial_change`에 `selections`가 실림. 100개 선택 시 최악 바이트를 측정해 8 KiB 이내임을 인계에 기록(초과하면 상한 조정을 별도 보고). P·S 통과.
- 금지: 서버 검증 규칙(잠금·범위·중복) 완화.
- **구현 인계 (2026-11-18)**: `build_payload`가 모든 kind에 `selections`를 싣고, 비-variant 시스템 프롬프트에 "이미 `selections`에 있는 id 제안 금지 / `locked_ids` 변경 금지 / `target_groups` 밖 제안 금지" 3규칙을 명시. variant 프롬프트에도 `removed_ids`는 `selections`에 있어야 함을 명시. **중요**: 클라이언트는 이미 `proposalBody`에서 `selections`를 보내고 있었으므로 **요청 본문 바이트는 증가하지 않는다**(서버가 payload 복사만 안 했음). 따라서 완료 조건의 "100개 선택 최악 바이트"는 R04의 몫이며, 여기서는 "payload가 요청 필드를 그대로 복사하고 새 필드를 추가하지 않음"을 검증했다(C01 payload 계약 테스트를 의도적으로 확장).

### LLM-R04 — 요청 크기 상한의 단위 정합 · 완료 (2026-11-18)

- 선행: 없음(작음). LLM-R03과 바이트 계산이 겹치므로 함께 수행 권장.
- 근거: `MAX_FREE_TEXT = 4000`은 문자 수이고 주석은 "서버 상한을 그대로 반영해 422를 피한다"고 하지만, 서버는 `len(raw) > 8192` **바이트**로 413을 낸다(`proposals.py:199`, `proposal_provider.py:372`). 실측: 요청 본문이 8 KiB를 넘는 첫 한글 문자 수는 **2,592자**(8,194B), 4,000자는 12,418B. 즉 2,592–4,000자 구간은 로컬 검사를 통과한 뒤 413을 받는다.
- 수정: `llmProposals.ts`의 로컬 검사를 `new TextEncoder().encode(text).length > MAX_FREE_TEXT_BYTES`로 바꾸고 상수를 바이트 의미로 개명한다. 주석을 실제 계약과 일치시킨다.
- 완료: 한글 2,600자·4,000자·영문 4,000자의 `proposalBody` 결과가 서버 상한과 일치함을 프론트 단위 테스트로 확인. 413을 유발하는 로컬 통과 케이스가 0건임을 기록. F·B 통과.
- 주의: 서버 상한(8 KiB)을 올리지 않는다. 클라이언트를 서버에 맞추는 작업이다.
- **구현 인계 (2026-11-18)**: `MAX_FREE_TEXT`는 문자 상한으로 남기고(텍스트 영역 계약), `proposalBody`가 **완성된 body 전체**를 `TextEncoder`로 인코딩해 `MAX_REQUEST_BYTES = 8*1024`와 비교한다. 새 테스트 2건: `the request body is refused by its real UTF-8 byte size, not its character count`(한글 4,000자=12,000B 거부·영문 4,000자 통과·영문 9,000자 거부), `a legal but crowded body is refused locally instead of coming back as a 413`(`selections`+`locked_ids`가 예산을 소모하는 케이스: 60+60+한글 1,500자 거부, 5+5+한글 100자 통과). **실측(실제 mirror + 실제 `proposalBody`, 2026-11-18)**: 8 KiB에서 남는 한글 여유는 선택 1개+범위 없음 **2,582자**, 20 선택+20 잠금 **2,144자**, 60+60 **1,224자**, 100+0 **1,017자**, 100 선택+100 잠금 **361자**. 서버 상한은 올리지 않았다. 이 여유 부족은 R04의 범위를 넘으므로 **잔여 위험**으로 남긴다: 대부분의 실제 요청은 선택 수가 적어 문제없지만, 대량 선택+긴 서술 조합은 로컬에서 `too_large`로 거절된다.

### LLM-R05 — `finish_reason`·`model`을 서버 관측값으로 · 완료 (2026-11-18)

- 선행: LLM-R01(같은 모듈). **LIVE02 증거 신뢰성의 전제.**
- 근거: `provider.finish_reason`과 `provider.model`은 **모델이 JSON 안에 써넣는 값**이다(`prompt_proposals.py:176`, `proposal_provider.py:154,221` 스키마가 문자열로 지시). 실제 HTTP 봉투의 `choices[0].finish_reason`과 `model`은 `reply_bytes`(`proposal_provider.py:256-268`)가 버린다. 그래서 `prompt_proposals.py:491`의 검사는 사실상 "모델이 stop이라고 말했는가"이며, LIVE02가 남겨야 할 alias·버전 증거를 모델이 우길 수 있다.
- 수정: `reply_bytes`가 `(content, envelope_model, envelope_finish_reason)`을 돌려주게 하고, 서버가 이 값으로 `provider`를 덮어쓴다. 모델 자기신고 값은 진단 필드로만 남기거나 버린다. `finish_reason`이 `stop`이 아니면 기존 `incomplete_reply` 경로를 그대로 탄다.
- 완료: 봉투가 `length`인데 본문이 `stop`인 응답이 `unavailable`이 됨을 단위 테스트로 확인. 봉투 `model`과 본문 `model`이 다를 때 서버 값이 이김을 확인. 기존 C01-8 테스트 유지. P·S 통과.
- 주의: 품질 개선이 아니라 **증거 정확성** 작업이다.
- **구현 인계 (2026-11-18)**: `reply_bytes` → `reply_envelope(body) -> (content, ObservedProvider(model, finish_reason))`. `FINISH_REASONS`로 닫힌 집합 매핑, 미지의 값은 `other`(clean stop 아님). `evaluate(..., observed=)`가 `provider`를 덮어쓴 뒤 기존 `incomplete_reply` 경로를 탄다. **실패 봉투에도 `provider`를 싣도록 `unavailable()`을 확장**했다 — 거절된 응답에서야말로 "어느 모델이 왜 잘렸는지"가 유일한 증거다. 테스트: 봉투 `length` + 본문 `stop` → `unavailable`, API 레벨에서 봉투 `model`이 본문 자기신고를 이김. 기존 픽스처 `chat()`/`chat_response()`에 `finish_reason`/`model` 인자를 추가해 **봉투가 정본**임을 테스트가 드러내게 했다.

### LLM-R06 — `target_groups` 어휘를 사전 카테고리와 대조 · 완료 (2026-11-18)

- 선행: LLM-R02. 연결: LIVE01의 payload 점검 항목을 구현으로 승격.
- 근거: 카탈로그는 legacy 카테고리(`action`, `location`, `composition`)를 찍고 요청은 표시 그룹(`pose`, `setting`, `camera`)을 쓴다. 서버는 `DISPLAY_GROUP`(`prompt_proposals.py:67`)으로 런타임 흡수만 하고, 요청의 그룹이 실제 사전에 존재하는지는 검증하지 않는다. `VARIANT_GROUPS = {pose, setting}`(`:52`)도 같은 혼동을 안고 있다.
- 수정: `DISPLAY_GROUP`에서 파생한 허용 그룹 집합을 만들고, 사전에 없는 그룹이 오면 요청 검증 단계에서 거절(권장)하거나 `unsupported_v1`로 답한다. 카탈로그 출력도 표시 그룹으로 통일한다(LLM-R02 형식과 일치).
- 완료: 사전 카테고리에서 그룹 집합을 파생하는 테스트, 알 수 없는 그룹 요청의 거절 테스트. 카탈로그와 `target_groups`가 같은 어휘를 씀을 payload 테스트로 확인. P·S 통과.
- 금지: `GROUP_ORDER`(`presentation.ts:8`)와 다른 그룹 이름을 서버가 새로 발명하는 것.
- **구현 인계 (2026-11-18)**: `display_group(category)`와 `groups_in_use(entries)`를 `prompt_proposals.py`에 추가(활성 항목에서 파생, 하드코딩 없음). `_dictionary_listing`과 variant/scope 판정이 모두 `display_group()`을 거치게 통일. 사전에 없는 그룹은 **`proposals.py` 요청 검증 단계에서 422**로 거절(모델 호출 전). `unsupported_v1` 대신 422를 택한 이유: 그룹 오타는 계약 위반이므로 200 실패 봉투로 감싸면 브라우저가 모델 문제로 표시한다. 테스트 2건: 그룹 파생/`display_group` 매핑, 알 수 없는 그룹 422 + 모델 미호출. 실측 허용 그룹: `appearance, camera, clothing, expression, lighting, mood, pose, setting, style, subject`.

### LLM-R07 — `active`의 단일 소스와 mirror 생성 경로 · 완료 (2026-11-18)

- 선행: LLM-R02(같은 mirror 파일을 손댐).
- 근거: `dictionary.ts:126,134`가 `active: true`를 하드코딩하고, `config/prompt_dictionary.json`은 파생물인데 생성 스크립트가 없다. drift 테스트(`test_proposal_api.py:311-333`)가 TS 소스를 정규식으로 긁어 `active: True`를 만들어 비교한다. 결과적으로 `inactive_entry` 분기(`prompt_proposals.py:324,422`, `proposalCards.ts:136`)는 현재 사전에서 도달 불가다.
- 수정: mirror를 생성하는 스크립트(예: `scripts/gen-prompt-dictionary.mjs`)를 추가하고 drift 테스트가 그 스크립트를 쓰게 한다. 또는 "현재 사전은 전 항목 활성"을 계약으로 명시하고 `inactive_entry`를 문서상 미사용으로 표시한다. 둘 중 하나를 고르고 근거를 남긴다.
- 완료: 선택지 택1과 근거, drift 테스트가 생성 경로를 통과. `inactive_entry`가 도달 불가임을 문서 또는 테스트로 명시. F·P·S 통과.
- **구현 인계 (2026-11-18)**: 택1 채택 — 생성 스크립트 `scripts/gen-prompt-dictionary.mjs` 추가. `--stdout`으로 같은 텍스트를 출력하고, drift 테스트가 **그 스크립트를 실제 실행해** 커밋된 파일과 JSON 비교한다(테스트가 형식을 재구현해 스스로와 일치하는 일을 방지). 파일은 항목당 한 줄로 생성해 diff가 읽히게 했다. `active`는 `dictionary.ts`의 하드코딩 값에서 그대로 나오며, `test_every_dictionary_entry_is_active_so_inactive_entry_is_unreachable`가 "전 항목 활성 = `inactive_entry` 분기 도달 불가"를 계약으로 고정한다(비활성 항목이 생기면 그 테스트가 실패해 실제 비활성 경로 테스트를 요구). 실행: `node --experimental-strip-types scripts/gen-prompt-dictionary.mjs`.

### 문서 반영 범위

- 이 절과 LLM-R01–R07 명세가 리뷰 갱신의 산출물이다. 리뷰 시점에는 제품 코드·사전·테스트를 수정하지 않았다.
- **2026-11-18 구현 갱신**: 위 문장은 리뷰 시점의 상태다. 이후 R01–R07을 구현했으므로 제품 코드·사전 마이그레이션·테스트를 수정했다. 변경 파일: `backend/app/services/prompt_proposals.py`, `proposal_provider.py`, `prompt_dictionary.py`, `backend/app/api/proposals.py`, `frontend/src/prompt/llmProposals.ts`, `config/prompt_dictionary.json`, `scripts/gen-prompt-dictionary.mjs`(신규), 그리고 해당 테스트 4개 파일.
- CURRENT·LLM_AUTOMATION 문서는 이번 구현에서도 손대지 않았다. 두 문서는 계약 참고자료이고 계약은 이 문서 §0이 소유한다. 다만 LLM-R05가 `provider` 관측값의 의미를 바꿨으므로, LIVE02에서 응답 형식을 인용할 때는 이 문서가 아니라 실제 응답을 근거로 삼는다.
