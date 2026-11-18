# 사전 프롬프트 단일 실행 태스크

갱신일: 2026-11-18 · 기준 HEAD `b5efd2d` · **사전 프롬프트의 활성 상태·우선순위·완료 기준은 이 문서에서만 관리한다.** CURRENT는 구현 설명이고 P5/LLM 문서는 계약 참고자료다. 완료 작업은 [오늘의 archive](archive/prompt-composer/2026-11-18/README.md)로 이동했다.

> 2026-11-18 LLM 경로 리뷰(§0): LIVE01/LIVE02/EVAL-UX02를 실제 응답으로 진행하기 전에 고쳐야 할 정합성 결함 5건과 계약 정리 2건을 LLM-R01–R07로 등록했다. **LIVE02 측정은 LLM-R01·R02·R03·R04·R05 이후에 한다.** 그 전에 측정하면 "모델이 틀렸다"와 "서버/요청이 틀렸다"를 구분할 수 없다. → **2026-11-18: R01–R07 구현·로컬 검증 완료. LIVE02의 선행 조건이 충족됐다.**

## 현재 판정과 다음 작업

- UX01–UX05, VERIFY01/02, LLM-C01/C02, LLM-I01–I06, VAR01/02의 코드·로컬 시험 기록은 archive에 보존했다. 같은 구현을 재수행하지 않는다. 실제 LLM/GPU 운영 성공까지 완료라는 뜻은 아니다.
- EVAL-UX01은 **규칙/fixture 기준선 작성만 완료**다. 사용자 시간·의견과 실제 LLM 평가가 빠져 있어 전체 평가 완료 주장을 철회하고 EVAL-UX02/U11로 추적한다.
- **RULE01·RULE02·METRIC01은 구현·로컬 검증을 마쳤다**(아래 인계). 부정·다인 오탐 3건이 0건이 됐고, 규칙 제안 경로도 부분 변경 범위를 지키며, precision은 미분류를 분모에서 뺀 이름으로만 보고한다. 남은 갭은 활용형·별칭 누락(RULE03), 실제 LLM 미연결(LIVE01/02), 사전 밖 상황의 부분 반영 안내(VAR03)다.
- **2026-11-18 리뷰 판정: 경계 설계는 유지, 그 경계를 통과하는 정보와 두 경로의 판정 일관성에 결함이 있다.** LLM이 사전 ID만 고르고 컴파일러가 문장을 만드는 3단 구조는 옳으므로 되돌리지 않는다. 다만 ① 서버 부정 가드가 규칙 경로보다 약해(`없다` 미탐지·절 경계 무시) RULE01이 제거한 오탐이 LLM 경로로 되살아나고, ② 모델에게 ID·카테고리만 주어 한국어 라벨/별칭 122개를 쓰지 못하며, ③ `partial_change`가 현재 선택을 보내지 않아 맞힐 수 없는 요청을 하고 있다. 이 셋은 LIVE02 측정의 전제조건이다.
- **2026-11-18 갱신: LLM-R01–R07 구현·로컬 검증을 마쳤다**(각 태스크의 "구현 인계" 참조). 이제 LIVE02 측정의 전제조건 5건(R01–R05)이 충족됐다. 단 R04 실측에서 **대량 선택+긴 서술 조합은 8 KiB에서 로컬 거절**되는 잔여 위험이 확인됐다(요청 상한은 올리지 않음).
- 다음 코드 작업 순서: **RULE03 → VAR03 → U12**. 계약 정리 LLM-R06/R07은 완료. 별도 조사: **LIVE01 → LIVE02 → EVAL-UX02**. LIVE02는 실행 환경이 있어야 가능하며 불가하다고 다른 작업을 막지 않는다.
- U11은 사용자 의견 대기, U12는 필수 보완과 평가 범위 정리 후 종료한다. 캡처는 필수 아님. 실제 화면 관찰과 소스 기반 예상 묘사를 구분한다.
- Actions DEP 및 플랫폼 PLATFORM은 공통 의존 작업으로 후속 표에 유지한다. 사전 프롬프트의 운영 완료로 합산하지 않는다.

확정 계약 참조: [C01/C02와 VAR01 보관본](archive/prompt-composer/2026-11-18/PROMPT_COMPOSER_EXECUTION_TASKS.md). 현재 v1은 사전 ID만 선택으로 승격하고 번역/인물별 귀속/제안 이력 영속화는 지원하지 않는다. 큰 계약 변경은 DATA/SCENE 태스크에서 검토한다.

## 공통 실행 지시문

다음 블록의 ID만 바꿔 실행자에게 전달한다.

```text
이 저장소에서 docs/PROMPT_COMPOSER_EXECUTION_TASKS.md의 <태스크 ID> 하나를 수행한다.
먼저 git status --short, 해당 명세, 선행 태스크 인계 기록, 수정 대상 소스를 읽는다.
기준 커밋 이후 변경과 사용자 작업을 보존하고 현재 코드에 맞춰 수행한다.
선행의 필수 구현·계약이 미완료면 의존 작업을 구현하지 않는다. 캡처/시각 검증만 대기인 경우 아래 인계 규칙에 따라 독립 구현을 진행할 수 있다.
허용 파일과 완료 기준 안에서 작업한다. 더 넓은 변경이 필요하면 이유와 대안을 먼저 보고한다.
Scene v1/API/저장 데이터/컴파일 출력 의미, 직접 생성, applied 이력, retry를 유지한다.
테스트·브라우저·운영·GPU 검증을 구분한다. 미실행을 통과로 기록하지 않는다.
작업이 끝나면 이 문서의 해당 상태와 인계 기록만 갱신하고 다음 태스크까지 임의로 진행하지 않는다.
커밋·push·배포·외부 메시지·모델 다운로드·GPU 실행은 이 작업 배정만으로 수행하지 않는다.
```

- 상태: `대기 → 진행 → 구현 완료/검증 대기 → 완료`. 환경이 없으면 `환경 대기`, 계약 결정이 필요하면 `검토 대기`로 기록한다.
- UI 태스크는 가능한 한 한 가지 사용자 행동과 1–3개 소스 파일로 제한한다. 복잡한 상태·API·배포 판단을 모델이 추정으로 메우지 않는다.
- 같은 `PromptBuilder.tsx`, `styles.css`, `App.tsx`를 수정하는 작업은 순차 수행한다. 병렬 실행이 필요하면 별도 요청과 파일 소유권을 먼저 정한다.
- 새 UI 라이브러리/토크나이저/브라우저 도구 설치, schema bump, 서버 저장 의미 변경은 이 계획에 포함하지 않는다. 필요한 의존성·계약 변경은 별도 검토한다.
- archive는 과거 증거다. 수정해서 현재 성공을 만들어내지 않는다.

## 검증 명령과 인계

| 코드 | 실행 | 용도 |
| --- | --- | --- |
| F | `node --experimental-strip-types --test frontend/tests/*.test.mjs` | 프론트 133건 기준(2026-11-18 R04·R07 반영). 데이터·컴파일러·P5·규칙 제안·매칭 helper·LLM 제안 상태 회귀. Python/Pydantic 교차 검증 의존성 필요 |
| B | `npm --prefix frontend run build` 및 `npm --prefix frontend run lint` | TS·번들·정적 검사 |
| S | `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh` | Studio 131건 기준. 전체 저장소 pytest와 구분 |
| P | `.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_coordination_capability.py -q` | 구성 저장과 capability 회귀 |
| L | `.venv/bin/python -m pytest backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q` | §0 태스크(LLM-R01–R07)의 계약·payload·validator 회귀. 2026-11-18 R01–R07 구현 후 **106건 통과** |
| D | `git diff --check` | 변경 형식 검사 |

기존 건수는 기준선이지 고정 성공 조건이 아니다. 실패 시 실패 이름·명령·환경·원인을 남긴다. 문서만 바꾼 태스크는 링크/명세 검증과 D로 충분하다. 코드 수정 시 해당 동작을 검증하는 테스트를 추가하되 JSX 문자열 검사나 구현 복사 테스트로 UI 검증을 대체하지 않는다.

**플랫폼 전용 테스트 (2026-11-18 갱신)**: `backend/tests/test_switch_worker.py` 외 8개 model-switch 모듈은 Linux 커널 API(`os.listxattr` 기반 SELinux/ACL 보존, `socket.SO_PEERCRED` peer 자격증명)와 GNU `chmod --reference`에 의존한다. macOS 개발 머신에서는 이 기능이 없어 48건이 실패했고, 원인이 "코드 결함"이 아니라 "플랫폼 부재"임을 확인한 뒤 `test_root_namespace.py`와 같은 `pytestmark = pytest.mark.skipif(sys.platform != "linux", ...)` 규약으로 9개 모듈에 가드를 넣었다. 결과: 로컬(darwin) `337 passed / 96 skipped / 0 failed`, Linux에서는 가드가 풀려 그대로 실행된다. 스킵 사유는 `pytest -rs`에 모듈별로 찍히므로 조용한 누락이 아니다.

각 태스크 끝에 아래 인계를 추가한다.

```text
ID / 상태 / 날짜 / 기준 HEAD:
변경 파일과 사용자에게 달라지는 동작:
보존한 계약:
실행한 명령과 결과:
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰 (캡처 선택, 관찰 없으면 미검증):
미완료·위험·다음 태스크가 알아야 할 사실:
```

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

## 1. 남은 보완 태스크

### RULE01 — 부정·다인 표현의 규칙 오탐 보완 · 구현 완료

- 근거: `frontend/src/prompt/proposals.ts`의 `text.includes`는 `사람은 없다`와 `사람들`에도 단수 인물을 제안한다. [기준선 보고](archive/prompt-composer/2026-11-18/PROMPT_COMPOSER_EVAL_UX01.md) 사례 1–3.
- 수정: proposals 및 대응 테스트, 필요시 순수 매칭 helper. 사전/컴파일러/Scene 저장 계약 변경 없음.
- 실행: 부정·복수 경계를 판정하는 최소 규칙과 모호할 때 제안 보류를 설계. 같은 문장에 긍정·부정이 섞이면 문장 전체 일괄 삭제 금지. 예: `사람은 없고 고양이는 있다`, `안경 없이 웃는 사람`, `사람 둘이 걷는다`.
- 완료: 기대 ID/금지 ID를 먼저 정의하고 양성·부정·다인 및 혼합 문장 테스트. 원문은 그대로, 불명확한 인물 귀속을 추정하지 않음. F·B, 기존 평가를 다시 계산해 변화와 남은 실패 기록.

```text
ID / 상태 / 날짜 / 기준 HEAD: RULE01 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  신규 frontend/src/prompt/matching.ts, frontend/src/prompt/proposals.ts,
  frontend/tests/prompt-proposals.test.mjs, frontend/tests/prompt-eval-ux01.test.mjs,
  scripts/eval-ux01/evaluate.mjs + docs/evidence/prompt-composer-eval-ux01/*.
  사용자 동작: `사람은 없다`·`사람들`·`두 사람` 문장에서 단수 인물이 더 이상 제안되지 않고,
  문장에 긍정 절이 남아 있으면 그 항목은 그대로 제안된다. 목록 수는 사례 1–3에서 줄어든다.
보존한 계약: 사전 ID/버전(1.2.0)·컴파일러 출력·Scene v1 저장 의미·원문 보존. 새 저장 필드 없음.
  불명확한 인물 귀속은 추정하지 않고, 사전이 제공하는 `subject.two_people`/`subject.group`만 지목한다.
실행한 명령과 결과:
  node --experimental-strip-types --test frontend/tests/*.test.mjs → 131/131 통과
  npm --prefix frontend run build → 통과 · npm --prefix frontend run lint → 통과(경고 0)
  node --experimental-strip-types scripts/eval-ux01/evaluate.mjs → 38 기대 / 29 적중(recall 76.3%) /
  원치 않은 추가 3→0 / 미분류 1
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  HeadlessChrome(chromium-1228), 1280×900. 12장면 브라우저 팔 재실행에서 제안 목록·칩·초안이
  Node 팔과 일치(8/8 검사 통과, 클릭 43). 캡처: docs/evidence/prompt-composer-eval-ux01/.
미완료·위험·다음 태스크가 알아야 할 사실:
  RULE01은 부분일치 오탐만 다룬다. `앉은`/`서 있다`/`흰 배경` 같은 활용형·별칭 누락은 RULE03이다.
  부정 판정은 절 단위 어휘 휴리스틱이며 문장 의미 이해가 아니다(예: `글자 없이`는 여전히 미표현).
  남은 미분류 1건은 `portrait-front-closeup`의 `subject.person`으로, 사람이 판정할 항목이라
  precision 분모에서 제외한다(테스트 통과를 위해 정답으로 바꾸지 않음).
  후속 보완: 복수/수 항목이 이미 선택된 상태에서도 단수가 되살아나지 않도록 판정 대상은
  '추가 가능한 항목'이 아니라 '활성 사전 전체'로 두고, 대상이 선택돼 있으면 제안을 생략한다
  (테스트 1건 추가, 총 131건).
```

### RULE02 — 규칙 제안에서도 부분 변경 범위 보존 · 구현 완료

- 선행: RULE01. 근거: 규칙 suggestSelections 요청에는 target_groups가 없어 `조명만` 경로에서 카페가 추가되는 기준선 사례 8. AI partial_change의 범위 검증과 다름.
- 수정: proposals/PromptBuilder의 규칙 요청·수락 연결과 테스트. 현재 부분 변경 UI 상태를 재사용하고 새 저장 필드 금지.
- 실행: 부분 변경 모드의 선택 그룹·잠금값을 규칙 후보와 수락 시점에 적용. 전체 장면 모드에서는 기존 탐색 범위를 유지. 모드가 다르면 문구로 알림.
- 완료: lighting만 허용 시 카페 추가 불가, 대상/의상 보존, 모드 전환·오래된 후보 방어. 기존 AI 경로 동일성, F·B 및 텍스트 상태 관찰표.

```text
ID / 상태 / 날짜 / 기준 HEAD: RULE02 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  frontend/src/prompt/proposals.ts(SuggestionReport, ProposalRequest.targetGroups),
  frontend/src/components/PromptBuilder.tsx(범위 메모·보류 안내), frontend/src/styles.css
  (.prompt-proposal-list__scope), frontend/tests/prompt-proposals.test.mjs,
  scripts/eval-ux01/evaluate.mjs, scripts/prompt-composer-browser/suite-contracts.mjs.
  사용자 동작: 부분 변경 범위를 고른 상태에서 `원문에서 사전 항목 찾기`를 열면 목록이 그 범위만
  제안하고, 보류한 항목의 개수·이름을 한 줄로 알린다. 범위 때문에 비었을 때도 그 사실을 말한다.
보존한 계약: Scene v1·저장 필드·AI partial_change 요청/검증 경로·locked_ids 의미.
  규칙 수락은 기존 `selectEntry` 경로 그대로이고, 범위는 UI 상태에서만 파생한다(새 저장 없음).
실행한 명령과 결과:
  frontend/tests 전체 131/131 · node --experimental-strip-types --test frontend/tests/prompt-proposals.test.mjs 14/14
  sh scripts/prompt-composer-browser/verify.sh → 225/225 통과(신규 RULE02 7건: 데스크톱 4 + 360px 3 포함)
  evaluate.mjs 부분 변경 팔: 범위 안 제안 1개(lighting.low_key) · 범위 밖 보류 1개(setting.cafe)
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  배경만 변경 상태에서 목록 캡션 `“배경만 변경” 범위라 1개 제안(네온 조명)을 목록에서 뺐습니다.`
  와 빈 목록 문구를 DOM으로 확인(캡처 25b-rule-scope-notice.png). 360×740에서도 같은 줄이
  288px 폭 안에서 36px 높이로 줄바꿈되고 문서 가로 넘침이 없음을 rect로 측정
  (25c-rule-scope-360.png). 390px은 미측정.
미완료·위험·다음 태스크가 알아야 할 사실:
  범위 판정은 그룹 단위다. 같은 그룹 안에서 잠긴 개별 항목은 "이미 선택됨"으로 빠질 뿐 별도
  사유를 말하지 않는다. 평가 하네스는 여전히 `카페`를 카드 계층으로도 흘려 defensive
  `out_of_scope` 차단을 계속 측정한다 — 규칙 경로 누출 증거가 아니다.
```

### RULE03 — 활용형·별칭 누락을 최소 범위로 보완 · 대기

- 선행: RULE02. **연결: LLM-R02를 먼저 수행한다.** LLM-R02가 사전 mirror에 `label_ko`/`aliases`를 싣고 카탈로그에 노출하므로, alias를 추가하면 규칙 경로와 LLM 경로가 같은 어휘를 얻는다. alias를 먼저 넣고 mirror를 나중에 손대면 같은 파일을 두 번 연다. 연결: EVAL02/AUDIT-A3(이 사례를 중복 작업하지 않음).
- 근거: 기준선 사례 4–7의 `앉은`/`서 있다`/`흰 배경` 등 누락. `흰 배경`→`단색 배경`만으로 색까지 보존됐다고 볼 수 없음.
- 수정: alias 또는 matcher 중 근거가 있는 최소 범위와 테스트. dictionary 변경 시 버전·서버 mirror 생성/동기화 영향까지 기록.
- 완료: 추가한 alias별 양성/반례, 색·시점·자세 중 사전으로 표현 못 하는 의미는 미반영으로 유지. 기존 스냅샷 재결속 금지. F·B 및 필요한 사전 교차 검증. 기준선 숫자를 맞추기 위한 기대값 삭제 금지.

### METRIC01 — 평가 지표의 명칭·분모 정정 · 구현 완료

- 근거: `scripts/eval-ux01/evaluate.mjs:242`는 `(proposed-unwanted)/proposed`를 precision으로 부르며 미분류 2개도 정답 취급한다. 31/34는 확인된 정밀도가 아님. 기존 80클릭은 계산 모델이고 43클릭은 누락 보정 없는 자동 UI 경로다.
- 수정: evaluate/scenes 평가 판정 및 대응 테스트·현재 결과 자료. 과거 archive 수치는 그대로 보존.
- 실행: 미분류를 추가 판정하거나 판정 가능 항목의 정밀도와 미분류 비율을 분리. 미분류 포함 수치는 상한 또는 비금지 제안 비율로 명명. 모델 클릭 비용·실제 UI 클릭·사람 소요 시간 분리.
- 완료: 분자/분모 예시와 계산 테스트, 12장면 재계산. 테스트 통과용으로 오탐을 정답으로 바꾸지 않음. 아직 측정하지 않은 사용자 효율을 성공으로 표시하지 않음.

```text
ID / 상태 / 날짜 / 기준 HEAD: METRIC01 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  scripts/eval-ux01/evaluate.mjs, frontend/tests/prompt-eval-ux01.test.mjs,
  docs/evidence/prompt-composer-eval-ux01/{results.json,summary.txt,browser.json,browser-results.json}.
  화면 동작은 바뀌지 않는다. 바뀌는 것은 보고 이름과 분모다.
보존한 계약: 제품 코드·사전·컴파일러·Scene 계약·fixture 기대값. archive 수치는 수정하지 않았다.
  계산 테스트는 기대값을 결과에 맞춰 고치지 않고, 판정 불가 항목을 분모에서 빼는 방식만 검증한다.
실행한 명령과 결과:
  지표 이름: precision(분자 적중, 분모 판정 가능 제안 = 제안 − 미분류), nonForbiddenShare(상한),
  unclassifiedRate. 제거: precisionDecided.
  현재 값: precision 100.0%(29/29) · 비금지 제안 비율 100.0%(30개 중 1개 미분류) ·
  미분류 3.3% · 원치 않은 추가 0 · recall 76.3%. 부분 변경 팔의 보류/제안 개수도 함께 집계한다.
  node --experimental-strip-types --test frontend/tests/prompt-eval-ux01.test.mjs → 통과
  sh scripts/eval-ux01/browser.sh → 8/8 통과, 클릭 43(자동 UI 경로)
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  요약 출력 문장 2줄(`규칙 경로 precision …`, `미분류 … 상한은 비금지 제안 비율 …`)을
  summary.txt로 확인. 브라우저 팔은 12장면 DOM에서 제안·칩·초안을 다시 읽어 Node 팔과 대조했다.
미완료·위험·다음 태스크가 알아야 할 사실:
  precision 100%는 "판정 가능한 29개"에서만 성립한다. 미분류 1건은 사람 판정 대기이고,
  recall 76.3%는 그대로이므로 이 수치를 품질 개선으로 읽으면 안 된다.
  사람의 소요 시간·실제 LLM 품질은 여전히 미측정(EVAL-UX02/U11).
```

### VAR03 — 상황 문장과 실제 적용 부분의 차이 명시 · 대기

- 근거: `situationVariants.ts`는 unresolved_ko를 blocks에 넣지 않으며, PromptBuilder는 사전 밖 표현이 있는 카드도 사전 ID 부분을 적용하고 이후 미반영 안내를 추가한다. 기존 VAR02의 “복합 상황 적용 가능 표시 안 함” 완료 기준보다 허용 범위가 넓다.
- 수정: 상황 카드 문구/적용 분기와 대응 테스트. compiler·Scene 계약은 그대로.
- 실행: 미반영 구절이 있는 경우 적용 전 `사전 항목만 반영`과 포함/제외 내용을 명시하거나 의미 핵심이 빠진 후보를 차단하는 기준을 결정. 문자열 의미를 단순 휴리스틱으로 이해했다고 주장하지 않음.
- 완료: unresolved가 있는/없는 카드, 사전 변경 없음, 잠금 위반, 되돌리기 사례 확인. 최종 prompt 자동 덮어쓰기·이미지 자동 생성 없음. F·B; 시각 검증 못 하면 텍스트/DOM 관찰과 미검증 구분.

### LIVE01 — 실제 LLM 연결 전 설치·payload 점검 · 대기

- 근거: provider/API/UI는 구현됐지만 기존 증거는 injected transport와 페이지 fetch 스텁이다. C02 인계에 실제 model alias 미확인과 gate protocol 이슈가 남았다.
- 수정: 읽기 조사와 이 문서 인계, 필요시 provider payload 단위 테스트. 비밀값 출력·운영 설정 변경·GPU 실행 없음.
- 실행: capability 조건, 사전 mirror/버전/배포 파일, 실제 설정의 모델명 확인 방법, gate 데이터 경로와 제어 경로를 구분. `_dictionary_listing`이 ID/category만 보내는 문제와 `partial_change`가 기존 selections를 보내지 않는 영향은 **LLM-R02·R03에서 구현으로 승격**했으므로 이 태스크에서는 재조사하지 않고 인계만 확인한다.
- 주의: `services/llm.py`의 protocol 3 요구와 `gate_candidate.py`의 protocol 2 응답은 owned image admission 경로 이슈다. 제안 provider 자체의 일괄 차단 원인으로 단정하지 않음. 플랫폼/운영 담당 범위와 연결하되 검증을 건너뛰지 않는다.
- 완료: 설치 조건별 예상 capability·성공/거절 경로 표, 확인/미확인 항목, LIVE02에 전달할 안전한 실행 절차. 계약/보안 경계 변경이 필요하면 구현 전에 영향 보고.

### LIVE02 — 실제 provider 응답의 통합 확인 · 환경 대기

- 선행: LIVE01 **및 LLM-R01·R02·R03·R04·R05**. 운영/GPU 사용은 기존 승인 범위를 확인하고 범위 밖이면 실행하지 않음. fake/stub을 실연결 증거로 대체 금지.
- 근거: 이 선행 조건은 2026-11-18 리뷰 결과다. 부정 가드가 규칙 경로보다 약하고, 카탈로그에 한국어 어휘가 없고, 부분 변경이 현재 선택을 숨기고, 요청 상한 단위가 어긋나고, `finish_reason`이 모델 자기신고인 상태에서 측정하면 **모델 품질 결함과 하네스 결함을 구분할 수 없다**.
- 실행: 이미지 생성이 없는 허용된 환경에서 selection_hint, partial_change, situation_variants 각 요청 1개부터 순차 확인. alias·모델 버전·지연·schema 거절·취소·불가 상태 기록. 모델 버전은 **서버가 봉투에서 읽은 값**(LLM-R05)으로 기록하고 모델 자기신고 값은 진단으로만 병기. API 키/원문 사용자 로그는 기록하지 않음.
- 완료: 실제 응답과 최종 미적용 상태 보존, 범위/잠금/미반영 안내 검증. 실패는 원인별 작은 후속 태스크로 남김. 코드 구현 완료와 실제 품질 검증 완료를 분리.

### EVAL-UX02 — 실제 LLM 평가와 사용자 효율 측정 · 대기

- 선행: LIVE02, METRIC01. EVAL-UX01의 남은 완료 조건을 승계. 규칙 기준선은 archive에 보존.
- 실행: 같은 12장면으로 실제 모델 응답의 ID 적중·부정·귀속·잠금 준수·원치 않은 추가와 미반영을 비교. 사람이 입력부터 승인까지 수행한 시간·클릭·보정과 의견을 별도 수집. 스텁 후보 품질을 모델 품질로 표시하지 않음.
- 완료: 실제 모델/설정/분모/실패 사례/사용자 의견. 사람이 없으면 사람 측정 부분은 대기. 품질 우위·최적성은 비교 없이는 주장하지 않음. 이미지 품질은 QUALITY01/02 별도.

### U11 — 현재 화면의 사용자 확인 · 사용자 확인 대기

- 실행: 현재 설명 입력→규칙/AI 제안→수락/부분 변경/상황 후보→미리보기→적용 흐름을 텍스트로 설명하고 실제 사용자 의견 기록. 360/390px·데스크톱의 실제 관찰/미검증 구분. RULE/VAR 보완 후 영향 부분은 다시 확인.
- 완료: 반영/보류 결정과 이유. 기존 화면 계측을 최신 소스의 실측으로 재사용하지 않음. 무응답은 승인 아님. 캡처를 필수로 요구하지 않음.

### U12 — 정합성 회귀와 범위별 종료 · 대기

- 선행: RULE01–03, METRIC01, VAR03, LLM-R01–R07 및 U11. 실연결/품질을 포함한 전체 기능 종료는 LIVE02/EVAL-UX02 증거도 필요.
- 실행: F·B·S·P·D 및 제안 provider/API 테스트. 같은 소스에서 이미 통과한 검사는 재사용 범위를 기록. 저장 스냅샷·retry·최종 직접 수정·원문 보존 확인. §0의 정본/사본 표(부정·잠금·그룹·충돌)가 코드 주석과 일치하는지 대조한다.
- 완료: 로컬 구현/실연결/사용자 검증/운영/GPU 상태를 각각 기록. 미검증을 완료 archive로 숨기지 않음. 완료한 자식 상세만 archive로 옮기고 남은 태스크 유지.

### 캡처 없는 인계

`태스크·HEAD / 위→아래 화면 순서 / 빈·로딩·오류·수락 후 상태 / 버튼명과 효과 / 변하지 않아야 할 데이터 / 포커스 / 테스트 결과 / 실제 DOM·크기 관찰 또는 미검증 / 다음 ID`를 기록한다. 소스 기반 예상 배치를 브라우저 관찰로 쓰지 않는다. 현재 도구 접근 규칙을 준수한다.

## 2. 운영 릴리스·배포 최적화 (UX 이후)

아래 태스크는 각 행이 독립된 작업 명세다. `문서`는 지정 주제의 결과 파일 신규 작성 또는 기존 문서 갱신을 뜻한다.

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| REL01 / 대기 | P5-L01, U12 | ACTIONS_DEPLOYMENT에 목표 커밋·구/신 API 호환·코드/DB 백업·복원 명령·health 확인 표 작성. 운영 실행 없음 | deploy-release.sh와 실제 명령 대조, 비밀값 없이 실행 가능한 릴리스 체크리스트 |
| REL02 / 대기 | P5-L01, REL01 | 격리 Fake 환경에서 구 capability/구 이력·새 이력/HTTP 한도·재사용/retry 확인. 테스트와 결과 문서만 | S·P 및 호환 시나리오 표. 구 바이너리의 JSON 읽기를 추측하지 말고 실제 결과 기록 |
| REL03 / 환경 대기 | P5-L01, REL02 | 사용자 승인 범위 확인 후 운영 사전 점검·배포·롤백 관찰. 서버 접근/승인이 없으면 실행하지 않음 | 정확한 릴리스·설치기 해시·백업 위치·서비스 결과. 실제 롤백 미실행이면 미검증 유지 |
| DEP01 / 대기 | DEPLOY-OPT01, U12 | ACTIONS_DEPLOY_OPTIMIZATION에 last-success/실서버 상태/실패 후 push/force push/수동 실행의 결정표 작성 | 비교 불명 시 전체 실행, 변경 누락 없는 사례 표. workflow 수정 없음 |
| DEP02 / 대기 | DEPLOY-OPT01, DEP01 | 순수 경로 분류 helper와 단위 테스트만 작성. frontend/backend/common/unknown·rename/delete 분류 | lock/config/workflow/API 공유 변경은 보수적 처리. classifier만으로 deploy skip 결정 금지 |
| DEP03 / 검토 대기 | DEPLOY-OPT01, DEP02 | 부분 아티팩트 vs 검증된 재사용의 설치·백업·복구 설계 및 시간 측정 계획 | 서버 installer 변경 범위/해시 배포 절차/캐시 키와 비밀값 변경 무효화. 설계 검토 전 CI skip 활성화 금지 |

## 3. 계약·모델 품질·토큰

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| DATA01 / 대기 | P5-D01, U12 | API.md·schemas.py·builderState를 읽고 원문 방식/applied/renderer/provenance의 현재 저장/미저장 표 작성(문서만) | 기존 필드로 알 수 없는 것을 unknown으로 명시. 현재 결과 예시와 구 데이터 예시 |
| DATA02 / 검토 대기 | P5-D01, DATA01 | optional v1 확장/별도 v2/현행 유지 대안 및 rollback·migration 계획 작성 | 호환성·중복 진실·byte 한도 영향 비교. 승인 전 schema/DB 수정 없음 |
| RENDER01 / 대기 | P6-Q01, U12 | compiler를 읽고 정렬/충돌/출처와 구분자 렌더 책임 경계, profile 선택표 작성 | 4계열·unknown·구 snapshot 예시. 출력 의미 변경 없이 재사용할 부분 명시 |
| RENDER02 / 검토 대기 | P6-Q01, RENDER01 | 테스트 fixture에 기존 출력 baseline과 후보 출력 비교 명세 작성 | 현재 golden 출력과 사전 버전 고정, 실 renderer 전환은 별도 승인/작업 |
| QUALITY01 / 대기 | P6-Q02, U12 | 12장면 × seed 17/42/123 평가 입력/기록 템플릿 작성. config/models.yaml 읽기만 | 모델별 허용 steps/CFG/해상도/trigger/샘플러·엔진·체크포인트 기록 필드. 생성 없음 |
| QUALITY02 / 환경 대기 | P6-Q02, QUALITY01·REL03 | 허용된 모델과 GPU 운영 조건 확인 후 장면 한 개·모델 한 개부터 순차 평가 | 성공·실패 이미지와 실제 seed/설정·사용자 판단 기록. 미실행 모델로 일반화 금지 |
| TOKEN01 / 대기 | P6-T01, U12 | compiler와 sdcpp/tokenizer 설정의 실제 한도/잘림/분할 증거 조사(문서) | 공식 자료와 설치 버전의 근거, 모르는 규칙 분리. 다운로드/새 dependency 없음 |
| TOKEN02 / 검토 대기 | P6-T01, TOKEN01 | 최종 prompt·원문·trigger를 검사할 위치와 fallback 설계, 경계 fixture 작성 | 정확 계산/추정 경고 구분. 현 77 근사치를 사실처럼 확대하지 않음 |

## 4. Scene v2·참조 이미지 설계와 LLM 태스크 연결

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| SCENE01 / 대기 | P7-S01, U12 | scene.ts 및 P5 설계를 읽고 actor/공통 환경/관계의 예시 JSON 문서 작성 | 단일/다인/귀속 불명 예시, v1은 자동으로 특정 actor에 귀속하지 않음 |
| SCENE02 / 검토 대기 | P7-S01, SCENE01 | v1 보존·명시 변환·구 클라이언트 읽기·복구 설계 | 저장 버전/마이그레이션 영향 보고. schema 구현 없음 |
| IMAGE01 / 대기 | P7-I01, U12 | upload/권한/보관·조건 전처리·엔진 입력의 요구사항 표 작성 | ControlNet/IP-Adapter/img2img 각각 현재 capability와 필요한 새 계약 분리 |
| IMAGE02 / 검토 대기 | P7-I01, IMAGE01·SCENE01 | 참조 자산 연결·실패 복구·GPU 메모리 평가 계획 | 실제 모델/엔진 검증 전 지원 약속 금지. 업로드 API 구현 없음 |


## 5. LLM 자동화 후보·규칙 평가

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| EVAL01 / 대기 | LLM-EVAL01, U12 | 수작업 원문 20개와 기대 ID/미매칭/부정·부분일치 사례를 별도 fixture로 작성 | 원문 출처는 프로젝트 작성, 기대값은 현재 함수 결과를 복사하지 않고 검토. 사용자 로그 수집 없음 |
| EVAL02 / 대기 | LLM-EVAL01, EVAL01 | proposals.ts를 실행하는 오프라인 평가 스크립트와 결과 문서 | precision/recall 분모·오탐 목록·규칙 score 정의. 사용자 수락률은 실제 관찰 없으면 측정 불가로 기록 |
| AUDIT-A2 / 대기 | LLM-A2, EVAL02 | 기존 12쌍/배타 그룹과 후보 충돌쌍을 비교하는 보고서 | 누락/과잉 경고 예시와 다인 예외. compiler 충돌 규칙 자동 수정 없음 |
| AUDIT-A3 / 대기 | LLM-A3, EVAL02 | alias의 중복·짧은 부분일치·오탐 후보 보고서 | 안정 ID별 원문 예시, alias 변경 제안만 작성 |
| AUDIT-A1 / 대기 | LLM-A1, AUDIT-A2·A3 | 평가에서 사전 커버리지 밖 표현과 추가 항목 후보 분리 | 기존 항목/alias로 해결 가능한 것과 신규 개념 구분. dictionary 수정 없음 |
| AUDIT-A4 / 대기 | LLM-A4, AUDIT-A1 | family 표현 차이·누락·동일 재사용 감사 보고서 | 각 ID의 원문/현 매핑/제안/품질 미검증 표시. 표현 자동 교체 없음 |
| AUDIT-A8 / 대기 | LLM-A8, QUALITY01 | 이미지 평가 rubric과 LLM 채점 보조 입력/출력·사람 검토 계획 | 실제 이미지 없으면 채점하지 않음. LLM 판단을 품질 사실로 확정하지 않음 |
| AUDIT-A6 / 검토 대기 | LLM-A6, SCENE01·보관된 C01 계약 | actor 귀속 제안과 불명확성 표시 예시 작성 | 사용자 수락 전 귀속 변경 없음. Scene v1을 임의 확장하지 않음 |

## 6. 접근성·플랫폼 잔여 검증

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| AT01 / 환경 대기 | P5-C03-AT, U09 | 실제 브라우저 200% 확대 및 360/390px와 소프트 키보드 확인 | viewport 축소와 실제 zoom을 구분. 가려진 입력·적용 버튼·focus clipping의 증거. 결함은 이 문서의 새 보완 태스크로 환류 |
| AT02 / 환경 대기 | P5-C03-AT, U09 | 실제 보조기기에서 이름·상태·오류·분류·선택 해제 낭독 검증 | OS/브라우저/스크린리더·실행 순서·관찰 기록. 자동 axe만으로 대체하지 않음 |
| PLATFORM01 / 대기 | TEST-PLATFORM01 | 기존 실패 보고에서 48개 실패의 파일/실패명/최초 예외/OS 기능 의존 목록 정리 | 문서의 기존 분류를 가설로 취급. 전체 실패를 자동으로 환경 탓으로 닫지 않음. 기존 실패를 숨기는 skip 추가 금지 |
| PLATFORM02 / 환경 대기 | TEST-PLATFORM01, PLATFORM01 | 격리 Linux/Fedora에서 같은 커밋·의존성·명령 실행 후 비교 | 0건 확인 또는 실제 결함별 후속 ID 생성. 운영 서비스/권한 변경 없이 실행 가능한 환경 필요 |

## 이번 대조의 검증 (2026-11-18)

- RULE01·RULE02·METRIC01 반영 후: 프론트 F **131/131 통과**, build·lint 통과.
- 브라우저 `sh scripts/prompt-composer-browser/verify.sh` **225/225 통과**(RULE02 범위 목록 7건 신규: 1280px 4 + 360px 3), `sh scripts/eval-ux01/browser.sh` **8/8 통과**(클릭 43).
- 제안 schema/provider/API + prompt composition + coordination capability: **105/105 통과** (`.venv/bin/python -m pytest backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py backend/tests/test_prompt_composition.py backend/tests/test_coordination_capability.py -q`).
- 새 브라우저 실행은 위 두 하네스이며 headless Chromium 1280×900(및 RULE02 360×740 측정 구간)에서만이다. 실제 LLM·GPU·전체 Studio suite는 실행하지 않았다. 로컬 테스트 통과가 실제 모델 품질을 입증하지 않는다.
- 이번 변경은 제품 코드(`proposals.ts`·`matching.ts`·`PromptBuilder.tsx`·`styles.css`), 테스트, 평가 하네스, 문서, `docs/evidence/` 재생성 결과를 포함한다. 직전 기준선 문서만 갱신한 대조와 달리 브라우저·평가를 다시 실행했고, 그 결과가 위 수치다. 완료된 상세 명세/계약은 2026-11-18 archive에 보존했다.

### 2026-11-18 LLM 경로 리뷰 대조 (§0)

- 리뷰 갱신은 **문서 전용**이었다. 제품 코드·사전·테스트·fixture를 수정하지 않았고 기존 통과 수치를 재실행하지 않았다.
- 위 리뷰 후 **LLM-R01–R07을 실제로 구현**했고, 그 결과가 다음 절이다.
- 리뷰 중 실행한 명령과 결과:
  - `.venv/bin/python -m pytest backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q` → **91/91 통과**(§0 태스크의 `L` 기준선).
  - `.venv/bin/python`으로 `_negated_in_source` 직접 호출: `사람은 없다`→False(미탐지), `사람. 안경 없이 걷는다`→True(절 경계 무시), `안경 없이 짧은 머리의 사람`→False(기존 의도 유지). 세 결과를 LLM-R01 근거로 인용했다.
  - Node로 카탈로그 3형태 바이트 측정: id만 2,939B, id+라벨 4,077B, id+라벨+별칭 5,733B. 활성 100개·별칭 122개 확인.
  - Node로 요청 본문 크기 측정: 8 KiB를 넘는 첫 한글 문자 수 2,592자(8,194B), 4,000자에서 12,418B.
  - `git rev-parse --short HEAD` → `b5efd2d`(기준 HEAD 갱신).
- 측정하지 않은 것: 실제 모델 응답, 브라우저 화면, GPU·gate 상태. §0은 코드 구조와 순수 함수 실행 결과만 근거로 한다.

### 2026-11-18 LLM-R01–R07 구현 결과

- **변경 파일**: `backend/app/services/prompt_proposals.py`, `backend/app/services/proposal_provider.py`, `backend/app/services/prompt_dictionary.py`, `backend/app/api/proposals.py`, `frontend/src/prompt/llmProposals.ts`, `config/prompt_dictionary.json`, `scripts/gen-prompt-dictionary.mjs`(신규), 테스트 4개 파일.
- **검증 명령과 결과**:
  - `L`: `.venv/bin/python -m pytest backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q` → **106 passed**(리뷰 기준선 91).
  - `F`: `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **133 pass / 0 fail**(기준선 131).
  - `D`: `git diff --check` → 위반 0.
  - `.venv/bin/python -m ruff check backend` → **All checks passed**.
  - 전체 `backend/tests` → **337 passed / 96 skipped / 0 failed**. 스킵 96건은 Linux 전용 model-switch 9개 모듈 + 기존 `test_root_namespace.py`이며 `sys.platform` 가드로 처리했다(위 "플랫폼 전용 테스트").
- **실측 payload**: 실제 mirror 기준으로 렌더된 시스템 프롬프트 카탈로그가 5,717B. 요청 본문은 실제 `proposalBody`로 측정해 선택 100개·범위 없음·한글 1자에서 **5,143B**, 선택 60+잠금 60+한글 1,000자에서 **7,519B**. `selections`·`locked_ids`가 8 KiB 예산을 실제로 소모한다.
- **실측 여유**: 8 KiB에서 남는 한글 문자 수는 선택/잠금 100+100에서 **361자**, 100+0에서 1,017자, 60+60에서 1,224자, 20+20에서 2,144자, 선택 1개에서 2,582자.
- **R03의 바이트 영향 = 0**: 브라우저는 이미 `selections`를 보내고 있었고 서버 `build_payload`가 그 필드를 복사하지 않았을 뿐이다. 따라서 R03은 정보 누락을 고친 것이지 요청을 키운 것이 아니다.
- **남은 위험**: 대량 선택(수십~100)+긴 한글 서술 조합은 8 KiB 로컬 검사에서 `too_large`로 거절된다. 요청 상한을 올리지 않기로 했으므로(R04 주의사항) 이 조합은 의도된 거절이며, 필요하면 `selections` 전송 형식 축소(배열화)를 별도 태스크로 다룬다.
- 다음 작업은 RULE03이다. LIVE02는 실행 환경이 있을 때 R01–R05 위에서 착수한다.
