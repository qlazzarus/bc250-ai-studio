# 사전 프롬프트 단일 실행 태스크

갱신일: 2026-11-19 · 기준 HEAD `16f3a34` · **사전 프롬프트의 활성 상태·우선순위·완료 기준은 이 문서에서만 관리한다.** CURRENT는 구현 설명이고 P5/LLM 문서는 계약 참고자료다.

**이 문서는 "앞으로 실행할 태스크"만 담는다.** 완료된 태스크의 상세 명세·계약·인계는 [2026-11-18 archive](archive/prompt-composer/2026-11-18/README.md)로 옮겼고, 아래 [완료 원장](#완료-원장)은 ID·날짜·보관 위치만 가리킨다. 완료 작업을 다시 수행하지 않으며, 원장의 링크가 유일한 근거다.

## 현재 판정과 다음 작업

- **2026-11-18 완료**: LLM-R01–R07(LLM 경로 정합성), RULE01·RULE02(규칙 제안 오탐·범위), METRIC01(지표 분모) 구현·로컬 검증. 상세는 archive.
- **다음 코드 작업 순서: TRANS01 → TRANS02 → TRANS03 → TRANS04 → TRANS05 → TRANS06 (모두 완료, §1).** 방향 3(사전 밖 잔여 구절의 번역 제안 필드)을 5개 태스크로 분해했고, TRANS01은 계약 결정, TRANS02–05는 순서대로 구현했다. TRANS03(schema v2 변경)은 TRANS01의 승인 뒤에 착수했다. TRANS06은 TRANS05가 남긴 회귀(모델 계열 변경 시 적용 기록 소실)를 U11 브라우저 확인에서 찾아 수정한 후속 태스크다.
- **2026-11-20 진행**: U12가 남겨 두었던 "실제 DB·자산 이력에서의 v2 왕복"을 닫았다 — 재시작 경계 백엔드 3건(같은 `data_dir`로 앱 재기동), 실제 브라우저+실제 SQLite 23건(`suite-u12.mjs`: 저장→조회→이력 화면→복원→새로고침→재시도). 그 과정에서 v2 복원 시 "적용 정보 기록 없음"이라고 단정하던 표시 결함을 찾아 문구만 수정했다(§2 U12). 브라우저 검사는 278건/0실패. **여전히 실제 LLM 응답의 번역 품질은 미검증**이며, 이 환경에는 `STUDIO_ADMISSION_URL`·gate·GPU가 없어 LIVE02를 실행할 수 없다. 실행용 하네스(`scripts/live02_proposals.py`)는 준비했고, capability를 광고하지 않는 서버(가짜 엔진 포함)에서는 스스로 거부해 stub 결과가 실연결 증거로 기록되지 않는다.
- **TRANS01–TRANS05와 무관하게 남은 작업**: RULE03(대기) → VAR03(대기) → U12(대기). 순서는 TRANS 완료 후로 미룰 수 있으나, U12의 선행 조건에 TRANS 태스크가 포함되므로 U12 전에 정리한다.
- **환경·사용자 대기**: LIVE01(대기) → LIVE02(환경 대기) → EVAL-UX02(대기), U11(사용자 확인 대기). LIVE02는 R01–R05 완료로 선행 조건이 충족됐고 실행 환경만 필요하다. 환경 부재가 다른 태스크를 막지 않는다.
- Actions DEP와 플랫폼 PLATFORM은 공통 의존 작업으로 후속 표에 유지한다. 사전 프롬프트의 운영 완료로 합산하지 않는다.
- U11은 사용자 의견 대기, U12는 필수 보완과 평가 범위 정리 후 종료한다. 캡처는 필수 아님. 실제 화면 관찰과 소스 기반 예상 묘사를 구분한다.

확정 계약 참조: [C01/C02와 VAR01 보관본](archive/prompt-composer/2026-11-18/PROMPT_COMPOSER_EXECUTION_TASKS.md), [LLM 경로 리뷰와 R01–R07](archive/prompt-composer/2026-11-18/LLM_PATH_REVIEW_AND_R01_R07.md), [TRANS01 계약 결정문](PROMPT_COMPOSER_TRANS01_CONTRACT.md). v1은 사전 ID만 선택으로 승격한다. **2026-11-19부터 번역 제안은 v2 구성(`remainder`)으로 영속화되며, 인물별 귀속/제안 이력 일반 영속화는 여전히 지원하지 않는다.** 두 사실을 섞어 "제안 이력을 지원한다"고 넓혀 읽지 않는다.

## 완료 원장

완료 태스크의 상세는 archive에 있고 이 문서는 상태만 기록한다. archive는 과거 증거이므로 수정해서 현재 성공을 만들어내지 않는다.

| ID | 완료일 | 보관 위치 |
| --- | --- | --- |
| LLM-R01–R07 | 2026-11-18 | [LLM_PATH_REVIEW_AND_R01_R07.md](archive/prompt-composer/2026-11-18/LLM_PATH_REVIEW_AND_R01_R07.md) |
| RULE01, RULE02, METRIC01 | 2026-11-18 | [RULE01_RULE02_METRIC01.md](archive/prompt-composer/2026-11-18/RULE01_RULE02_METRIC01.md) |
| 2026-11-18 검증 기록 | 2026-11-18 | [VERIFICATION_2026-11-18_R01_R07.md](archive/prompt-composer/2026-11-18/VERIFICATION_2026-11-18_R01_R07.md) |
| UX01–UX05, VERIFY01/02, LLM-C01/C02, LLM-I01–I06, VAR01/02 | 2026-11-17 이전 | [2026-11-18 실행 명세](archive/prompt-composer/2026-11-18/PROMPT_COMPOSER_EXECUTION_TASKS.md), [2026-11-17](archive/prompt-composer/2026-11-17/README.md), [2026-11-16](archive/prompt-composer/2026-11-16/README.md) |
| EVAL-UX01 (규칙/fixture 기준선만) | 2026-11-18 | [PROMPT_COMPOSER_EVAL_UX01.md](archive/prompt-composer/2026-11-18/PROMPT_COMPOSER_EVAL_UX01.md). 사용자 시간·실제 LLM 평가는 EVAL-UX02/U11로 승계 |

**보관본을 인용할 때의 주의**: archive의 완료 표시는 당시 로컬 검증 범위다. LLM-R01–R07의 `L` 106건, `F` 133건, 전체 `backend/tests` 337 passed/96 skipped는 로컬 실행 결과이며 실제 모델 품질·운영 성공을 뜻하지 않는다.

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
| F | `node --experimental-strip-types --test frontend/tests/*.test.mjs` | 프론트 **186건**(2026-11-20 U12 반영. TRANS06 기준은 184건, TRANS02–05 기준은 177건). 데이터·컴파일러·P5·규칙 제안·매칭 helper·LLM 제안 상태·잔여 구절·번역 포함·메타데이터 표시(SSR 렌더)·복원 문구 회귀. Python/Pydantic 교차 검증 의존성 필요 |
| B | `npm --prefix frontend run build` 및 `npm --prefix frontend run lint` | TS·번들·정적 검사 |
| S | `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh` | Studio 131건 기준. 전체 저장소 pytest와 구분 |
| P | `.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_coordination_capability.py -q` | 구성 저장과 capability 회귀 |
| L | `.venv/bin/python -m pytest backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q` | LLM 제안 계약·payload·validator 회귀. LLM-R01–R07 구현 후 **106건 통과**([보관본](archive/prompt-composer/2026-11-18/LLM_PATH_REVIEW_AND_R01_R07.md)) |
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

## 1. 사전 밖 잔여 구절의 번역 제안 (TRANS, 방향 3)

**문제**: 한국어 문장을 입력해도 사전 100개 항목에 걸리는 구절만 최종 프롬프트가 된다. 실측 사례(2026-11-18):

```text
입력: "비 오는 밤, 편의점 앞에서 비를 맞으며 기다리는 30살 유럽 여성 금발. 네온 조명이 젖은 바닥에 반사된다"
사전 커버: 의미 문자 42자 중 6자 (14.3%)  ← "금발", "네온 조명"
미커버:    36자 (85.7%)  ← "비 오는 밤", "편의점", "기다리는 30살 유럽 여성", "젖은 바닥에 반사된다"
결과 draft: "blonde hair, neon lighting"
```

원인은 모델이 아니라 **사전**이다. `_dictionary_listing`은 active 항목만 보내고 `validate_reply`가 화이트리스트 밖 ID를 거부하므로, 어떤 모델도 사전에 없는 개념을 표현할 수 없다. 따라서 LLM 호출을 늘리는 것만으로는 이 문장이 해결되지 않는다.

**기존 원칙과의 관계**: 이 방향은 [LLM 자동화 문서](PROMPT_COMPOSER_LLM_AUTOMATION.md)의 원칙 2를 어기지 않는다.

> "**원문은 불변.** `free_text_ko`는 저장·표시 시 절대 변형하지 않는다. **LLM 번역/보강은 별도 필드의 제안으로만 존재한다.**"

따라서 번역 결과는 `free_text_ko`를 덮어쓰지 않고 **새 필드의 제안**으로만 존재하며, 사용자가 명시적으로 포함을 선택해야 최종 프롬프트에 반영된다. 원칙 1(조립은 compiler가 한다)과 원칙 3(적용은 명시적)도 유지한다.

**설계 금지선 (TRANS 전체 공통)**

- `free_text_ko` 변조 금지. `compileScene`의 기존 출처(`sources`→`draft`) 계산 의미 변경 금지.
- LLM이 만든 문자열을 사전 `mapping`처럼 취급해 `selections`에 넣는 것 금지. 사전 밖 표현은 끝까지 "사전 밖"으로 식별 가능해야 한다.
- 자동 적용·자동 저장·자동 생성 금지. 사용자가 포함을 누르지 않으면 최종 프롬프트는 지금과 동일하다.
- GPU 비교 증거 없이 "번역이 더 좋다"고 주장하지 않는다. TRANS는 기능 경로를 만드는 작업이고 품질 판정은 QUALITY/LIVE 계열이다.
- 번역 실패·거절 시 기존 동작(현재와 동일한 초안)으로 조용히 폴백한다.

### TRANS01 — 계약 결정: 필드·한도·재현성 기록 · **결정 완료 · v2 채택**

- 선행: 없음. **TRANS02–05의 선행이며, 이 태스크의 산출물은 코드가 아니라 결정문이다.**
- **산출물: [TRANS01 계약 결정문](PROMPT_COMPOSER_TRANS01_CONTRACT.md).** 4개 결정(필드 형태·한도·재현성 기록·어휘 판정)과 실측 근거, 대안, 소유권, 승인 요청이 한 곳에 있다. 결정문은 코드를 수정하지 않았다.
- 근거: `PromptComposition`은 `extra="forbid"`이고 선택 필드 전체가 32 KiB로 제한된다([schemas.py:75-92](../backend/app/models/schemas.py)). 미러인 [validation.ts](../frontend/src/prompt/validation.ts)가 같은 규칙을 재구현하고 있으며, 제안 요청 본문은 8 KiB다. 필드를 추가하면 세 곳이 동시에 움직인다.
- **승인 대기 항목은 하나였다: `PromptComposition` v2 채택 여부.** 2026-11-19에 채택되어 TRANS03이 schema 변경을 구현했다. 결정문 §0의 판정 요약과 §8의 승인 요청이 그 입력이고, §8에 이행 기록이 붙었다.

- 결정 결과 (상세와 측정값은 [결정문](PROMPT_COMPOSER_TRANS01_CONTRACT.md)):
  1. **필드 형태** → `PromptComposition`에 최상위 `remainder` 배열(구절 단위, 최대 8개). `unresolved` 항목 확장은 재생성 시 소실·원문 전체 1건·8개 절단 때문에 탈락. 구서버 422 위험은 쓰기(`POST /jobs`)에서만 발생하며 `schema_versions` 협상으로 막는다.
  2. **한도** → 항목 8개 · `source_ko` 200자 · `suggested_en` 200자(모두 기존 `MAX_UNRESOLVED`/`MAX_UNRESOLVED_CHARS` 재사용). 별도 바이트 상한 없음 — **실측상 필드별 상한은 구성을 제한하지 않고 32 KiB 하나가 유일한 실효 상한**이다. 요청 쪽은 **구절 원문이 아니라 오프셋**(`{start, end}`)을 보낸다: 200자 한글 611.9 B vs 오프셋 27.5 B.
  3. **재현성 기록** → `remainder` 항목마다 `proposal_id`·`proposal_model`·`accepted_at`을 **필수**로 남긴다(항목별인 이유: 한 구성에 여러 호출의 번역이 섞인다). `compiler_version`은 오염시키지 않는다. **schema bump 필요 → 승인 대기.**
  4. **어휘 판정** → `draft_prompt`에 합치지 않는다. 최종 프롬프트는 `applyDraft` 한 곳에서 `draft` + `\n` + 수락된 번역문으로 만든다(`verbatim` 모드의 기존 선례). sd15 77은 **토큰** 예산이며, 번역문 포함 최종 프롬프트에 같은 `estimateTokens`로 다시 계산해 포함 버튼 옆에 사전 표시한다.
- 완료: 4개 결정과 근거, 기존 필드로 대체 가능한 대안, schema bump 필요 여부를 결정문 한 곳에 기록. DATA01/DATA02 소유권 경계 명시. **이 태스크에서 스키마·코드를 수정하지 않았다.**
- 금지: 결정 없이 TRANS03 착수. "일단 optional로 추가"하는 즉흥 확장.

### TRANS02 — 잔여 구절 추출과 사전 밖 판정 · 구현 완료 · 검증 대기

- 선행: 없음(TRANS01과 병행 가능). 순수 클라이언트 계산이라 서버·계약과 무관하다.
- 근거: 지금은 "사전 밖"이라는 사실이 `unresolved`의 `free_text` 1건(원문 전체)으로만 남아, **어느 부분이 사전에 걸리고 어느 부분이 안 걸렸는지** 화면에서 구분되지 않는다. 실측에서 미커버 85.7%가 한 덩어리로 표시된다.
- 수정: `frontend/src/prompt/` 에 순수 모듈을 추가해, 원문에서 규칙 경로가 매칭한 span을 제외한 나머지를 구절 단위로 돌려준다. 기존 `matching.ts`의 `matchOccurrences`·`polarityAt`을 재사용하고 새 매칭 규칙을 만들지 않는다.
- **[TRANS01 결정](PROMPT_COMPOSER_TRANS01_CONTRACT.md) 반영**: 반환하는 구절은 `{start, end}` 오프셋을 함께 가진다. `PhraseOccurrence`가 이미 그 좌표계를 쓰므로([matching.ts:30-38](../frontend/src/prompt/matching.ts)) 새 좌표계를 만들지 않는다. 이 오프셋이 TRANS03 요청 본문이 되고, 구절 원문은 요청에 싣지 않는다(8 KiB 예산). 승인 여부와 무관하게 TRANS02는 지금 착수 가능하다.

- 실행: 공백/조사만 남는 구절은 버리고, 최소 길이 미만은 제외한다. 부정 문맥(`polarityAt`이 `negated`)의 구절은 번역 제안 대상에서 제외한다(RULE01·LLM-R01과 같은 판정을 쓰고 새 휴리스틱을 만들지 않는다).
- 완료: 실측 문장에서 `"비 오는 밤"`, `"편의점 앞에서 비를 맞으며 기다리는 30살 유럽 여성"`, `"젖은 바닥에 반사된다"` 수준의 구절이 나오고, 커버된 `"금발"`·`"네온 조명"`은 제외됨을 테스트로 고정. 부정 문맥 제외 케이스 포함. F·B 통과.
- 금지: 문장 의미 이해를 주장하는 휴리스틱. 형태소 분석기·새 dependency 도입.

**구현 인계 (2026-11-19)**

```text
TRANS02 / 구현 완료 · 검증 대기 / 2026-11-19 / 기준 HEAD 16f3a34 + 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  - frontend/src/prompt/remainder.ts (신규): coveredRanges·extractRemainder·foldForMatching·
    isValidRemainderSpan·staleSpans·toCodePointSpan, REMAINDER_LIMIT(8)·REMAINDER_CHARS(200).
  - frontend/tests/prompt-remainder.test.mjs (신규, 10건).
  - 사용자 동작 변화 없음: 이 태스크는 순수 계산 모듈만 추가했고 화면은 TRANS04에서 붙는다.
보존한 계약:
  - matching.ts의 matchOccurrences·polarityAt을 재사용했고 새 매칭 규칙·새 좌표계를 만들지 않았다.
    반환 오프셋은 PhraseOccurrence와 같은 UTF-16 `{start, end}`이며 end는 배타다.
  - compileScene의 sources→draft 계산을 건드리지 않았다.
실행한 명령과 결과:
  - node --test frontend/tests/prompt-remainder.test.mjs → 10 pass.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: 없음 — 이 태스크는 UI가 없다(미검증 아님).
미완료·위험·다음 태스크가 알아야 할 사실:
  - 부정 문맥 제외는 polarityAt(negated) 판정을 그대로 쓴다. RULE01과 다른 판정을 새로 만들지 않았다.
  - 대소문자 폴딩이 길이를 바꾸는 코드 포인트(U+0130)에서 오프셋이 밀리지 않도록 인덱스 맵을 쓴다.
  - 반환값은 UTF-16이다. 요청 본문은 코드 포인트여야 하므로 TRANS03의 proposalBody가 변환한다.
```

### TRANS03 — 번역 제안의 서버 경로 · 구현 완료 · 실연결 검증 대기

- 선행: TRANS01(필드 형태 확정 — **[결정문](PROMPT_COMPOSER_TRANS01_CONTRACT.md) 승인 필요**), TRANS02(보낼 구절).
- **승인 전 착수 금지.** 승인 대기 항목은 schema v2 채택 하나이며, 결정문 §8이 승인 요청과 거절 시 동작을 정한다.
- 근거: 브라우저는 LLM에 직접 접근할 수 없다(`integrated_chat_proxy: False`, `docs/NEXT_PROJECT_LLM_CLIENT.md`). 번역 제안도 기존 `POST /api/v1/prompt/proposals` 경로를 타야 하며, GPU 경합·gate·한도 규칙이 그대로 적용된다.
- 수정: 새 `kind`(`remainder_translation`)를 추가한다. **TRANS01 결정을 따른다.** `SUPPORTED_KINDS`([proposals.py:41-42](../backend/app/api/proposals.py))와 프론트 `ProposalKind`·`parseReply`가 함께 늘어나야 하며, 모르는 `kind`가 `unsupported_v1`로 답해지는 C01-4 계약은 그대로 유지된다. 요청은 `remainder_spans: [{start, end}]` 오프셋만 받고 서버가 `free_text_ko`에서 자른다(결정 2). 응답은 구조화 스키마 + `extra="forbid"` + 개수/길이 상한(8개·200자·200자)을 지키고, `free_text_ko`는 user 메시지의 데이터로만 취급한다(프롬프트 인젝션 방어, 원칙 8).

- 실행: 시스템 프롬프트에 "사전 ID를 만들지 말고, 주어진 구절만 영어로 옮긴다. 사전 ID를 새로 발명하지 않는다"를 명시. `finish_reason`·`model`은 서버 봉투 관측값을 쓴다(LLM-R05). 실패는 기존처럼 200+문장 봉투로 돌려준다.
- 완료: 알 수 없는 `kind`가 `unsupported_v1`로 답해지는 기존 계약 유지, 상한 초과 응답 거절, `free_text_ko`가 응답에 의해 변형되지 않음을 테스트로 고정. `L`·`S` 통과.
- 금지: 새 엔드포인트 신설. 브라우저에서 LLM 직접 호출. 번역 실패 시 5xx.

**구현 인계 (2026-11-19)**

```text
TRANS03 / 구현 완료 · 실연결 검증 대기 / 2026-11-19 / 기준 HEAD 16f3a34 + 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  - backend/app/models/schemas.py: CompositionRemainder 항목(proposal_id 8–64자·proposal_model
    1–200자·accepted_at `YYYY-MM-DDTHH:MM:SSZ`), PromptCompositionV2, discriminator union.
    PromptComposition v1은 그대로이며 `remainder`는 여전히 extra="forbid".
  - backend/app/api/proposals.py: SUPPORTED_KINDS에 remainder_translation. 모르는 kind는 계속
    unsupported_v1로 답한다.
  - backend/app/services/prompt_proposals.py·proposal_provider.py: 요청 `remainder_spans` 검증
    (span은 free_text_ko 안에서 유효·최대 8개), 서버가 직접 원문을 잘라 user 메시지를 만들고
    응답은 구조화 스키마·extra="forbid"·개수/길이 상한을 지킨다.
  - frontend/src/prompt/llmProposals.ts: ProposalKind 'remainder_translation', parseTranslations,
    proposalBody의 translate 분기(UTF-16 → 코드 포인트 변환).
  - frontend/src/api.ts·validation.ts: v1|v2 타입, v2 검증 미러.
  - backend/tests/test_prompt_remainder.py(신규 20건), test_proposal_api.py(+번역 경로),
    test_prompt_composition.py(+v2), frontend/tests/prompt-remainder-request.test.mjs(신규 16건).
  - 사용자 동작: 번역 제안 요청 버튼이 생긴다. 다만 카드 표시는 TRANS04, 저장은 TRANS05.
보존한 계약:
  - 새 엔드포인트 없음. 기존 POST /api/v1/prompt/proposals만 쓰고 gate/한도/GPU 경합 규칙이 그대로다.
  - 알 수 없는 kind → unsupported_v1 (C01-4). 번역 실패도 200+문장 봉투이며 5xx가 아니다.
  - free_text_ko는 user 메시지 데이터로만 취급되고 응답으로 변형되지 않는다(테스트로 고정).
  - finish_reason·model은 서버 봉투 관측값을 쓴다(LLM-R05).
실행한 명령과 결과:
  - .venv/bin/python -m pytest backend/tests/test_prompt_remainder.py -q → 20 passed.
  - .venv/bin/python -m pytest backend/tests/test_proposal_api.py -q → 39 passed.
  - .venv/bin/python -m pytest backend/tests/test_proposal_provider.py backend/tests/test_prompt_proposals.py -q → 통과(L 묶음 112 passed).
  - node --test frontend/tests/prompt-remainder-request.test.mjs → 16 pass.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: 미검증 — 실제 provider 응답은 LIVE01/LIVE02 범위다.
미완료·위험·다음 태스크가 알아야 할 사실:
  - 요청은 오프셋만 싣고 응답은 source_ko 원문을 서버가 자기 슬라이스로 되돌려 준다. 클라이언트가
    보낸 원문과 비교해 신뢰하지 않아도 된다.
  - accepted_at은 밀리초가 붙으면 422다. 프론트에서 toISOString()을 그대로 쓰면 안 된다(TRANS05).
```

### TRANS04 — 제안 표시와 명시적 포함 · 구현 완료 · 브라우저 검증 대기

- 선행: TRANS03. 같은 `PromptBuilder.tsx`를 수정하므로 TRANS02와 순차 수행한다.
- 근거: 지금 화면은 사전 초안만 보여주고 미커버 구절은 "이 모델로 번역되지 않은 선택 항목" 목록에 원문 1건으로만 나온다([PromptBuilder.tsx:1001-1005](../frontend/src/components/PromptBuilder.tsx)). 사용자가 무엇이 빠졌는지 알고도 넣을 방법이 없다.
- 수정: 제안 카드에 "사전 밖 구절 + 번역 제안"을 별도 종류로 표시하고, **구절 단위로** 포함/제외를 선택하게 한다. 포함을 누르면 최종 프롬프트에만 반영되고 `free_text_ko`는 그대로 둔다.
- 실행: 기본값은 **제외**(현재 동작 보존). 포함 시 결과가 "사전 초안 + 사용자가 고른 번역문"임을 적용 전에 명시한다. 되돌리기 1단계를 제공한다. 카드 문구는 "번역 제안이며 원문과 다를 수 있다"를 포함한다.
- **[TRANS01 결정](PROMPT_COMPOSER_TRANS01_CONTRACT.md) 반영**: 최종 프롬프트 결합은 `applyDraft` 한 곳에서만 한다(`draft` + `\n` + 수락된 번역문). `draft_prompt`·`compiler_version`은 건드리지 않는다. sd15 77토큰 경고는 번역문 포함 **최종 프롬프트**로 같은 `estimateTokens`를 다시 호출해 계산하고, 포함 클릭 **전에** 버튼 옆에 표시한다. 기존 `token_budget` 코드를 재사용하고 새 추정식을 만들지 않는다(결정 4).

- 완료: 포함/제외/되돌리기/원문 불변/최종 프롬프트 외 다른 상태 불변을 확인. 번역이 거절되거나 없을 때 화면이 지금과 동일함을 확인. F·B, 텍스트/DOM 관찰 기록(시각 검증 미실행 시 미검증으로 구분).
- 금지: 자동 포함. `free_text_ko` 편집. 번역문을 `selections`에 넣어 사전 항목처럼 표시하는 것.

**구현 인계 (2026-11-19)**

```text
TRANS04 / 구현 완료 · 브라우저 검증 대기 / 2026-11-19 / 기준 HEAD 16f3a34 + 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  - frontend/src/prompt/remainderInclusion.ts (신규): translationCards(카드), remainderEntry
    (proposal_id 8자 미만·빈 source_ko/suggested_en이면 null), acceptedAt(초 단위),
    includeRemainder/excludeRemainder/isIncluded, finalPrompt, includedEnglish, tokenPreview,
    pruneRemainder, InclusionList·activeInclusions.
  - frontend/src/components/PromptBuilder.tsx: "사전에 없는 구절 번역 제안" 버튼(비활성 조건:
    구절 없음·원문 비었음·요청 중·v1 서버), 번역 카드 패널(한국어/영어/신뢰도, 기본 제외,
    포함/포함 해제, sd15 newlyOverBudget 경고, truncated 안내, "번역 제안이며 원문과 다를 수
    있습니다"), 응답이 사라진 뒤에도 남는 "포함한 번역" 목록, 적용 버튼 위의 결합 안내.
  - frontend/src/styles.css: .prompt-remainder* 클래스(카드·카운트·경고·포함 목록).
  - frontend/tests/prompt-remainder-inclusion.test.mjs (신규 18건).
  - 사용자 동작: 번역 카드가 처음 보이고, 포함을 누른 구절만 최종 프롬프트 끝에 붙는다.
    포함을 누르지 않으면 최종 프롬프트는 지금과 완전히 동일하다.
보존한 계약:
  - 기본값은 제외. 포함은 클릭이며 자동 적용·자동 저장·자동 생성이 없다.
  - free_text_ko는 편집되지 않고, 번역문은 selections에 들어가지 않는다(사전 항목 아님).
  - 결합 지점은 applyDraft 한 곳뿐이고 구분자는 개행 한 글자다(verbatim 모드 선례). draft_prompt·
    compiler_version은 건드리지 않는다.
  - 77토큰 경고는 compiler.ts의 estimateTokens를 다시 호출해 계산하며 새 추정식을 만들지 않았다.
    포함으로 77을 넘기는 경우에만 newlyOverBudget이 참이다(이미 넘은 초안은 초안 자체 경고 소관).
  - 원문에서 사라진 구절의 번역은 pruneRemainder로 렌더 시 제외되고, 기록 목록에서는 지우지
    않는다(구절을 다시 쓰면 되살아난다).
실행한 명령과 결과:
  - node --test frontend/tests/prompt-remainder-inclusion.test.mjs → 18 pass.
  - node --test 'frontend/tests/*.test.mjs' → 177 pass / 0 fail.
  - npm --prefix frontend run build → tsc -b + vite build 성공(345.64 kB JS).
  - npm --prefix frontend run lint → eslint 무경고.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: 미검증 — 실제 브라우저에서 카드 배치·포커스
  이동·200% 확대는 확인하지 않았다. U11/AT01 범위로 남긴다.
미완료·위험·다음 태스크가 알아야 할 사실:
  - 되돌리기는 별도 undo 상태가 아니라 카드의 "포함 해제"/목록의 "빼기"다(1단계). 새 카드
    응답이 오면 목록은 유지되고 카드 상태만 다시 계산된다.
  - inclusion 상태는 {owner, items}로 들고 렌더 시 activeInclusions로 파생한다. effect 안에서
    setState하지 않기 위한 구조이며, 복원된 v2 스냅샷이 자기 번역을 시작 목록으로 갖게 한다.
  - v1 서버에서는 요청 버튼과 카드 패널이 아예 뜨지 않는다(포함이 저장 단계에서 사라지므로).
```

### TRANS05 — 저장 스냅샷·회귀·범위 종료 · 구현 완료 · 운영 회귀 대기

- 선행: TRANS01–04. **[결정문](PROMPT_COMPOSER_TRANS01_CONTRACT.md)이 승인되어 `PromptComposition`에 `remainder`가 실제로 추가된 경우에만 착수한다**(승인 거절 시 이 태스크는 저장 검증 부분을 생략하고 회귀만 수행).
- 근거: 저장 스냅샷은 `prompt_composition`으로 자산에 실린다([schemas.py:127](../backend/app/models/schemas.py), [api.ts:74-82](../frontend/src/api.ts)). 필드를 추가하면 구 클라이언트 읽기·복원 경로가 영향을 받는다.
- **[TRANS01 결정](PROMPT_COMPOSER_TRANS01_CONTRACT.md) 반영**: `schema_versions`는 `[1, 2]`를 광고하고 v1/v2를 동시에 받아야 한다. v1 스냅샷은 `[]` 기본값으로 읽되 마이그레이션·재결속하지 않는다. 32 KiB 재측정 시 `remainder` 8개 + 출처 3필드의 기여분은 실측 **+7,606 B**(19,243 → 26,849)임을 기준선으로 쓴다.

- 실행: 저장→복원→재컴파일 왕복, 구 이력(필드 없음) 읽기, 32 KiB 한도 재측정, `validateComposition`과 서버 검증의 일치 확인. U12의 회귀 범위에 TRANS를 포함시킨다.
- 완료: 왕복·구 이력·한도·검증 일치 테스트. schema bump 여부와 배포 영향 기록. 미검증 항목을 완료로 표시하지 않음.
- 금지: 기존 스냅샷 재결속. 구 이력의 필드를 추정으로 채우기.

**구현 인계 (2026-11-19)**

```text
TRANS05 / 구현 완료 · 운영 회귀 대기 / 2026-11-19 / 기준 HEAD 16f3a34 + 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  - frontend/src/prompt/builderState.ts: draftComposition(state, remainder = [])가 v1/v2를 고르고
    (번역이 없으면 v1 그대로), withAppliedDraft가 최종 프롬프트를 한 곳에서 조립하며,
    v1OnlyWhenUnsupported가 v2 서버 협상 실패 시 사본에서 delete로 remainder를 뗀다.
    restoreComposition은 기록된 사실만 복원하고 v1에 remainder 키를 만들지 않는다.
  - frontend/src/prompt/validation.ts: v2 검증(버전 1|2, v1+remainder 거부, 8개 상한, 항목별
    200자·proposal_id 8–64자·accepted_at 초 단위)과 normalizedComposition의 조건부 remainder.
  - frontend/src/api.ts: PromptComposition 타입이 v1|v2이며 remainder는 옵션.
  - frontend/src/App.tsx: capability의 schema_versions로 remainderSupported를 읽고, 제출 시
    v1OnlyWhenUnsupported(applied, remainderSupported)를 적용하며, v2 스냅샷인데 서버가 v1만
    광고하면 "이번 저장에는 포함한 번역이 빠집니다" 경고를 화면에 남긴다.
  - 사용자 동작: 포함한 번역이 있는 구성만 v2로 저장되고(구성 이력·자산에 remainder로 실림),
    포함이 없으면 저장 본문이 v1과 바이트 단위로 동일하다.
보존한 계약:
  - v1 본문은 remainder를 절대 얻지 않는다(서버 extra="forbid"). schema_version은 포함이 있을
    때만 2가 된다.
  - v1OnlyWhenUnsupported는 원본을 변형하지 않는다(사본에서 delete). v1 스냅샷은 어느 경로로도
    바뀌지 않으며, 복원한 v1을 다시 적용해도 v1로 남는다.
  - draft_prompt·compiler_version은 번역을 흡수하지 않는다. bytes 예산은 32 KiB 하나로 유지되고
    새 필드용 별도 상한을 만들지 않았다.
실행한 명령과 결과:
  - node --test 'frontend/tests/*.test.mjs' → 177 pass / 0 fail(위 파일 18건 포함: TRANS04 7건 + TRANS05 11건).
  - npm --prefix frontend run build → 성공. npm --prefix frontend run lint → 무경고.
  - .venv/bin/python -m pytest backend/tests/test_prompt_composition.py -q → 15 passed
    (v2 retry가 구성을 재컴파일하지 않고 그대로 복사하는 회귀 1건 추가).
  - .venv/bin/python -m pytest backend/tests/test_coordination_capability.py -q → 통과(P 23 passed).
  - .venv/bin/python -m pytest backend/tests/test_proposal_api.py backend/tests/test_proposal_provider.py
    backend/tests/test_prompt_proposals.py -q → 112 passed(L).
  - .venv/bin/python -m pytest backend/tests/test_prompt_remainder.py -q → 20 passed.
  - git diff --check → 통과(EOF 빈 줄 정리 후).
자산 메타데이터 표시: MetadataModal이 v2 스냅샷에서 포함 번역과 출처(proposal_model·proposal_id·
  accepted_at)를 보여 주고, "초안과 최종 문자열이 다름"의 이유를 포함 번역으로 설명한다. v1은
  기존 문구 그대로다. 다만 이 화면은 단위 테스트가 없으므로 표시 확인은 U12 회귀 범위다.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: 미검증 — 저장→복원 왕복은 단위 테스트로만
  확인했고 실제 DB·자산 이력 화면에서의 왕복은 U12 회귀 범위다.
미완료·위험·다음 태스크가 알아야 할 사실:
  - 32 KiB 재측정은 backend/tests/test_prompt_composition.py::test_remainder_fits_the_measured_budget
    이 실제 모델로 다시 계산한다(8개 항목 +7,000 B 초과, 총합 ≤ 32 KiB). 필드가 커지면 이 테스트가
    계약의 여유 주장이 깨진 곳을 알려 준다.
  - 구 이력(필드 없음)은 v1로 읽히고 remainder를 추정으로 채우지 않는다. 재결속도 하지 않는다.
  - 배포 영향: 구 서버는 v2를 422로 거부하므로 클라이언트가 schema_versions=[1]을 보고 스스로
    v1로 내린다. 서버와 클라이언트를 동시에 올릴 필요는 없지만, 클라이언트를 먼저 올리면 번역
    포함은 저장되지 않고 경고만 보인다.
  - 알려진 한계(모델 계열 전환): **TRANS06에서 수정됨(§1 TRANS06 참조).** 수정 전에는
    App.changeBuilderFamily가 applied를 null로 비워 activeInclusions가 빈 목록을 돌려주었고,
    포함한 번역이 패널에서 사라지며 새 계열 초안을 적용하면 remainder 없는 v1로 기록됐다.
    최종 프롬프트에 이미 붙은 영어는 그대로 남았다(기록에서 빠지는 문제였고 프롬프트에서
    빠지는 문제가 아니었다). 포함 목록을 계열 전환 너머로 유지하려면 소유권 규칙을 바꿔야
    한다는 판단은 맞았고, TRANS06이 epoch를 추가해 그 규칙을 바꿨다.
```

### TRANS06 — 모델 계열 변경이 적용 기록을 잃지 않게 · 구현 완료 · 브라우저 검증 완료

- 선행: TRANS05. **근거: TRANS05가 남긴 알려진 한계**(모델 계열 전환 시 포함한 번역이 패널에서 사라지고 다음 적용이 v1로 내려가던 문제). U11의 실제 브라우저 확인에서 드러난 회귀다.
- 원인: `App.changeBuilderFamily`가 `applied`를 `null`로 비웠다. 그러면 `activeInclusions`가 `owner === null`을 "다른 구성"으로 읽어 빈 목록을 돌려주고, 다음 적용은 `remainder` 없는 v1 스냅샷을 기록했다. 화면에서는 적용 상태 문구까지 사라져서 사용자는 기록이 없어진 것처럼 보였다.
- 수정: 계열 변경은 **초안만** 버리고 적용 기록은 유지한다(`withReboundFamily`). `appliedForFamily`가 계열을 검사하므로 서버로 다른 계열 구성이 나가지 않는다. "아직 적용 전"과 "처음부터 다시 시작"을 구분하기 위해 `compositionEpoch`를 추가했고, `activeInclusions`는 `list.epoch === epoch && list.owner === applied`일 때만 로컬 목록을 쓴다. `restartBuilder`/`restoreComposition`만 epoch를 올린다.
- 표시: `appliedStatus`가 `familyChanged`를 새로 돌려주고, 상태 패널은 "모델 계열 변경 · 기록 유지"와 함께 패널이 왜 남는지, 다시 적용하면 같은 번역으로 새로 기록된다는 것을 한 문장으로 밝힌다.
- 금지: 계열 변경에서 `applied`를 비우는 것. `owner === null`만으로 로컬 목록을 유지하는 것(재시작과 구분되지 않음). v1 스냅샷에 `remainder`를 만들어 넣는 것.

**구현 인계 (2026-11-19)**

```text
TRANS06 / 구현 완료 · 브라우저 검증 완료 / 2026-11-19 / 기준 HEAD 16f3a34 + 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  - frontend/src/prompt/remainderInclusion.ts: InclusionList에 epoch 추가,
    EMPTY_INCLUSIONS = { owner: null, epoch: 0, items: [] },
    activeInclusions(list, applied, epoch)가 epoch→owner 순으로 판정하고 아니면
    applied.remainder(v2 한정)로 넘어간다.
  - frontend/src/prompt/builderState.ts: compositionEpoch 추가, restartBuilder 신설,
    restoreComposition(composition, epoch = 0)이 epoch+1로 단조 증가, withReboundFamily가
    applied/provenance를 보존하고 result/generatedFrom/generatedMode만 비운다,
    appliedInclusions(state)가 v2 기록의 번역을 돌려준다.
  - frontend/src/prompt/presentation.ts: AppliedStatus에 "familyChanged" 추가.
    appliedStatus가 applied.target_family !== family일 때 가장 먼저 이 값을 돌려준다.
  - frontend/src/App.tsx: changeBuilderFamily가 withReboundFamily를 쓰고, reuse 경로는
    restoreComposition(..., compositionEpoch) 또는 restartBuilder로 분기한다.
  - frontend/src/components/PromptBuilder.tsx: setRemainder·적용 경로·baseRemainder가
    compositionEpoch를 함께 넘기고, 상태 패널이 familyChanged 전용 문구를 보여 준다.
  - 사용자 동작: 계열을 바꿔도 "포함한 번역" 패널과 출처가 남고, 그 계열에서 다시 적용하면
    같은 번역이 remainder로 다시 기록된다(v2). 최종 프롬프트와 초안 폐기 규칙은 그대로다.
보존한 계약:
  - v1 스냅샷은 여전히 remainder를 얻지 않는다. 계열 변경 후 재적용이 v1이 되는 것은 포함이
    없을 때뿐이고, 포함이 있으면 v2다.
  - appliedForFamily가 계열을 검사하므로 다른 계열 구성이 제출 본문에 실리지 않는다.
  - epoch는 단조 증가한다. restore/restart만 올리므로 "적용 전 포함"은 같은 세션으로 남고
    "다시 시작"은 이전 목록을 물려받지 않는다.
실행한 명령과 결과:
  - node --experimental-strip-types --test 'frontend/tests/*.test.mjs' → 184 pass / 0 fail
    (prompt-remainder-inclusion·prompt-presentation에 TRANS06 회귀 추가).
  - .venv/bin/python -m pytest backend/tests -q → 374 passed / 96 skipped.
  - npx tsc -b → 통과. npx eslint . → 무경고. npx vite build → 성공.
  - .venv/bin/ruff check backend/app backend/tests → All checks passed.
  - CHROME_PATH="Microsoft Edge" sh scripts/prompt-composer-browser/verify.sh
    → 255 checks / 0 failed (신규 TRANS06 30건 포함).
변이 검증(테스트가 실제로 회귀를 잡는지):
  - App.tsx를 withReboundFamily({ ...old, applied: null }, ...)로 되돌리면 브라우저 검사가
    12건 실패한다(패널 유지·출처 보존·"재적용은 v2로 기록"=1). 단위 테스트도 함께 실패한다.
    원복 후 재실행해 255/0을 확인했다.
  - MetadataModal의 v2 나머지 블록을 비활성으로 되돌리면 prompt-metadata-modal.test.mjs가
    실패한다. activeInclusions의 epoch 조건을 빼면 remainder 단위 테스트가 실패한다.
브라우저 검사 내용(scripts/prompt-composer-browser/suite-trans06.mjs, 신규):
  - 번역 제안 → 포함 → 적용 → 계열 변경 → 패널/출처 유지 → 새 계열에서 재적용 → 제출 본문 확인.
  - 마지막 POST /jobs 본문을 그대로 읽어 schema_version=2, target_family=flux2,
    remainder[0]의 source_ko/suggested_en/proposal_id/proposal_model/accepted_at,
    draft_prompt에 번역이 없다는 것, 최종 prompt가 번역으로 끝난다는 것을 검사한다.
  - 화면 상태만이 아니라 실제 요청 본문을 보므로 "화면은 맞는데 저장은 v1"인 회귀도 잡는다.
미검증:
  - 실제 LLM이 만든 번역의 품질·문장 적합성은 여전히 미검증이다(LIVE02/EVAL-UX02).
    이 검사는 페이지 안에서 번역 응답을 stub으로 주입하며, 그 사실을 코드 주석에 남겼다.
  - 실제 DB·자산 이력 화면에서의 v2 왕복은 U12 회귀 범위다.
다음 태스크가 알아야 할 사실:
  - suite-contracts.mjs §N의 capabilities stub이 앞 섹션(§M)의 빈 200 스텁을 감싸므로
    prompt_composition을 복원해 주지 않으면 v2/번역 경로가 통째로 사라진다. TRANS06 착수 중
    발견해 고쳤다(주석으로 이유를 남김).
  - run.mjs의 프로필 정리는 maxRetries가 필요하다. 브라우저 종료 직후 rmSync가 ENOTEMPTY로
    실패해 성공한 실행이 실패처럼 보였다.
```

### U12 보강 — 실제 DB·이력 왕복과 stub/실연결 구분 · 2026-11-20

무엇을 닫았나: TRANS06까지 남아 있던 "v2 왕복은 단위 테스트로만 확인했고 실제 DB·자산 이력 화면에서는 미검증"을 두 층으로 닫았다. **TRANS01–06의 구조는 건드리지 않았다** — 추가한 것은 테스트·하네스·문구뿐이다.

- 백엔드 재시작 경계 3건(`backend/tests/test_prompt_composition.py`, 15 → 19):
  - `test_a_v2_record_survives_a_server_restart` — 같은 `data_dir`로 앱을 두 번 띄운다. job 행·`GET /assets/{id}/metadata`·sidecar 세 곳에서 `remainder`와 `source_ko`/`suggested_en`/`proposal_id`/`proposal_model`/`accepted_at` 5개 필드가 그대로인지 확인.
  - `test_a_restored_v2_job_retries_across_a_restart_with_its_translations` — 재시작 뒤 retry가 spec 컬럼의 구성을 deep-copy로 가져오며 재컴파일하지 않고, 최종 prompt에 번역이 정확히 1회 남는지.
  - `test_a_restarted_server_still_refuses_a_v1_body_with_remainder` — v1+`remainder` 422 가드가 프로세스 상태가 아니라 검증 규칙으로 다시 로드되는지.
- 브라우저+실제 SQLite 23건(`scripts/prompt-composer-browser/suite-u12.mjs`, §S–V): 번역 stub으로 v2 생성 → 제출 → metadata 조회 → 갤러리 `정보`/`프롬프트 구성 이력` → `이 설정으로 다시 생성` 복원 → **페이지 새로고침 후 이력 재확인** → 취소한 v2 작업 카드의 `재시도`. 이력 화면은 `.asset` 카드 텍스트의 자산 ID 접두사로 **해당 자산을 특정**해 연다 — 첫 카드를 클릭하면 앞 섹션이 남긴 자산을 읽어 거짓 실패가 난다(실제로 처음에 그렇게 실패했고, 그래서 ID로 찾도록 고쳤다).
- 표시 결함 1건 수정: v2 복원 시 패널 제목이 "과거 복원 · 적용 정보 기록 없음"인데 바로 아래에 포함 번역과 출처가 표시됐다. `presentation.ts`의 `unknownApplicationCopy()`로 v2+번역 있음 / 그 외를 분리했고, v1 문구는 그대로다. 검사 2건 추가 + 브라우저 검사 1건 추가.
- stub/실연결 구분: `run.mjs`가 `results.json` 첫 항목에 `증거 출처`(engine·llm·storage·claim)를 쓰고, **fake 엔진인데 llm을 stub으로 표시하지 않으면 실행을 거부**한다. `scripts/live02_proposals.py`는 `prompt_proposals`를 광고하지 않는 서버에서 exit 2로 거부하고 파일을 쓰지 않는다.

실행한 명령과 결과:
  - `.venv/bin/python -m pytest backend/tests -q` → **377 passed, 96 skipped**.
  - `node --test 'frontend/tests/*.test.mjs'` → **186 pass / 0 fail**(184 → 186).
  - `CHROME_PATH="…/Microsoft Edge" … sh scripts/prompt-composer-browser/verify.sh` → **278 checks, 0 failed**(255 → 278).
  - `npx tsc -b`, `npx eslint .` → 통과. `git diff --check` → 통과.
  - `ruff check backend scripts` → `scripts/inspect-db-service-references.py`(F821)·`scripts/test-verify-candidate-run.py`(I001) 2건. **둘 다 이번에 수정하지 않은 기존 파일**이며 `git status`에 없음을 확인했다.

변이 검증(테스트가 실제로 잡는지):
  - 시작 시 저장된 v2 행을 조용히 v1로 내리는 mutation → **새 재시작 검사 2건만 실패, 기존 17건은 전부 통과.** 이 경계가 없으면 그 회귀는 잡히지 않는다는 증거다.
  - retry에서만 `remainder`를 떼는 mutation → retry 검사 2건 실패.
  - `unknownApplicationCopy`의 v2 분기를 끄는 mutation → frontend 185/1 실패.
  - enqueue에서 `prompt_composition`을 통째로 버리는 mutation → 10건 실패(광범위하므로 위 두 변이가 더 정밀한 증거다).

미검증으로 남긴 것:
  - **실제 LLM 번역 품질**: 이 환경에 `STUDIO_ADMISSION_URL`·gate·GPU가 없어 LIVE02를 실행하지 않았다. 위 23건은 페이지 stub 번역문이며 품질 주장이 아니다.
  - 운영 배포본(REL03)·구 바이너리 호환(REL02).

## 2. 남은 보완 태스크

아래 태스크는 TRANS01–06과 독립적이거나 후속이다. TRANS가 사전 밖 구절을 다루는 동안 이들은 사전 안쪽 정확도(RULE03)·적용 안내(VAR03)·실연결 검증(LIVE/EVAL)·종료(U12)를 맡는다.

### RULE03 — 활용형·별칭 누락을 최소 범위로 보완 · 대기

- 선행: RULE02. **연결: LLM-R02를 먼저 수행한다.** LLM-R02가 사전 mirror에 `label_ko`/`aliases`를 싣고 카탈로그에 노출하므로, alias를 추가하면 규칙 경로와 LLM 경로가 같은 어휘를 얻는다. alias를 먼저 넣고 mirror를 나중에 손대면 같은 파일을 두 번 연다. 연결: EVAL02/AUDIT-A3(이 사례를 중복 작업하지 않음).
- 근거: 기준선 사례 4–7의 `앉은`/`서 있다`/`흰 배경` 등 누락. `흰 배경`→`단색 배경`만으로 색까지 보존됐다고 볼 수 없음.
- 수정: alias 또는 matcher 중 근거가 있는 최소 범위와 테스트. dictionary 변경 시 버전·서버 mirror 생성/동기화 영향까지 기록.
- 완료: 추가한 alias별 양성/반례, 색·시점·자세 중 사전으로 표현 못 하는 의미는 미반영으로 유지. 기존 스냅샷 재결속 금지. F·B 및 필요한 사전 교차 검증. 기준선 숫자를 맞추기 위한 기대값 삭제 금지.

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

- **하네스 준비 완료(2026-11-20), 실행은 환경 대기**: `scripts/live02_proposals.py`. 12장면 `selection_hint` + 3개 구절 `remainder_translation`을 **각 1회씩, 재시도 없이** 호출하고 지연·provider 봉투·제안/거절 개수·원문 번역을 그대로 기록한다. 사람이 판단해야 하는 항목(의미 보존·자연스러움·누락)은 `human_review: null`로 남겨 스크립트가 품질을 주장하지 못하게 했다.
- **이 환경에서 실행 불가**: `STUDIO_ADMISSION_URL`·`STUDIO_LLM_MODEL` 미설정, gate 리스너 없음, GPU 없음. 실행하면 서버가 `prompt_proposals`를 광고하지 않으므로 스크립트가 **exit 2로 거부하고 파일을 쓰지 않는다**. 가짜 엔진으로 띄운 실제 서버에 대고 시험해 이 거부가 동작함을 확인했다(§3 검증 기록). 즉 stub 결과가 실연결 증거로 둔갑할 경로가 없다.
- 선행: LIVE01 **및 LLM-R01·R02·R03·R04·R05**. 운영/GPU 사용은 기존 승인 범위를 확인하고 범위 밖이면 실행하지 않음. fake/stub을 실연결 증거로 대체 금지.
- 근거: 이 선행 조건은 2026-11-18 리뷰 결과다. 부정 가드가 규칙 경로보다 약하고, 카탈로그에 한국어 어휘가 없고, 부분 변경이 현재 선택을 숨기고, 요청 상한 단위가 어긋나고, `finish_reason`이 모델 자기신고인 상태에서 측정하면 **모델 품질 결함과 하네스 결함을 구분할 수 없다**.
- 실행: 이미지 생성이 없는 허용된 환경에서 selection_hint, partial_change, situation_variants 각 요청 1개부터 순차 확인. alias·모델 버전·지연·schema 거절·취소·불가 상태 기록. 모델 버전은 **서버가 봉투에서 읽은 값**(LLM-R05)으로 기록하고 모델 자기신고 값은 진단으로만 병기. API 키/원문 사용자 로그는 기록하지 않음.
- 완료: 실제 응답과 최종 미적용 상태 보존, 범위/잠금/미반영 안내 검증. 실패는 원인별 작은 후속 태스크로 남김. 코드 구현 완료와 실제 품질 검증 완료를 분리.

### EVAL-UX02 — 실제 LLM 평가와 사용자 효율 측정 · 대기

- **평가 항목 준비 완료(2026-11-20), 실행은 LIVE02 대기**: 요청하신 4개 축을 LIVE02 산출물에 그대로 대응시켰다.
  - **한국어 원문 의미 보존**: `remainder_translation[].human_review.meaning_preserved`(스크립트가 채우지 않고 null로 남긴다 — 스크립트가 의미를 판정할 수 없다).
  - **번역 누락**: 같은 항목의 `unresolved_spans`·`rejected`와 응답 `translations` 개수를 원문 구절 수와 비교. LIVE02가 이미 원자료를 기록한다.
  - **이미지 프롬프트 적합성**: `human_review.natural_english` + `human_review.notes`. 이미지 품질 자체는 QUALITY01/02로 분리 유지.
  - **모델별 결과 차이**: LIVE02를 모델(alias)별로 실행해 `environment.advertised`·`provider`·`ms`와 위 판정을 모델 키로 비교. 모델 버전은 LLM-R05에 따라 **서버가 봉투에서 읽은 값**을 쓰고 모델 자기신고는 진단으로만 병기한다.
- 선행: LIVE02, METRIC01. EVAL-UX01의 남은 완료 조건을 승계. 규칙 기준선은 archive에 보존.
- 실행: 같은 12장면으로 실제 모델 응답의 ID 적중·부정·귀속·잠금 준수·원치 않은 추가와 미반영을 비교. 사람이 입력부터 승인까지 수행한 시간·클릭·보정과 의견을 별도 수집. 스텁 후보 품질을 모델 품질로 표시하지 않음. **현재 브라우저 하네스의 번역문은 페이지 stub이므로 EVAL-UX02의 분모가 될 수 없다**(`results.json`의 `증거 출처` 항목이 이를 명시).
- 완료: 실제 모델/설정/분모/실패 사례/사용자 의견. 사람이 없으면 사람 측정 부분은 대기. 품질 우위·최적성은 비교 없이는 주장하지 않음. 이미지 품질은 QUALITY01/02 별도.

### U11 — 현재 화면의 사용자 확인 · 사용자 확인 대기

- 실행: 현재 설명 입력→규칙/AI 제안→수락/부분 변경/상황 후보→미리보기→적용 흐름을 텍스트로 설명하고 실제 사용자 의견 기록. 360/390px·데스크톱의 실제 관찰/미검증 구분. RULE/VAR 보완 후 영향 부분은 다시 확인.
- 완료: 반영/보류 결정과 이유. 기존 화면 계측을 최신 소스의 실측으로 재사용하지 않음. 무응답은 승인 아님. 캡처를 필수로 요구하지 않음.
- **자동화로 덮인 부분(2026-11-19, 2026-11-20 갱신)**: `scripts/prompt-composer-browser/`가 CDP로 실제 브라우저를 구동해 **278건**을 검사한다(`verify.sh`, Edge로 실행). TRANS06 흐름(번역 제안→포함→적용→계열 변경→유지→재적용→제출 본문)과 U12 흐름(제출→저장 조회→이력 화면→복원→새로고침→재시도)은 이제 자동 검사가 있고, 변이 검증으로 그 검사가 회귀를 실제로 잡는다는 것까지 확인했다(§1 TRANS06 인계, §1 U12 보강). **남은 것은 화면을 사람이 읽고 판단하는 확인**(문구의 자연스러움, 단계 순서가 사용자에게 납득되는지)이며, 이것은 자동 검사로 대체할 수 없다. U12가 찾은 문구 결함은 자동 검사가 잡을 수 있는 종류였지만, "자연스러운가"는 여전히 사람 몫이다.

### U12 — 정합성 회귀와 범위별 종료 · 대기

- 선행: RULE01–03, METRIC01, VAR03, LLM-R01–R07 및 U11. **TRANS01–06을 구현했다면 그 회귀도 포함한다.** 실연결/품질을 포함한 전체 기능 종료는 LIVE02/EVAL-UX02 증거도 필요.
- **부분 완료(2026-11-19)**: TRANS 계열 회귀는 U12의 두 항목으로 앞당겨 처리했다. (1) MetadataModal 표시는 `frontend/tests/prompt-metadata-modal.test.mjs`가 실제 React SSR로 렌더해 v2 출처·포함 번역·초안/최종 차이 설명을 검사한다(소스 grep이 아니라 렌더 결과를 보므로 죽은 분기의 문구에 속지 않는다). (2) `activeInclusions`·`withReboundFamily`·`appliedStatus`의 v1/v2·epoch 규칙은 단위 테스트와 CDP 브라우저 검사로 덮였다.
- **DB 왕복 완료(2026-11-20)**: 남아 있던 "실제 DB·자산 이력에서의 v2 왕복"을 두 층으로 닫았다.
  - **프로세스 재시작 경계(B, `backend/tests/test_prompt_composition.py` 3건 추가, 19 pass)**: 기존 v2 테스트는 모두 **행을 쓴 앱에서 다시 읽었기 때문에** "저장됨"과 "기억됨"을 구분하지 못했다. 그래서 같은 `data_dir`로 앱을 다시 띄워 job 행·asset metadata·sidecar 세 곳에서 `remainder`와 5개 출처 필드가 그대로인지 확인한다(`test_a_v2_record_survives_a_server_restart`). 재시작 뒤 retry가 spec 컬럼의 `remainder`를 그대로 복사하는지(`..._retries_across_a_restart_...`), v1+`remainder` 422 가드가 프로세스 상태가 아니라 검증 규칙으로 다시 로드되는지(`..._still_refuses_a_v1_body_...`)도 포함한다.
  - **변이 검증**: 시작 시 저장된 v2 행을 v1로 "정리"하는 그럴듯한 mutation을 넣으면 **새 3건 중 2건만 실패하고 기존 17건은 전부 통과**한다. 즉 이 경계는 재시작 없이는 잡히지 않으며, 테스트가 실제로 그 구멍을 메운다는 증거다.
  - **실제 브라우저+실제 SQLite(S, `suite-u12.mjs` 23건)**: 번역 stub으로 v2를 만들어 제출 → `GET /assets/{id}/metadata` 응답 → 갤러리 `정보` → `프롬프트 구성 이력` 표시 → `이 설정으로 다시 생성` 복원 → **페이지 새로고침 후 이력 재확인** → 취소한 v2 작업의 카드 `재시도`까지 확인한다. 전체 278검사/0실패.
- **U12가 찾은 표시 결함(수정 완료)**: v2 기록을 복원하면 패널 제목이 "과거 복원 · 적용 정보 기록 없음"인데, 바로 아래에 포함한 번역과 번역 출처(모델명·제안 ID)가 표시됐다. 기록이 실제로 가진 사실을 부정하는 문구였다. `unknownApplicationCopy(schemaVersion, recorded)`로 분리해 **v2+번역 있음**은 "적용 문자열 미기록 + 번역 N건과 출처는 기록됨", v1·번역 없음은 기존 문장을 그대로 유지한다(구조 변경 없음, 문구만). 단위·브라우저 검사와 변이 검증(185/1)으로 고정했다.
- 실행: F·B·S·P·D 및 제안 provider/API 테스트. 같은 소스에서 이미 통과한 검사는 재사용 범위를 기록. 저장 스냅샷·retry·최종 직접 수정·원문 보존 확인. [LLM 경로 리뷰 보관본](archive/prompt-composer/2026-11-18/LLM_PATH_REVIEW_AND_R01_R07.md)의 정본/사본 표(부정·잠금·그룹·충돌)가 코드 주석과 일치하는지 대조한다.
- 완료: 로컬 구현/실연결/사용자 검증/운영/GPU 상태를 각각 기록. 미검증을 완료 archive로 숨기지 않음. 완료한 자식 상세만 archive로 옮기고 남은 태스크 유지.
- **남은 U12 범위**: 위 두 층은 **fake 엔진 + 페이지 stub 번역문**이다. 실제 provider가 쓴 번역문으로 같은 왕복을 확인하는 것은 LIVE02/EVAL-UX02다. 또한 운영 배포본(REL03)·구 바이너리 호환(REL02)은 여전히 미실행이다.

### 캡처 없는 인계

`태스크·HEAD / 위→아래 화면 순서 / 빈·로딩·오류·수락 후 상태 / 버튼명과 효과 / 변하지 않아야 할 데이터 / 포커스 / 테스트 결과 / 실제 DOM·크기 관찰 또는 미검증 / 다음 ID`를 기록한다. 소스 기반 예상 배치를 브라우저 관찰로 쓰지 않는다. 현재 도구 접근 규칙을 준수한다.

## 3. 운영 릴리스·배포 최적화 (UX 이후)

아래 태스크는 각 행이 독립된 작업 명세다. `문서`는 지정 주제의 결과 파일 신규 작성 또는 기존 문서 갱신을 뜻한다.

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| REL01 / 대기 | P5-L01, U12 | ACTIONS_DEPLOYMENT에 목표 커밋·구/신 API 호환·코드/DB 백업·복원 명령·health 확인 표 작성. 운영 실행 없음 | deploy-release.sh와 실제 명령 대조, 비밀값 없이 실행 가능한 릴리스 체크리스트 |
| REL02 / 대기 | P5-L01, REL01 | 격리 Fake 환경에서 구 capability/구 이력·새 이력/HTTP 한도·재사용/retry 확인. 테스트와 결과 문서만 | S·P 및 호환 시나리오 표. 구 바이너리의 JSON 읽기를 추측하지 말고 실제 결과 기록 |
| REL03 / 환경 대기 | P5-L01, REL02 | 사용자 승인 범위 확인 후 운영 사전 점검·배포·롤백 관찰. 서버 접근/승인이 없으면 실행하지 않음 | 정확한 릴리스·설치기 해시·백업 위치·서비스 결과. 실제 롤백 미실행이면 미검증 유지 |
| DEP01 / 대기 | DEPLOY-OPT01, U12 | ACTIONS_DEPLOY_OPTIMIZATION에 last-success/실서버 상태/실패 후 push/force push/수동 실행의 결정표 작성 | 비교 불명 시 전체 실행, 변경 누락 없는 사례 표. workflow 수정 없음 |
| DEP02 / 대기 | DEPLOY-OPT01, DEP01 | 순수 경로 분류 helper와 단위 테스트만 작성. frontend/backend/common/unknown·rename/delete 분류 | lock/config/workflow/API 공유 변경은 보수적 처리. classifier만으로 deploy skip 결정 금지 |
| DEP03 / 검토 대기 | DEPLOY-OPT01, DEP02 | 부분 아티팩트 vs 검증된 재사용의 설치·백업·복구 설계 및 시간 측정 계획 | 서버 installer 변경 범위/해시 배포 절차/캐시 키와 비밀값 변경 무효화. 설계 검토 전 CI skip 활성화 금지 |

## 4. 계약·모델 품질·토큰

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

## 5. Scene v2·참조 이미지 설계와 LLM 태스크 연결

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| SCENE01 / 대기 | P7-S01, U12 | scene.ts 및 P5 설계를 읽고 actor/공통 환경/관계의 예시 JSON 문서 작성 | 단일/다인/귀속 불명 예시, v1은 자동으로 특정 actor에 귀속하지 않음 |
| SCENE02 / 검토 대기 | P7-S01, SCENE01 | v1 보존·명시 변환·구 클라이언트 읽기·복구 설계 | 저장 버전/마이그레이션 영향 보고. schema 구현 없음 |
| IMAGE01 / 대기 | P7-I01, U12 | upload/권한/보관·조건 전처리·엔진 입력의 요구사항 표 작성 | ControlNet/IP-Adapter/img2img 각각 현재 capability와 필요한 새 계약 분리 |
| IMAGE02 / 검토 대기 | P7-I01, IMAGE01·SCENE01 | 참조 자산 연결·실패 복구·GPU 메모리 평가 계획 | 실제 모델/엔진 검증 전 지원 약속 금지. 업로드 API 구현 없음 |

## 6. LLM 자동화 후보·규칙 평가

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

## 7. 접근성·플랫폼 잔여 검증

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| AT01 / 환경 대기 | P5-C03-AT, U09 | 실제 브라우저 200% 확대 및 360/390px와 소프트 키보드 확인 | viewport 축소와 실제 zoom을 구분. 가려진 입력·적용 버튼·focus clipping의 증거. 결함은 이 문서의 새 보완 태스크로 환류 |
| AT02 / 환경 대기 | P5-C03-AT, U09 | 실제 보조기기에서 이름·상태·오류·분류·선택 해제 낭독 검증 | OS/브라우저/스크린리더·실행 순서·관찰 기록. 자동 axe만으로 대체하지 않음 |
| PLATFORM01 / 대기 | TEST-PLATFORM01 | 기존 실패 보고에서 48개 실패의 파일/실패명/최초 예외/OS 기능 의존 목록 정리 | 문서의 기존 분류를 가설로 취급. 전체 실패를 자동으로 환경 탓으로 닫지 않음. 기존 실패를 숨기는 skip 추가 금지 |
| PLATFORM02 / 환경 대기 | TEST-PLATFORM01, PLATFORM01 | 격리 Linux/Fedora에서 같은 커밋·의존성·명령 실행 후 비교 | 0건 확인 또는 실제 결함별 후속 ID 생성. 운영 서비스/권한 변경 없이 실행 가능한 환경 필요 |
