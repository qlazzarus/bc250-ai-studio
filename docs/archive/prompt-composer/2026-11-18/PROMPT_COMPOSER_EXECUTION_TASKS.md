> 2026-11-18 보관본 (`03a2fa5`). 완료 표시는 당시 검증 범위에 한정한다. 현재 활성 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다.

# 사전 프롬프트 단일 실행 태스크

갱신일: 2026-11-18 · 실행 계획 기준: HEAD `ad0901a`(UX01–UX05·VERIFY01/02 반영) + VAR02·EVAL-UX01 미커밋 변경 위. 과거 검증의 기준 소스는 각 인계 기록을 따른다. **사전 프롬프트의 활성 상태·선행 조건·완료 기준은 이 문서에서만 관리한다.** CURRENT는 구현 설명, P5/LLM 문서는 계약·설계 참고자료이며 별도 진행표로 사용하지 않는다.

완료된 구현·검증의 상세 기록은 [2026-11-17 archive](../2026-11-17/README.md), 이전 단계는 [2026-11-16 archive](../2026-11-16/README.md)에 있다. archive의 상태는 당시 주장이고 현재 완료 판정은 아래를 따른다.

## 현재 판정과 우선순위

- 코드 대조 결과 GAP01(포커스 복귀), GAP02(정보/주의/오류 분리), GAP03(전체 목록 + 대상 시작 버튼)는 구현됐다. U01–U08의 진행 기록은 archive로 이동했다.
- GAP04/U09/U10은 기존 58개 검사 통과 기록에 더해 VERIFY01/VERIFY02의 판정 강화를 완료했다(브라우저 103/103, 2회 연속). 남은 것은 **U11 사용자 화면 확인**과 그 뒤의 U12다.
- 현재 최우선 실행: **U11 → U12**. UX01–UX05는 구현·브라우저 검증이 끝났고 사용자 화면 의견만 남았다. **LLM-C01·C02(제안 계약, gate·인증·저장 경계)는 완료**했고 서버 제안 구현(LLM-I01 → I02 → I03), 프론트 요청 상태(LLM-I04), 제안 카드·명시적 수락(LLM-I05), 부분 변경·되돌리기(LLM-I06), 여러 상황 후보의 비영속 계약(VAR01), 상황 카드 비교·선택(VAR02)도 완료됐다. **EVAL-UX01도 규칙 모드 기준으로 실행을 마쳤다**(12장면, recall 76.3 %, precision 91.2 %, 실패 9건 기록). 남은 선행은 여전히 **U11 사용자 화면 확인**이며, EVAL-UX01은 그 의견을 대신하지 않는다. 실제 확대/보조기기는 AT01/AT02, GPU/운영은 별도 후속이다.
- **화면은 이제 AI 제안을 카드로 보여주고, 사용자가 누른 항목만 선택에 반영한다 — capability가 있을 때만.** `POST /api/v1/prompt/proposals`는 인증·한도·실패 분리가 테스트로 고정됐고, 프론트는 capability가 광고될 때만 "장면 정리하기" 버튼을 만든다. 원문에서 찾은 항목·AI 추가·미표현 구절·모호 표현이 카드로 구분되고, 일괄 수락은 원문 근거가 있는 항목만 포함한다. 같은 자리의 `장소와 행동만 바꾼 상황 3개` 버튼은 장소·행동만 바꾼 상황 후보를 받아 비교하게 하고, 카드의 `적용`을 누르면 선택만 바뀌며 한 단계 되돌리기가 붙는다. 수락·적용은 원문과 최종 프롬프트를 바꾸지 않는다. 실제 LLM 호출·모델 품질 검증은 여전히 없다.
- 원래 상위 ID와 아래 자식 ID는 같은 작업의 묶음이다. 부모 완료는 모든 필수 자식의 증거가 있을 때만 갱신한다.
- Actions 최적화 DEP01–DEP03과 플랫폼 PLATFORM01–PLATFORM02는 사전 프롬프트 자체 기능이 아닌 공통 의존 작업이다. 요청 이력 보존을 위해 이 문서의 후속 표에 남기며 UX 완료와 혼동하지 않는다.

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
| F | `node --experimental-strip-types --test frontend/tests/*.test.mjs` | 기존 61건 기준. 데이터·컴파일러·P5·규칙 제안·LLM 제안 상태 회귀. Python/Pydantic 교차 검증 의존성 필요 |
| B | `npm --prefix frontend run build` 및 `npm --prefix frontend run lint` | TS·번들·정적 검사 |
| S | `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh` | Studio 131건 기준. 전체 저장소 pytest와 구분 |
| P | `.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_coordination_capability.py -q` | 구성 저장과 capability 회귀 |
| D | `git diff --check` | 변경 형식 검사 |

기존 건수는 기준선이지 고정 성공 조건이 아니다. 실패 시 실패 이름·명령·환경·원인을 남긴다. 문서만 바꾼 태스크는 링크/명세 검증과 D로 충분하다. 코드 수정 시 해당 동작을 검증하는 테스트를 추가하되 JSX 문자열 검사나 구현 복사 테스트로 UI 검증을 대체하지 않는다.

각 태스크 끝에 아래 인계를 추가한다.

```text
ID / 상태 / 날짜 / 기준 HEAD:
변경 파일과 사용자에게 달라지는 동작:
보존한 계약:
실행한 명령과 결과:
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰 (캡처 선택, 관찰 없으면 미검증):
미완료·위험·다음 태스크가 알아야 할 사실:
```

## 1. 최우선: P6-UX-R2 남은 검증

### VERIFY01 — 키보드·계열 전환 검사의 판정 강화 · 완료

- 선행: UX05. 연결: GAP04/U09/U10. 수정: `scripts/prompt-composer-browser/suite-keyboard.mjs`, `suite-contracts.mjs`, 필요한 최소 driver/결과 기록. 제품 코드는 결함이 재현되었을 때 별도 근거를 남겨 수정.
- 확인된 갭: `suite-keyboard.mjs:23`은 `backward.length === 3`만 확인한다. 키 입력이 실패해도 기록이 세 번 쌓이면 통과한다. `suite-contracts.mjs:110`은 계열 전환 후 문자열 길이만 검사해 실제 최종 입력 보존을 보장하지 못한다. `applyDisabled`는 수집만 하고 판정하지 않는다.
- 실행: Tab 전진 경로의 요소 식별자를 저장하고 Shift+Tab 후 예상 역순 요소와 비교. 계열 전환 전후 최종 문자열의 정확한 일치, stale 초안 적용 불가, 재생성 후 진행 가능을 검사.
- 완료: 정상 경로 통과와 잘못된 초점/변경된 문자열/활성 stale 적용을 거부하는 판정 근거. 360/390px·데스크톱 실제 브라우저 환경·입력·예상·실제 결과 기록. 브라우저를 실행하지 못하면 미검증 유지.
- 반영: `suite-keyboard.mjs`는 전진 4정지점의 `tag:id:label:text` 식별자를 만들고 Shift+Tab 4회 결과를 역순 배열과 문자열 비교한다(개수 검사 아님). `suite-contracts.mjs`는 계열 전환 전후 최종 textarea 값을 **문자열 완전 일치**로 비교하고 `applyDisabled`를 판정에 넣었다. stale 초안은 `suite-messages.mjs`에서 “설명 수정 후 초안 재생성 또는 적용 차단”과 “옛 초안으로 최종 프롬프트를 덮어쓰지 않음”으로 판정한다.
- 제품 결함 1건 수정: 마지막 칩 제거·`대상부터 고르기`의 검색 포커스가 커밋 전 `requestAnimationFrame`에 걸려 접힌 `details` 내부로 가는 경우가 있었다. `PromptBuilder.tsx`에서 `focusTick` 상태 + 커밋 후 effect로 옮기고 `id="prompt-search"`를 부여했다. 회귀 판정은 `waitSearchFocus`/`waitAdjustOpen` 폴링으로 관찰한다.
- 실행 결과: `sh scripts/prompt-composer-browser/verify.sh` 2회 연속 **103/103 통과**(HEAD 변경 전 기준 89건 + 신규 14건). 키보드 Tab/Shift+Tab 기록은 `results.json`의 INFO 행에 남는다.
- 남은 한계: `applyDisabled`가 `null`(적용 버튼 미노출)인 경우도 “적용 불가”로 인정한다. 버튼이 없을 때 비활성 상태를 별도로 만들지 않는다.

### VERIFY02 — 누락 시나리오와 검증 범위 정정 · 완료

- 선행: VERIFY01. 연결: GAP04/U10. 수정: 브라우저 suite·fake fixture·검증 결과 자료. 운영 데이터 사용 금지.
- 확인된 갭: 현재 suite-contracts의 “generation and retry”는 완료 작업 생성·복원만 확인한다. 실패 작업의 retry 버튼/API 경로는 검사하지 않는다. 같은 계열 `fake-sd15 → fake-sd15-alt` 및 capability 요청 실패(현재 빈 응답 미지원만 있음)의 검증 근거도 없다.
- 실행: 실패 작업 fixture로 retry 요청/결과 및 구성 스냅샷 보존 확인. 같은 계열 모델 전환의 최종 입력·선택·적용 상태 보존 확인. capability 네트워크 실패 시 직접 생성 경로 유지 확인.
- 완료: 행별 예상/실제/증거. 기존 HTTP 422/413은 fetch 대체에 따른 UI 거절 처리 시험임을 명시하고 실제 서버 한도 검증과 분리. 재시도 버튼 활성만으로 실제 retry 성공을 주장하지 않음. 기존 58건을 새 실행 결과로 재사용하지 않음.
- 반영: 계약 스위트에 L2(계열 전환) · L3(같은 계열 `fake-sd15 → fake-sd15-alt`) · L4(재시도) · L5(capability 네트워크 실패)를 추가했다.
  - L3: 같은 계열 전환 후 모델 id 변경, 최종 프롬프트·선택 칩·초안 유지 여부를 각각 판정한다.
  - L4: fake 엔진은 실패를 주입할 수 없으므로 **실제 취소**로 종료 상태를 만든다. `verify.sh`가 `STUDIO_FAKE_DELAY=2`를 주어 취소가 완료와 경쟁하지 않게 했다. 카드에 `cancelled` 배지와 `재시도` 버튼이 있는지 확인한 뒤 **카드 버튼을 실제로 클릭**하고, `retry_of`로 새 작업이 생겼는지와 `prompt`/`model_id` 보존을 API로 재확인한다.
  - L5: `Page.addScriptToEvaluateOnNewDocument`로 `/system/capabilities` fetch를 `reject`시킨 뒤 새로고침해, 직접 입력 경로가 유지되는지 확인한다.
  - 테스트 인증: 앱 토큰이 읽을 수 있는 전역이 아니므로 `run.mjs`가 앱이 보내는 `Authorization` 헤더를 캡처(`window.__authHeader`)해 스위트가 같은 자격으로 API를 호출한다. 이 처리 이전 시도는 401로 “미검증” 분기에 빠졌고, 그 사실을 PASS로 세지 않는다.
- 실행 결과: 재시도 준비 `{created:202, cancel:200, terminal:"cancelled"}` → 카드 클릭 후 새 작업 `retry_of` 생성, `prompt="retry probe"`, `model_id="fake-sd15"` 확인. capability 실패 `{notice:true, builder:true}`. 전 항목 포함 **103/103 통과**(2회 연속).
- 범위 정정: 기존 HTTP 422/413 검사는 fetch 대체로 UI 거절 표시만 확인하며 실제 서버 본문 한도 검증이 아니다. 완료 판정에도 그 문구를 유지했고, 서버 한도는 별도 항목으로 남긴다.

### U11 — 사용성 비교와 사용자 화면 확인 · 사용자 확인 대기

- 선행: UX01–UX05 및 VERIFY01/VERIFY02. 수정: 이 문서의 결과 인계 및 증거 자료.
- 기존 8개 선택 비교 계측은 [과거 UX_LAYOUT §7](../2026-11-17/PROMPT_COMPOSER_UX_LAYOUT.md)에 보존했다. GAP01–GAP03 이후 현재 화면의 새 계측으로 취급하지 않는다.
- 실행: 현재 화면의 데스크톱/360/390px에서 탐색·장면 요약·원문 반영·미리보기·적용 흐름을 제시하고 사용자 의견 기록. 새 변경이 수치에 영향을 주면 동일 장면으로 다시 측정하고 기준 소스를 명시.
- 완료: 사용자의 화면 의견과 반영/보류 결정 기록. 무응답은 승인 아님. 문서 좌표 거리를 사용자 스크롤 왕복 감소로 환산하지 않음. 1열 구조는 기존 실측 채택안이며 2열 자체를 완료 조건으로 되살리지 않음.

### U12 — 정합성 회귀와 상위 종료 · 대기

- 선행: VERIFY01/VERIFY02 및 U11 완료. 기존 GAP01–GAP03을 다시 구현하지 않음.
- 실행: F·B·S·P·D, 저장 스냅샷·retry·직접 생성의 변경 영향 확인. 이번 대조에서 통과한 검사는 추가 변경이 없으면 재사용 가능하나 범위와 시점 명시.
- 완료: P6-UX-R2 필수 자식의 실패/미검증·사용자 의견을 정리하고 완료 기록을 archive로 이동. 이 문서에서는 완료 상세를 제거하고 다음 활성 작업을 명시. 운영 배포/GPU/보조기기 검증을 함께 완료로 표시하지 않음.

## 1A. 설명 우선 UX와 LLM 장면 제안 — 실행 명세

사용자 방향 합의(2026-11-17): 한국어 설명 → 장면 구성 제안 → 부분 수정 → 명시적 적용 → 생성. 여러 상황을 쉽게 묘사하는 것이 목표다. 이 절의 신규 작업은 기본이 **대기**이며, 완료로 표시된 항목(UX01–UX05, LLM-C01)만 문서와 검증 근거가 있다. 문서 추가는 구현 완료가 아니다. Terra medium/DeepSeek 4.1 Flash 중 어느 실행자에게도 한 ID씩 동일하게 전달한다.

### 캡처 없이 구현할 화면 명세

아래는 **목표 화면의 텍스트 설계**이며 현재 터널 화면을 관찰한 기록이 아니다. 터널 `localhost:18080`과 브라우저 연결은 이전 시도에서 접근하지 못했다. 캡처를 작업 착수 조건으로 삼지 않는다.

```text
[모델 선택: 현재 선택 유지]
[어떤 장면을 만들까요?]
[한국어 설명 입력, 3~5줄]
[예시: 일상 / 제품 / 풍경]  [사전 항목 제안] 또는 지원 시 [장면 정리하기]
[제안 상태: 준비 / 정리 중·취소 / 확인 필요 / 실패·다시 시도]
[장면 구성: 대상 | 행동 | 장소·시간 | 구도 | 분위기]
  각 행: 한국어 설명 / 원문 근거 또는 AI 추가 표시 / 수정
  사전에서 표현할 수 없는 내용: 원문 그대로 표시 + 아직 초안 미반영
[세부 조정 ▸]  ← 기존 사전 검색·분류·선택 칩, 기본 접힘
[프롬프트 확인: 한국어 요약] [영어 초안 펼치기 ▸]
[최종 프롬프트에 적용]  [적용 상태]
[최종 프롬프트 직접 편집] → [이미지 생성]
[작업 큐: 실행 n / 대기 n] → 펼쳐 작업·실패 확인
```

- 한 입력만 사용한다. 기존 `scene.freeTextKo`를 상단으로 옮기고 원문/추가 설명 입력창을 중복 생성하지 않는다. 기존 별도 보관/원문 포함 설정은 초안 영역에서 유지한다.
- 첫 구현에서 모델 선택, form 제출 경계, 최종 입력, 생성 버튼의 순서는 유지한다. 기본 사전 모드는 언제든 접근 가능하며 숨겨진 필수 선택을 만들지 않는다.
- 데스크톱 목표: 장면 편집을 주 영역으로, 큐는 접을 수 있는 보조 영역으로 둔다. 360/390px은 한 열이며 가로 스크롤 없이 버튼 줄바꿈. 특정 px 높이나 sticky 적용 바는 기본 요구가 아니다.
- 한국어 요약은 선택/승인된 내용에서만 만든다. LLM이 없는 단계에서 상황을 이해했다고 표시하거나 영어 초안을 역추정해 출처를 만들지 않는다.
- 실제 LLM 미연결 시 버튼은 `사전 항목 제안`; 지원 확인 후에만 `장면 정리하기`. 테스트 fixture를 실제 LLM 결과로 표시하지 않는다.

### 공통 예시와 보존 기준

| 입력 | 반드시 보존할 내용 | 금지할 추정 |
| --- | --- | --- |
| 비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람 | 우산 접기와 기다리기, 장소·시간 | 기다리는 친구를 화면 속 두 번째 인물로 자동 추가 |
| 안경 없이 짧은 머리의 사람 | 부정 표현과 외형 | 부분 일치로 안경 선택 |
| 빨간 옷을 입은 사람이 파란 옷을 입은 사람에게 책을 건넨다 | 두 인물의 의상 귀속·행동 방향 | Scene v1의 공통 의상 목록으로 의미가 보존됐다고 주장 |
| 흰 배경 위 유리병 제품, 글자 없이 | 제품·재질·배경·문자 제외 | 인물·브랜드명 추가 |
| 같은 인물과 의상을 유지하고 장소만 바꿔줘 | 승인된 인물·의상 값 고정 | 설정 고정을 이미지의 동일 인물 보장으로 표현 |

사전 밖 표현·부정·관계를 손실 없이 담는 새 계약은 LLM-C01(완료, C01-1–C01-8)과 C02(완료, gate·인증·저장 경계)에서 검토했다. C01 확정 결과 v1은 사전 항목만 선택으로 승격하므로, 원문에 보존하고 미반영을 알리는 현재 동작이 유지된다. 자동 번역을 기존 `verbatim`으로 가장하지 않는다.

### UX01 — 원문 입력을 장면 구성의 시작으로 이동 · 완료

- 선행: 없음. 읽기: PromptBuilder, builderState, CURRENT. 수정: PromptBuilder와 styles(필요시 작은 presentational 컴포넌트).
- 실행: 원문 textarea를 탐색 목록 위로 이동, 라벨 `어떤 장면을 만들까요?`, 예시 placeholder 적용. 규칙 제안 버튼을 바로 아래 배치. 기존 `free-text-help`/오류 연결과 반영 모드 보존.
- 완료: 입력은 하나, 원문 수정 시 기존 자동 초안 계산 유지, 최종 입력 자동 덮어쓰기 없음. 빈 입력·4000/4001자·saved 복원·separate/verbatim을 F·B 및 상태별 텍스트 관찰표로 확인.
- 결과: 브라우저에서 단계 순서(설명 → 요약 → 세부 조정 → 초안) 및 첫 입력 `free-text-ko` 확인. 원문 수정 시 초안이 자동 갱신되며 최종 프롬프트는 적용 전까지 불변.

### UX02 — 사전 탐색을 세부 조정으로 접기 · 완료

- 선행: UX01. 수정: PromptBuilder/styles.
- 실행: 검색·분류·체크박스 목록을 `세부 조정` disclosure에 배치. 선택 요약과 미반영 안내는 접힌 영역 밖. `대상부터 고르기`는 disclosure 열기 → subject 필터 → 검색 포커스까지 수행.
- 완료: 필터 밖 선택 유지, 개별/전체 삭제 포커스가 숨겨진 검색으로 이동하지 않도록 disclosure 열기 또는 보이는 대체 초점 정의. 키보드 동작·aria-expanded·선택 순서 불변 확인. F·B; 실제 초점 미관찰은 검증 대기.
- 결과: 접힘 상태에서 탐색 입력이 닫힌 `details` 안에 있음을 확인. 개별 제거는 다음/이전 칩으로, 마지막 제거·전체 비우기는 `세부 조정`을 연 뒤 검색 입력으로 이동. `aria-expanded`/`aria-controls="jobs-body"`(작업 큐)와 칩 그룹 순서 고정 확인. 포커스 커밋 타이밍 결함 1건 수정(VERIFY01 참조).

### UX03 — 작업 큐를 접어 장면 작업 폭 확보 · 완료

- 선행: UX02. 수정: App의 최소 wrapper/표시 상태와 styles. 큐 처리/폴링/JobCard 로직 변경 금지.
- 실행: 큐 제목에 실행/대기 건수를 표시하고 접기 제공. 빈 큐는 기본 접힘, 실행·실패 여부는 접혀도 보임. 사용자의 펼침 선택을 폴링마다 초기화하지 않음. Studio 전용 class로 큐 접힘 시 폼이 가용 폭 사용.
- 완료: Pixel/갤러리 전역 레이아웃 미변경, 작업 추가·실패·retry 접근 유지. 1280/390/360px의 DOM 순서·예상 줄바꿈 기술 및 B. 실제 폭/겹침/확대는 관찰 전 미검증.
- 결과: 초기 상태 `{toggle:"펼치기", footnote:"실행 0 · 대기 0 · 완료 0 · 실패 0", cards:0}`, 첫 작업 후 `aria-expanded="true"`로 자동 펼침. 360/390px에서 가로 넘침 없음과 1열 순서, 적용 버튼 노출(360px 284×36, 390px 314×36) 확인.

### UX04 — 한국어 장면 요약과 영어 초안의 역할 분리 · 완료

- 선행: UX03. 수정: presentation/PromptBuilder 및 대응 테스트.
- 실행: 현재 선택의 한국어 라벨로 대상·행동·장소·구도·분위기 요약. 없는 값은 `지정 안 함`. 원문은 별도 원문 표시로 보존. 영어 초안은 상세로 접되 적용 버튼·주의·오류·원문 포함 여부는 항상 노출.
- 완료: source/mapping 없는 내용 추정 금지, 비어 있는 요약이 원문 전체를 이해했다는 인상 금지. 과거 초안 열기만으로 재컴파일하지 않음. F·B와 상태 표.
- 결과: 요약 7행(선택 없는 행 `지정 안 함`), 선택한 3행만 칩 보유, 원문 문자열 불변 확인. 영어 초안은 기본 접힘이고 적용 버튼은 접힘 밖. 설명만으로 요약이 채워지지 않음을 확인.

### UX05 — 예시로 입력 시작하기 · 완료

- 선행: UX04. 수정: 작은 예시 데이터 파일/PromptBuilder 및 동작 테스트.
- 실행: 일상·제품·풍경의 프로젝트 작성 한국어 예시 3개. 빈 입력에는 클릭하여 삽입. 기존 원문이 있으면 교체 확인과 취소 제공. 예시 선택은 LLM/이미지 생성 호출을 하지 않음.
- 완료: 원문 교체 시 기존 stale/apply 정책 유지, 최종 prompt는 보존. 취소 시 전체 상태 불변. F·B. 사용자 원문/로그를 예시로 수집하지 않음.
- 결과: 예시 3개(일상/제품/풍경) 노출, 기존 입력 시 확인창 1회 호출과 취소 시 입력 유지, 적용 시 56자 삽입, 작업 생성 호출 0회 확인. 예시 파일은 `frontend/src/prompt/examples.ts`.

### LLM-C01 — 제안과 미반영 의미의 계약 결정 · 완료

- 기존 LLM01을 이 태스크로 흡수. UX 작업과 독립적으로 조사 가능. 수정: 이 문서에 결정/예시 추가, 필요시 LLM_AUTOMATION 설계 본문. 별도 태스크 문서 금지.
- 실행: 입력 원문·family·현재 선택·요청 revision, 출력의 기존 사전 ID/원문 근거/선택적 추가/미반영 구절/모호함을 정의. 없는 ID, 부정, 다인 귀속, 출처 없는 추가의 거절·보류 표 작성.
- 구체적 결정: 사전 ID로 표현 가능한 제안만 v1에 적용. 표현 불가능한 행동·관계·번역은 별도 제안 상태에 보존하고 의미 손실을 알림. 확장 제안의 저장·컴파일 필요성 및 대안을 보고. JSON 길이/개수/추가 필드 제한 명시.
- 완료: 위 공통 예시별 요청/응답/수락 결과가 있음. Scene/API/컴파일 출력 의미 변경안을 코드로 먼저 구현하지 않음. 합의된 계약 없이는 LLM-I01 시작 금지.

#### C01-0. 선행 조건 판정

- UX01–UX05, VERIFY01/VERIFY02 완료. C01은 **선행 없음**(1A절 "UX 작업과 독립적으로 조사 가능"과 동일).
- 이번 작업은 **문서만** 수정했다. endpoint·Pydantic 모델·프로바이더·Scene·컴파일러·사전 데이터는 변경하지 않았다.
- `LLM-I01`은 이 계약 확정 후에만 시작한다. `LLM-C02`(gate·인증·저장 경계)는 이 계약을 참조한다.

#### C01-1. 확정한 계약 경계 (v1)

아래 6개는 v1에서 바꾸지 않는다. 근거는 현재 코드에서 확인한 사실이다.

| # | 결정 | 근거(현재 코드) |
| --- | --- | --- |
| 1 | 최종 프롬프트는 항상 `compileScene`이 만든다. LLM 출력은 문자열을 대체하지 못한다 | `compiler.ts` `COMPILER_VERSION = "1.3.0"`, 순수 함수 |
| 2 | `free_text_ko`는 불변. 번역·보강은 별도 제안 필드에만 존재 | `scene.ts` `SceneSpecification.freeTextKo` |
| 3 | 제안은 **사전 ID만** 담는다. 수락·저장에 쓰이는 문구는 사전에서 다시 읽고, `matched_phrase`는 근거 표시용으로만 쓴다 | `dictionary.ts` `validateDictionary()` (중복 ID·빈 라벨 거부) |
| 4 | 적용은 명시적. 수락 시 저장되는 것은 `id` 목록 + `proposal_id`이고 문구는 사전에서 다시 읽는다 | `builderState.ts` `withAppliedDraft`, `restoreComposition` |
| 5 | Scene v1은 actor(인물별 귀속)를 표현하지 못한다 | `scene.ts` `SelectionSnapshot`에 actor/귀속 필드 없음 |
| 6 | 사전 매칭은 **문자열 부분 일치**만이다. 의미 유사도·동의어 추론 없음 | `dictionary.ts` `searchDictionary`, `proposals.ts` `text.includes(label)` |

결정 6의 결과로 사전에 없는 개념은 v1에서 **선택으로 승격될 수 없다**. 새 항목·번역·관계는 `unresolved_spans`로만 남는다.

#### C01-2. 요청 계약

```json
{
  "kind": "selection_hint | partial_change",
  "request_id": "uuid-v4",
  "target_family": "sd15",
  "dictionary_version": "1.2.0",
  "free_text_ko": "…원문 그대로…",
  "selections": [{ "id": "subject.person", "category": "subject" }],
  "locked_ids": ["appearance.short_hair"],
  "target_groups": ["setting"],
  "revisions": { "scene": "sha256:…", "selection": "sha256:…", "text": "sha256:…" },
  "limits": { "max_suggestions": 8, "max_unresolved": 8 }
}
```

| 필드 | 규칙 |
| --- | --- |
| `kind` | v1은 `selection_hint`, `partial_change` 2개만. `translation`·`attribute_split`은 **v1 미지원**(422가 아닌 `status: "unsupported_v1"`) |
| `request_id` | 클라이언트 발급. 응답 rev와 함께 오래된 응답 폐기 판정에 쓴다(LLM-I04) |
| `revisions.*` | 현재 상태 해시. 응답이 같은 값을 돌려주고 불일치하면 적용을 막는다 |
| `selections` | 최대 100개(`CompositionSelection` 상한과 동일). `id`는 현재 사전에 존재해야 한다 |
| `locked_ids` | `partial_change`에서만. 이 ID는 어떤 제안에도 등장할 수 없다 |
| `target_groups` | `partial_change`에서만. `GROUP_ORDER`(subject…mood) 값만 허용 |
| `free_text_ko` | 최대 4,000자, NUL 금지. 시스템 지시와 분리된 user 데이터로만 전달 |

#### C01-3. 응답 계약

```json
{
  "proposal_id": "uuid-v4",
  "request_id": "…요청과 동일…",
  "status": "ready | empty | unavailable | unsupported_v1",
  "kind": "selection_hint",
  "provider": { "model": "…", "version": "…", "latency_ms": 812, "finish_reason": "stop" },
  "revisions": { "scene": "sha256:…", "selection": "sha256:…", "text": "sha256:…" },
  "suggestions": [
    { "id": "lighting.neon", "matched_phrase": "네온", "basis": "quote",
      "polarity": "affirmed", "actor": null, "confidence": 0.82, "reason_ko": "조명 조건" }
  ],
  "unresolved_spans": [
    { "text": "우산을 접으며", "why": "no_dictionary_entry", "polarity": "affirmed" }
  ],
  "ambiguities": [
    { "text": "그 사람", "why": "actor_unknown", "candidates": ["subject.person"] }
  ],
  "rejected": [{ "raw_id": "lighting.glow", "why": "not_in_dictionary" }],
  "truncated": false
}
```

| 필드 | 규칙 |
| --- | --- |
| `status: "unavailable"` | gate 실패·timeout·JSON 불일치. **오류가 아닌 안내**로 UI에 전달하고 사전/직접 생성은 그대로 동작 |
| `status: "empty"` | 유효 제안 0건. 정상 종료이며 실패가 아니다 |
| `basis: "quote"` | `matched_phrase`가 `free_text_ko`의 **실제 부분 문자열**. 기본 일괄 수락에 포함 가능 |
| `basis: "inferred"` | 원문에 근거 문자열이 없음. 표시만 하고 **기본 일괄 수락에서 제외**(LLM-I05 요구) |
| `polarity` | `affirmed`/`negated`. `negated`는 선택으로 승격 불가 |
| `actor` | v1은 항상 `null`. 값이 오면 `attribution_unsupported_v1`로 거절 |
| `unresolved_spans.text` | 원문에서 잘라낸 **그대로의 문자열**. 각 200자, 최대 8개 |
| `ambiguities` | 해소하지 않는다. 사유와 후보 ID만 남기고 선택은 바꾸지 않는다 |
| `confidence` | 0~1. 규칙 모드의 `0.05–0.98` 점수와 달리 **모델 확률**이며 서로 비교하지 않는다 |

#### C01-4. 거절·보류 결정표

| 상황 | 판정 | 저장/표시 | 근거 |
| --- | --- | --- | --- |
| 사전에 없는 `id` | **거절** | `rejected[].why = "not_in_dictionary"` | 결정 3. 화이트리스트 없으면 환각 항목이 UI에 도달한다 |
| 비활성(`active: false`) ID | **거절** | `why = "inactive_entry"` | `proposals.ts`가 이미 비활성 항목을 제외한다 |
| 이미 선택된 ID | **제외**(거절 아님) | 응답에서 생략 | `suggestSelections`의 `selected` 제외와 동일 결과 |
| 부정 표현(`없이`, `아닌`, `안 `, `못 `, `말고`, `빼고`, `제외`) | **보류** | `polarity: "negated"` → `unresolved_spans` | 실측: `안경 없이 짧은 머리의 사람`에서 규칙 엔진이 `appearance.glasses`를 제안하는 **오탐**을 확인했다. 표지는 `matched_phrase` 뒤쪽 8자에서만 찾는다(C01-6 #2) |
| `polarity` 충돌(LLM `affirmed` + 검증기 부정 표지) | **보류**(보수적) | `why = "polarity_conflict"` | 두 신호가 다르면 채택하지 않는다(fail closed) |
| 다인 귀속 제안(`actor` 지정, "빨간 옷의 사람") | **보류** | `why = "attribution_unsupported_v1"` + `ambiguities` | 결정 5. Scene v1은 공통 목록만 갖는다 |
| `kind: "attribute_split"` | **미지원** | `status: "unsupported_v1"` | A6는 P7 Scene v2 승인 선행 |
| 잠긴 ID(`locked_ids`) 변경 | **거절** | `why = "locked"` | 부분 수정은 잠금 위반 응답을 폐기해야 한다 |
| `target_groups` 밖 제안 | **거절** | `why = "out_of_scope"` | `조명만 변경` 요청이 다른 그룹을 바꾸면 안 된다 |
| 원문에 없는 추가(`basis: "inferred"`) | **표시만** | 기본 일괄 수락 제외 | 출처 없는 추가는 사용자가 개별 선택해야 한다 |
| `finish_reason != "stop"` | **불완전** | `status: "unavailable"`, 부분 결과 폐기 | `docs/LLM_GATE.md`: Qwen은 `length` 종료 시 잘린 응답이다 |

#### C01-5. 크기·개수·추가 필드 제한

| 항목 | 값 | 이유 |
| --- | --- | --- |
| 제안 JSON 전체 | **16 KiB** 초과 시 `truncated: true` + 초과분 폐기 | 구성 객체 32 KiB·요청 65,536 B보다 작게 두어 제안이 본 요청을 밀어내지 않게 한다 |
| `suggestions` | 최대 **8** | 현 `suggestSelections` 기본 `maxSuggestions = 8`과 동일 |
| `unresolved_spans` | 최대 **8**, 각 200자 | 표시 영역·검토 비용 상한 |
| `ambiguities` | 최대 **8** | 동일 |
| `rejected` | 최대 **12** | 관측용. 초과분은 개수만 남긴다 |
| `reason_ko` | 80자 | 한 줄 표시 |
| `matched_phrase` | 2–40자 | `proposals.ts` `MIN_PHRASE = 2` |
| 알 수 없는 필드 | **거부**(`extra="forbid"`) | 기존 `PromptComposition`·`JobRequest`와 동일 정책 |

`truncated` 판정 순서: ① 필드별 상한으로 자른다 → ② 남은 객체를 직렬화해 16 KiB를 넘으면 뒤쪽 `suggestions`/`unresolved_spans`부터 버린다 → ③ 하나라도 버렸으면 `truncated: true`. 잘린 항목은 조용히 사라지지 않고 UI에 "제안 일부를 표시하지 못했습니다"로 안내한다.

#### C01-6. 공통 예시별 요청/응답/수락 결과

"현재 규칙 엔진(실측)" 열은 이 저장소에서 실제로 실행해 얻은 값이다(`suggestSelections` + `compileScene`, family `sd15`, 사전 1.2.0). LLM 응답은 **아직 얻지 않았다** — 계약상 판정이며 실제 모델 출력의 품질 근거가 아니다.

| # | 입력 | 현재 규칙 엔진(실측) | 계약상 응답 | 수락 결과(실측 초안) |
| --- | --- | --- | --- | --- |
| 1 | 비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람 | `subject.person(사람)` | `suggestions=[subject.person/quote/affirmed]`, `unresolved=[비 오는 밤, 편의점 앞, 우산을 접으며]`, `친구`는 **`subject.two_people`로 승격 금지** | `a person` — 우산·대기·편의점·비는 미반영으로 표시 |
| 2 | 안경 없이 짧은 머리의 사람 | `appearance.short_hair`, **`appearance.glasses`(오탐)**, `subject.person` | `suggestions=[short_hair, person]`, `unresolved=[안경 없이/negated]`, `glasses` → `rejected: negated` | `a person, short hair` — "안경 없이"는 초안에 반영되지 않음을 명시 |
| 3 | 빨간 옷을 입은 사람이 파란 옷을 입은 사람에게 책을 건넨다 | `subject.person(사람)` | `suggestions=[subject.person]`, 의상은 `attribution_unsupported_v1`로 보류, `unresolved=[빨간 옷, 파란 옷, 책을 건넨다]` | `a person` — **두 인물의 의상 귀속은 보존되지 않음**을 명시. "보존됐다"고 주장 금지 |
| 4 | 흰 배경 위 유리병 제품, 글자 없이 | 없음 | `suggestions=[]`, `unresolved=[유리병 제품, 글자 없이/negated]`, `setting.plain_background`는 `basis: "inferred"`(표시만) | 초안 변화 없음. 인물·브랜드명은 사전에 없으므로 **추가 불가** |
| 5 | 같은 인물과 의상을 유지하고 장소만 바꿔줘 | `subject.person(인물)` | `kind=partial_change`, `locked_ids=[현재 인물·의상 선택]`, `target_groups=["setting"]`, 잠금 위반 `locked`, 범위 밖 `out_of_scope` | 기존 초안·최종 입력 불변. "동일 인물 보장"이 아니라 **설정 고정**임을 표시 |

판정 근거 보충:

- `#1`의 `친구`: `subject.two_people`의 라벨은 `두 사람`, 별칭은 `두 명`·`2인`이다. "친구를 기다리는"은 화면 밖 인물의 언급이므로 두 번째 대상이 아니다. v1은 **명시적 수량 표현이 있을 때만** 다인 대상을 승격한다.
- `#2`의 부정 규칙: 검증기는 `matched_phrase` **뒤쪽 8자 이내**에서 부정 표지를 찾는다. 한국어는 명사 뒤에 표지가 붙으므로(`안경 없이`, `긴 머리가 아닌`) 앞쪽은 보지 않는다. 앞뒤 대칭으로 보면 `짧은 머리`가 `없이`에 걸려 오탐하므로, `짧은 머리`는 채택되고 `안경`만 보류된다. 표지가 있으면 LLM이 `affirmed`라 해도 채택하지 않고 `polarity_conflict`로 보류한다. 이 규칙은 현재 규칙 엔진에 **없는** 결함을 계약으로 막는 것이며, LLM-I01의 `test_negation_guard_only_holds_the_negated_noun`이 고정한다.
- `#3`의 의상: `clothing.white_shirt`·`clothing.black_shirt`는 존재하지만 Scene v1에는 "누가 입는지" 필드가 없다. 두 사람 모두에게 적용하면 의미가 왜곡되므로 선택 대신 원문 보존을 택한다.
- `#4`의 `글자 없이`: 부정이지만 대상 항목도 사전에 없다. 따라서 `negated` span으로만 남고 negative_prompt 자동 주입은 하지 않는다(컴파일러 출력 의미 변경 금지).
- `#5`의 잠금: `locked_ids`는 **설정 고정**이며 생성 이미지의 동일 인물을 보장하지 않는다. UI 문구도 그렇게 써야 한다.

#### C01-7. 확장 제안의 저장·컴파일 필요성 (보고)

| 확장 후보 | v1 필요성 | 현재 대안 | 결정 |
| --- | --- | --- | --- |
| 새 사전 항목(우산, 편의점, 유리병, 책) | 사전 파일 수정 | `unresolved_spans`로 원문 보존 + `verbatim` 반영 모드 | **v1 계약 변경 없음.** 사전 확장은 A1/A3 별도 승인 |
| 부정 속성(안경 없이) | 저장 필드 필요 | 선택하지 않고 원문 보존 | **Scene v1 확장 금지.** `negative_prompt` 자동 주입 안 함 |
| actor별 의상·행동 귀속 | Scene v2 필요 | `ambiguities` + 원문 보존 | **SCENE01/02 승인 전 구현 금지** |
| 번역(`kind: "translation"`) | 컴파일러 출력 의미 변경 | `verbatim`은 원문을 그대로 붙임. 자동 번역으로 가장 금지 | **v1 미지원으로 거절** |
| 영속 저장(`proposal_id` 이력) | `jobs.spec` 확장 필요 | 비영속. 응답을 메모리에만 보관 | **C02에서 저장 경계 결정**. v1은 job 스키마 변경 없음 |

컴파일러(`COMPILER_VERSION 1.3.0`)의 정렬·충돌·렌더 규칙은 **변경하지 않는다**. 수락된 ID만 `SceneSpecification.selections`에 들어가고 나머지는 지금과 동일하게 `unresolved`로 남는다.

#### C01-8. LLM-I01이 옮겨야 할 fixture (계약 고정)

| fixture | 기대 판정 |
| --- | --- |
| 공통 예시 1–5 | C01-6 표의 계약상 응답과 동일 |
| 없는 ID(`lighting.glow`) | `rejected: not_in_dictionary`, 422 아님 |
| 8개 초과 제안 | `truncated: true`, 8개만 채택 |
| 16 KiB 초과 응답 | `truncated: true`, 초과분 폐기 |
| `matched_phrase`가 원문에 없음 | `basis: "inferred"`로 강등 |
| `finish_reason: "length"` | `status: "unavailable"` |
| `actor` 지정 제안 | `attribution_unsupported_v1` |
| 잠긴 ID 재제안 | `locked` |
| 부정 표지 + `affirmed` | `polarity_conflict` 보류 |

#### C01-9. 인계

```text
LLM-C01 / 완료(문서 계약) / 2026-11-17 / 기준 HEAD: ad0901a + 미커밋 문서 변경
변경 파일과 사용자에게 달라지는 동작: docs/PROMPT_COMPOSER_EXECUTION_TASKS.md(계약·결정표·fixture 목록), docs/PROMPT_COMPOSER_LLM_AUTOMATION.md(확정 위치 안내·상한 정정). 화면·API·저장 동작 변화 없음.
보존한 계약: Scene v1, PromptComposition(extra=forbid, 32 KiB, 선택 100, 초안 8000자, 자유 입력 4000자, 미변환 101), compiler 1.3.0, 사전 1.2.0, proposal 엔드포인트 미구현.
실행한 명령과 결과: 문서 검토 + 규칙 엔진/컴파일러 실측(공통 예시 5건, suggestSelections·compileScene) + D(git diff --check) exit 0.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: 이 태스크는 UI 변경이 없어 브라우저 검증 대상 아님. 미검증으로 남기는 항목은 아래와 같다.
미완료·위험·다음 태스크가 알아야 할 사실:
- C01은 "합의된 계약"을 기록한 단계다. 사용자 승인 없이 LLM-I01을 착수하지 않는다.
- 실측 결함: 규칙 엔진(suggestSelections)은 "안경 없이"를 "안경"으로 매칭해 부정을 무시한다. 이번 태스크는 문서만 고쳤으므로 코드는 여전히 오탐한다. 수정은 LLM-I01 validator 범위이며, 그 전에는 UI에 "부정 표현 미반영" 안내가 없다.
- 실측 한계: 공통 예시 3(다인 의상 귀속)은 어떤 조합으로도 보존 불가. "의미 보존"으로 표시하면 안 된다.
- LLM 응답 품질·수락률·지연은 전혀 측정하지 않았다. fixture는 계약 검증용이다.
- C02는 이 문서의 C01-1·C01-5·C01-7을 입력으로 gate·인증·저장 경계를 결정한다.
```

### LLM-C02 — gate·인증·저장 경계 결정 · 완료

- 선행: LLM-C01. 기존 LLM02를 흡수. 읽기: backend/app/services/llm.py, client_gate_check.py, gpu.py, docs/LLM_GATE.md 및 기존 API 인증 경로.
- 실행: 브라우저→Studio→gate 경로와 지원 capability, 인증/timeout/cancel/응답 크기/동시 요청 정책을 명시. GPU image_priority 상태별 허용/거절 결정표 작성. 원문은 user 데이터로 전달하고 시스템 지시와 분리.
- 완료: 새 endpoint와 저장 필드가 필요한 범위·구 서버 fallback·구 데이터 unknown·rollback 대안 보고. DATA01/02와 중복 조사하지 말고 같은 결정 참조. 운영 자격증명/모델 다운로드/GPU 전환 실행 없음. 계약 검토 결과를 기록한 뒤 구현 태스크로 진행.

#### C02-0. 선행 조건과 이번 작업 범위

- 선행: C01 완료(C01-1–C01-9). C02는 그 계약을 **운반 경로·인증·저장** 관점에서 확정한다.
- 이번 작업은 **문서만** 수정했다. 새 endpoint·라우터·provider·설정 필드·DB 스키마를 만들지 않았다.
- 실행하지 않은 것: 운영 자격증명 열람, GPU 상태 전환, 모델 다운로드, gate 재기동, 실제 llama 호출. 아래는 코드에서 읽은 사실과 그로부터의 결정이며 실측 트래픽 증거가 아니다.

#### C02-1. 확정한 호출 경로 (v1)

```text
브라우저 --(Studio Bearer)--> Studio /api/v1/prompt/proposals --(loopback)--> gate:8081 --(pass-through)--> llama:8080
```

| 홉 | 인증 | 근거(현재 코드) |
| --- | --- | --- |
| 브라우저 → Studio | 기존 `Authorization: Bearer` (client/admin 키) | `routes.py` `authenticate()`, `frontend/src/api.ts`가 모든 요청에 Bearer 부착 |
| Studio → gate 프록시 | LLM 자체 API 키(있으면 `llm_api_key`) | `gate.py` `/ {path}` 는 프록시 경로에 **자체 인증이 없다**(헤더 pass-through) |
| Studio → gate 제어 | `admission_key`(=`GATE_API_KEY`) | `llm.py` `gate()`/`_owned_hold()`가 Bearer로 호출 |
| 브라우저 → gate/llama | **금지** | `capabilities`가 `integrated_chat_proxy: false`를 알리고, `docs/LLM_GATE.md`가 직접 접근 금지를 명시 |

**중요한 구분:** gate의 `/control` 인증과 데이터 경로(`/v1/chat/completions`) 인증은 **다른 것**이다. `gate.py`의 데이터 경로는 llama가 요구하는 키를 그대로 전달할 뿐 자체 검증을 하지 않는다. 따라서 제안 API를 gate에 경유시킬 때 **Studio가 유일한 인증 경계**이며, gate를 인증 프록시로 착각하면 안 된다.

#### C02-2. 인증·동시성·취소 정책

| 항목 | 결정 | 이유·근거 |
| --- | --- | --- |
| 제안 요청 인증 | Studio의 기존 Bearer만 사용. 새 API 키·새 스코프 없음 | `routes.py`의 router 전역 `Depends(authenticate)`. 브라우저는 이미 토큰을 갖고 있다 |
| gate 자격 전달 | 서버 프로세스 밖으로 내보내지 않는다. 브라우저 응답·로그에 `admission_key`/`llm_api_key` 금지 | C01-1 결정 3의 연장. `llm.py`는 설정에서만 읽는다 |
| 동시 요청 | 사용자 세션(토큰)당 **1건**. 전역 상한 **2건**(이미지 생성 중일 때는 0건) | gate는 동시성을 제한하지 않고 `waiting_requests`만 센다(`gate.py` `Admission`). Studio가 상한을 책임져야 한다 |
| timeout(응답 대기) | **20초**. 초과 시 `status: "unavailable"` | `proxy_timeout` 기본 900초는 이미지 전환용이고 제안에 쓰면 UI가 멈춘다. 브라우저 fetch에는 별도 25초 abort |
| 재시도 | 자동 재시도 없음. 사용자가 다시 누를 때만 1회 | `A5` 설계 원칙 6(온라인 1회 호출) |
| 취소 | 브라우저 `AbortController` → Studio가 gate 연결을 끊고 결과를 버린다. 서버는 취소된 요청을 저장하지 않는다 | `test_gate.py`가 확인하는 대로 gate는 클라이언트 연결이 끊기면 upstream 응답을 버린다 |
| 응답 크기 | C01-5의 **16 KiB**를 서버에서 강제(직렬화 후 검사) | gate·llama는 크기 제한을 두지 않으므로 Studio가 검사해야 한다 |
| 스트리밍 | **사용하지 않는다**. gate가 응답 전체를 버퍼링한다 | `gate.py` docstring: "deliberately buffers an upstream response" |
| 요청 본문 | Studio `max_body_bytes`(기본 65,536) 그대로 적용. 제안 요청 자체 상한은 **8 KiB** | `main.py` `BodyLimit` 미들웨어 |

#### C02-3. GPU 정책별 허용/거절 결정표

`Scheduler.mode`와 `GPUManager.blocked`/`leased`가 기준이다.

| 상태 | 판정 | UI 표시 | 근거 |
| --- | --- | --- | --- |
| `manual` + grant 대기 | **거절** | "관리자 승인 후 사용할 수 있습니다" | `runner.py:57` — grant 없으면 GPU 작업 자체가 대기 |
| `manual` + 이미지 실행 중 | **거절** | "이미지 생성이 끝난 뒤 다시 시도하세요" | `gpu.leased == True`이면 llama가 중지/일시정지 상태 |
| `chat_priority` + 이미지 실행 중 | **거절**(이미지 경계까지 대기하지 않음) | 동일 | `runner.py:155-160`은 이미지 경계에서만 양보한다. 제안이 경계를 기다리게 만들지 않는다 |
| `chat_priority` + 유휴 | **허용** | — | gate가 `paused`가 아니면 통과 |
| `image_priority` + 이미지 실행 중 | **거절** | "이미지 생성 중에는 LLM 제안을 쓸 수 없습니다" | `A5` 설계 5절. `gpu.leased`로 판정 |
| `image_priority` + 유휴 | **허용** | — | — |
| `gpu.blocked`(recovery 필요) | **전면 거절** | "GPU 복구 확인이 필요합니다" | `gpu.py` `blocked`가 true면 `acquire`도 실패 |
| gate 상태 확인 실패 | **거절**(fail closed) | 정보 안내(오류 아님) | `A5` 설계 5절 "상태 불명 → fail closed" |
| gate `paused`(hold 존재) | **거절** | "지금은 LLM을 쓸 수 없습니다" | `gate.py` `Admission.enter()`가 요청을 붙잡는다 |
| 서버가 capability 미광고 | **거절** | 기능 미노출(버튼 없음) | 아래 C02-4 |

`gpu.blocked`·`leased`·`scheduler.mode`는 이미 `/system/status`로 노출된다(`routes.py:145-160`). 제안 가능 여부는 이 응답과 capability만으로 판정하고, 서버에 새 상태 필드를 만들지 않는다.

#### C02-4. capability와 endpoint

기존 `/system/capabilities`에 **필드를 하나 추가**한다. 새 버전·새 루트를 만들지 않는다.

```json
"prompt_proposals": { "schema_versions": [1], "max_response_bytes": 16384, "timeout_ms": 20000 }
```

| 결정 | 내용 |
| --- | --- |
| 광고 조건 | `admission_url`이 설정되어 있고 `engine != "fake"`일 때만 `prompt_proposals` 필드를 싣는다. 그 외에는 필드를 **생략**한다 |
| 구 서버 동작 | 필드가 없으면 `prompt_proposals` 미지원으로 간주하고 `사전 항목 제안`(규칙 모드)만 노출한다 |
| endpoint | `POST /api/v1/prompt/proposals` — 기존 router 아래, 기존 `authenticate` 그대로 |
| 알 수 없는 `kind` | 422가 아니라 `200 {status: "unsupported_v1"}` |
| 실패 응답 | `200 {status: "unavailable", why: ...}`. 5xx로 만들지 않는다 |

`fake`에서 필드를 생략하는 이유: `engine == "fake"`는 llama가 없고 gate도 검증되지 않는다. 여기서 지원을 광고하면 UI가 항상 실패하는 버튼을 노출한다. 현재 `capabilities`가 `prompt_composition`·`request_limits`를 조건부로 싣는 방식과 같은 패턴을 쓴다.

#### C02-5. 저장 경계 (DATA01/02와 중복하지 않음)

결론: **v1은 job 저장 스키마를 확장하지 않는다.**

| 데이터 | 저장 위치 | 근거 |
| --- | --- | --- |
| `proposal_id`·`provider.model`·`accepted_at` | 저장하지 않음. 수락 시 선택 ID만 scene에 반영 | `PromptComposition`은 `extra="forbid"`이고 필드를 늘리면 `jobs.spec` 계약 변경이다 |
| 제안 응답 본문 | 비영속(메모리) | 사용자가 수락하지 않은 제안을 DB에 남길 이유가 없다 |
| 수락 결과 | 기존 `selections` + `draft_prompt` | 이미 저장되는 필드로 충분하다 |
| 원문 | 기존 `free_text_ko` | 변경 없음 |

이 결정은 `DATA01`(현재 저장/미저장 표)과 `DATA02`(확장 대안)를 **대체하지 않는다**. 제안 이력의 영속화가 필요해지면 DATA01/DATA02에서 같은 표를 참조해 별도 승인한다. C02는 "v1에서는 확장하지 않는다"만 확정한다.

비영속의 결과로 생기는 한계를 명시한다: 생성된 job의 metadata에는 어떤 제안으로 만들어졌는지 **남지 않는다**. 이 한계를 UI에서 "제안 이력은 저장되지 않습니다"로 알리거나, 알리지 않기로 하면 C01의 재현성 원칙(제안 적용 시 `proposal_id` 기록)과 충돌한다. v1 결정: **알린다**. 이력이 필요하면 사용자가 직접 설명을 남긴다(기존 `free_text_ko`).

#### C02-6. 구 서버 fallback·구 데이터·rollback

| 상황 | 동작 |
| --- | --- |
| 구 서버(`prompt_proposals` 없음) | 규칙 제안 버튼만 노출. 기능 저하를 오류로 표시하지 않음 |
| capability 요청 실패(네트워크) | 구성 저장과 동일하게 "지원 확인 실패"로 처리하고 규칙 모드 유지(VERIFY02 L5와 동일 경로) |
| gate 미설정(`admission_url` 없음) | 서버가 `enabled`를 광고하지 않으므로 클라이언트도 호출하지 않는다 |
| 구 job 데이터 | `proposal_id` 필드가 없으므로 "제안 이력 없음(unknown)"으로 표시. null을 "규칙 모드"로 해석하지 않는다 |
| rollback | Studio의 `prompt_proposals` 광고 제거 + 클라이언트 feature-detect. DB 마이그레이션 없음 |
| 저장된 job 재실행(retry) | 구성 스냅샷을 그대로 복사하는 현재 동작 유지. 제안 재호출 없음 |

**gate protocol 불일치(발견 사항, 이번에 고치지 않음):** `services/llm.py`는 `ensure_image_admission()`과 `owned_control_identity()`에서 gate status/identity의 `protocol == 3`을 요구하는데, 저장소의 `backend/app/gate_candidate.py`는 `protocol=2`를 보고한다. 즉 `admission_owned_holds=True` 경로는 현재 저장소 코드만으로는 통과하지 않는다. 이는 제안 API와 독립적인 **기존 이미지 전환 경로의 문제**이며, C02의 결정을 바꾸지 않는다. 제안 경로는 `/control`의 protocol을 요구하지 않고 `paused`/`active_requests`만 읽으므로 영향받지 않는다. 별도 확인 대상으로 남긴다.

#### C02-7. 인계

```text
LLM-C02 / 완료(문서 계약) / 2026-11-17 / 기준 HEAD: ad0901a + 미커밋 문서 변경
변경 파일과 사용자에게 달라지는 동작: docs/PROMPT_COMPOSER_EXECUTION_TASKS.md의 C02 절만. 화면·API·설정·저장 동작 변화 없음.
보존한 계약: 기존 Bearer 인증, /system/capabilities 형태(필드 추가만), PromptComposition 스키마, jobs.spec, gate 프록시 동작, BodyLimit.
실행한 명령과 결과: 소스·문서 교차 확인(backend/app/gate.py, gate_candidate.py, services/llm.py, services/gpu.py, routes.py, scheduler/runner.py, studio_config.py, frontend/src/api.ts) + D(git diff --check) exit 0.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: UI 변경 없음. 브라우저 검증 대상 아님.
미완료·위험·다음 태스크가 알아야 할 사실:
- gate의 데이터 경로에는 인증이 없다(프록시 통과). 제안 API의 인증 경계는 Studio 하나뿐이다.
- 20초 timeout·세션당 1건·전역 2건은 Studio가 직접 구현해야 한다. gate는 동시성을 제한하지 않는다.
- gate protocol 3 vs gate_candidate protocol 2 불일치는 기존 문제로 남아 있다. 제안 경로에는 영향 없다.
- 응답 16 KiB(DATA 아님, C01-5)와 요청 8 KiB 상한은 서버 구현 시점에 강제해야 한다.
- LLM-I01은 이제 착수 가능하나, endpoint·provider 연결은 LLM-I02/I03 범위다.
```

### LLM-I01 — 구조화 제안 validator와 테스트 · 완료

- 선행: LLM-C01/C02 결정 기록. 수정: 신규 제안 schema/validator 전용 모듈과 테스트(기존 job schema는 유지).
- C01 완료분: 입력/출력 schema, 거절·보류 판정표, 16 KiB·8개 상한, fixture 목록은 C01-2–C01-8에 있다. **선행 원문: C01 완료.** 나머지 선행(C02)은 gate·인증·저장 경계이며, endpoint·provider 연결은 C02 결정 전에 만들지 않는다.
- 실행: 공통 예시의 유효 응답과 없는 ID/과다 길이/중복/누락 필드/원문에 없는 근거/부정·귀속 보류 fixture 작성. 서버에서 불완전 응답을 채택하지 않음.
- 완료: fixture는 실제 LLM 품질 증거가 아님을 명시. validator 단위 테스트 통과, 응답 실패 시 원문·선택 불변. endpoint/GPU 호출 없음.

#### I01-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 신규 모듈 | `backend/app/services/prompt_proposals.py` — 순수 함수. 네트워크·DB·GPU·사전 사본 없음 |
| 테스트 | `backend/tests/test_prompt_proposals.py` — 21 passed |
| 사전 주입 | `dictionary: Mapping[str, DictionaryEntryRef]`를 호출자가 넘긴다. Python이 사전을 복제하지 않는다 |
| 기존 스키마 | `PromptComposition`·`JobRequest`·`jobs.spec` 무변경 |
| 진입점 | `evaluate(payload, request=..., dictionary=...) -> ValidatedProposal`. 예외를 던지지 않는다 |

`evaluate`는 4단계다: `parse_reply`(스키마·`request_id` 일치·전송 상한) → `validate_reply`(C01-4 결정표) → 필드 상한 → `fit_budget`(16 KiB 트리밍). 어느 단계에서든 실패는 `status="unavailable"`로 접히고 예외는 호출자에게 가지 않는다.

#### I01-1. 계약 대비 판단이 필요했던 3가지

1. **16 KiB 초과는 폐기가 아니라 트리밍이다.** C01-5는 "초과분 폐기 + `truncated: true`"이고 C01-8은 "초과분 폐기"다. 따라서 파싱 단계의 하드 상한은 별도(`MAX_PROVIDER_REPLY_BYTES = 64 KiB`, 폭주 본문 차단용)로 두고, 16 KiB는 `fit_budget`이 뒤쪽 항목부터 버려 맞춘다. 파싱 상한을 16 KiB로 두면 정상 응답이 통째로 `unavailable`이 되어 문서와 어긋난다.
2. **"8개 초과"는 스키마 오류가 아니다.** `suggestions`를 `max_length=8`로 두면 9개째에서 파싱이 실패해 "truncated로 8개 채택"을 만들 수 없다. 파싱 상한(`HARD_MAX_ITEMS = 32`)과 채택 상한(8)을 분리했다.
3. **부정 검출은 앞쪽을 보면 안 된다.** C01-6 초안의 "앞뒤 12자"는 `안경 없이 짧은 머리`에서 `짧은 머리`까지 보류시켜 예시 2의 기대(`short_hair` 채택)와 모순된다. 한국어는 명사 뒤에 표지가 붙으므로 뒤쪽 8자만 검사한다. 문서 C01-4·C01-6을 이 기준으로 정정했다.

#### I01-2. fixture 대응표 (C01-8 → 테스트)

| C01-8 fixture | 테스트 | 결과 |
| --- | --- | --- |
| 공통 예시 1–5 | `test_example_1` … `test_example_5` | 통과 |
| 없는 ID `lighting.glow` | `test_unknown_id_is_rejected_not_accepted` | `not_in_dictionary` |
| 8개 초과 | `test_more_than_eight_suggestions_keeps_the_first_eight` | `truncated: true`, 앞 8개 |
| 16 KiB 초과 | `test_oversized_reply_is_trimmed_to_the_budget` | 트리밍 + `truncated` |
| 원문에 없는 `matched_phrase` | `test_quote_that_is_not_in_the_text_is_downgraded` | `inferred` 강등 |
| `finish_reason: "length"` | `test_length_finish_discards_partial_suggestions` | `unavailable` |
| `actor` 지정 | `test_actor_suggestion_is_held_as_ambiguity` | `attribution_unsupported_v1` |
| 잠긴 ID | `test_locked_id_is_rejected_when_scope_allows_it` | `locked` |
| 부정 표지 + `affirmed` | `test_negation_guard_only_holds_the_negated_noun` | `polarity_conflict` |
| (추가) 정확히 8개 | `test_exactly_eight_suggestions_is_not_truncation` | `truncated: false` |
| (추가) 중복 | `test_duplicate_suggestions_are_rejected_once` | `duplicate` |
| (추가) 비활성 ID | `test_inactive_entry_is_rejected` | `inactive_entry` |
| (추가) 지연 응답 | `test_mismatched_request_id_is_unavailable` | `unavailable` |

**fixture는 실제 모델 출력이 아니다.** C01-6이 "LLM 응답은 아직 얻지 않았다"고 밝힌 그대로이며, 이 21건은 계약 판정의 회귀 방지 장치다. 모델이 이 형식을 실제로 지키는지는 LLM-I02의 실제 호출로만 확인된다.

#### I01-3. 인계

```text
LLM-I01 / 완료 / 2026-11-17 / 기준 HEAD: ad0901a + 미커밋 변경
변경 파일과 사용자에게 달라지는 동작:
- 신규: backend/app/services/prompt_proposals.py (사용자 동작 변화 없음, 아직 아무 라우트도 호출하지 않음)
- 신규: backend/tests/test_prompt_proposals.py (21 tests)
- 문서: docs/PROMPT_COMPOSER_EXECUTION_TASKS.md C01-4·C01-6 부정 규칙 정정 + I01 기록
보존한 계약: PromptComposition/jobs.spec/compileScene/사전/기존 API/GPU 경로 전부 무변경.
실행한 명령과 결과:
- .venv/bin/python -m pytest backend/tests/test_prompt_proposals.py -q -> 21 passed
- .venv/bin/python -m ruff check <두 파일> -> All checks passed
- git stash 후 backend/tests 전체 -> 48 failed, 293 passed (변경 전과 동일 = 기존 baseline)
- git stash pop으로 복구, git diff --check exit 0
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: UI 변경 없음. 브라우저 검증 대상 아님.
미완료·위험·다음 태스크가 알아야 할 사실:
- backend/tests 전체에 기존 실패 48건이 있다(주로 test_switch_worker 등). 이번 변경과 무관하며 stash 비교로 확인했다. 고치지 않았다.
- validator는 사전을 주입받는다. 실제 호출 경로에서 어떤 사전을 넘길지는 I02/I03에서 정해야 하며, 사전 버전 불일치 시 응답을 채택하면 안 된다.
- 부정 검출은 규칙 기반이다. "안경 안 쓴"처럼 명사와 표지가 8자를 넘게 떨어지면 놓친다. 상한을 늘리면 `짧은 머리` 오탐이 되살아나므로, 이 한계는 의도된 트레이드오프다.
- `evaluate` 실패 시 원문·선택을 건드리지 않는다는 것은 아직 호출자가 없어 코드로만 보장된다. I03에서 실제 불변을 테스트해야 한다.
- gate protocol 3 vs gate_candidate protocol 2 불일치(C02-6)는 여전히 미해결이며 I01 범위가 아니다.
```

### LLM-I02 — 서버 제안 provider와 취소·실패 처리 · 완료

- 선행: LLM-I01. 수정: 신규 provider 모듈 및 서비스 테스트, 기존 gate client는 필요한 최소 연결만.
- 실행: 원문 revision과 요청 ID를 포함한 한 번의 명시적 호출. gate 승인·timeout·취소·응답 validator 처리. 테스트는 가짜 transport로 수행, 자동 무한 재시도 금지.
- 완료: GPU 사용 불가/timeout/잘못된 JSON/취소가 분리된 결과로 반환. 이미지 생성 제어·lock 정책 변경 없음. 브라우저에 서버 비밀값 전달 금지. 실제 LLM 미호출을 품질 통과로 표시하지 않음.

#### I02-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 신규 모듈 | `backend/app/services/proposal_provider.py` — `ProposalProviderClient`(1회 호출), `build_payload`, `reply_bytes`, `availability_failure`, `data_base_url`, `proposals_enabled` |
| 테스트 | `backend/tests/test_proposal_provider.py` — 24 passed (실제 gate 앱 경유 2건 포함) |
| 호출 지점 | 아직 라우트 없음. `propose()`를 호출하는 API는 LLM-I03에서 만든다 |
| 사전 | `Mapping[str, DictionaryEntryRef]`를 호출자가 주입. provider는 사전 사본을 만들지 않는다 |
| 기존 경로 | `services/llm.py`, 이미지 job, GPU lock, scheduler 제어 **전부 무변경** |

실패 결과는 `Failure` Literal 하나로 고정했다: `not_configured`, `request_too_large`, `stale_dictionary`, `gpu_unavailable`, `admission_paused`, `gate_unreachable`, `upstream_status`, `timeout`, `cancelled`, `invalid_reply`, `busy`. `ProposalOutcome`은 `proposal`과 `failure`를 동시에 채우지 않는다.

#### I02-1. 계약 대비 판단이 필요했던 4가지

1. **`/control` URL에서 데이터 origin을 유도한다.** `STUDIO_ADMISSION_URL`은 `http://127.0.0.1:8081/control` 하나뿐이고, gate의 데이터 경로는 같은 리스너의 `/v1/...`이다. 설정을 하나 더 만들면 두 값이 어긋날 수 있으므로 `/control` 접미사를 제거해 쓴다(`data_base_url`).
2. **GPU 상태는 읽기만 한다.** `scheduler.mode`·`gpu.blocked`·`gpu.leased`는 호출자가 인자로 넘긴다. provider가 잠금·일시정지를 바꾸지 않으므로 C02-3의 "이미지 제어 변경 없음"을 코드 구조로 보장한다. `manual` 모드는 관리자 승인 없이 GPU를 빌리지 않도록 `gpu_unavailable/manual_approval`로 거절한다.
3. **동시 실행은 대기가 아니라 거절이다.** gate는 요청을 세기만 하고 제한하지 않는다. 세션 1·전역 2 상한을 provider가 `asyncio.Semaphore`로 두되, 큐잉하면 20초 예산과 사용자 인내를 모두 넘기므로 두 번째 요청은 즉시 `busy`다.
4. **timeout과 취소를 분리한다.** 둘 다 업스트림 호출을 끊지만 결과가 다르다. `asyncio.wait_for`는 `timeout`, 외부 `CancelledError`(브라우저 이탈)는 `cancelled`이고, 늦게 도착한 응답은 `task.cancel()` 후 폐기한다. 폐기하지 않으면 이미 취소한 제안이 화면에 붙는다.

#### I02-2. 실패 코드 → 테스트 대응표

| 결과 | 테스트 | 비고 |
| --- | --- | --- |
| `not_configured` | `test_fake_engine_is_not_configured` | `engine == "fake"`에서는 capability를 광고하지 않는다 |
| `request_too_large` | `test_oversized_request_is_refused_before_http`, `test_request_size_is_measured_from_the_payload_when_not_given` | 8 KiB는 라우트가 아니라 provider가 계산한다 |
| `stale_dictionary` | `test_dictionary_version_mismatch_is_refused` | HTTP 호출 0회 |
| `gpu_unavailable` | `test_gpu_states_are_refused_before_any_http` | `recovery_required`/`image_running`/`manual_approval` |
| `admission_paused` | `test_paused_gate_is_reported_without_calling_the_model` | 모델 호출 0회 |
| `gate_unreachable` | `test_unreachable_gate_is_reported_separately`, `test_malformed_gate_state_is_reported_as_a_gate_problem` | `httpx.ConnectError` / 제어 상태 형식 오류 |
| `upstream_status` | `test_upstream_status_is_not_a_gate_failure` | 게이트가 상태 코드를 그대로 전달 |
| `timeout` | `test_timeout_is_reported_and_the_late_reply_is_discarded` | 늦은 응답 미채택 |
| `cancelled` | `test_cancellation_is_its_own_result_not_a_timeout`, `test_cancelled_request_does_not_leave_a_paused_or_held_gate` | gate `active/waiting/paused` 불변 |
| `invalid_reply` | `test_broken_json_and_broken_schema_are_invalid_reply`, `test_unavailable_validator_result_is_not_adopted`, `test_provider_reply_over_the_transport_cap_is_invalid` | 64 KiB 초과·`finish_reason: length` 포함 |
| `busy` | `test_concurrency_limits_are_session_one_and_global_two` | 세션 1·전역 2 |
| 정상 | `test_ready_reply_is_adopted_and_called_exactly_once`, `test_provider_goes_through_the_real_gate_app` | POST 정확히 1회 |
| 16 KiB 트리밍 | `test_trimmed_reply_is_still_adopted_with_the_banner_flag` | 폐기가 아니라 채택 + `truncated` |

**실제 LLM은 호출하지 않았다.** 모든 테스트는 `httpx.MockTransport`/`ASGITransport`이며, 따라서 이 24건은 계약·실패 분리의 회귀 방지 장치이지 모델 품질 증거가 아니다.

#### I02-3. 비밀값 경계

- 시스템 프롬프트에는 사전 ID만 들어간다. `admission_key`·`llm_api_key`는 본문에 없다(`test_payload_keeps_the_user_text_as_data_and_lists_only_active_ids`).
- 데이터 경로에는 llama 키만 전달되고 gate 제어 키는 전달되지 않는다(`test_provider_goes_through_the_real_gate_app`).
- `free_text_ko`는 사용자 메시지로만 가고 시스템 프롬프트로 승격되지 않는다(프롬프트 주입 차단).

#### I02-4. 인계

```text
LLM-I02 / 완료 / 2026-11-17 / 기준 HEAD: I01 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: backend/app/services/proposal_provider.py (아직 어떤 라우트도 호출하지 않으므로 사용자 동작 변화 없음)
- 신규: backend/tests/test_proposal_provider.py (24 tests)
- 문서: docs/PROMPT_COMPOSER_EXECUTION_TASKS.md I02 기록
보존한 계약: services/llm.py, 이미지 job, GPU lock, scheduler 제어, compileScene, 사전, 기존 API 전부 무변경.
실행한 명령과 결과:
- .venv/bin/python -m pytest backend/tests/test_proposal_provider.py -q -> 24 passed
- .venv/bin/python -m pytest backend/tests/test_prompt_proposals.py -q -> 21 passed
- .venv/bin/python -m pytest <proposals+provider+composition+api+gate+gate_holds> -q -> 100 passed
- .venv/bin/python -m pytest backend/tests -q -> 48 failed, 316 passed, 6 skipped (기존 baseline 48건과 동일)
- .venv/bin/python -m ruff check <두 파일> -> All checks passed
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: UI 변경 없음. 브라우저 검증 대상 아님.
미완료·위험·다음 태스크가 알아야 할 사실:
- I03은 propose()에 session/mode/blocked/leased/model/dictionary/dictionary_version을 넘겨야 한다.
  session 값은 인증된 사용자 단위로 정하고, mode/blocked/leased는 scheduler·gpu 상태에서 읽어 전달한다.
- 요청 본문 상한 8 KiB는 route에서도 413으로 막아야 한다. provider 검사는 이중 방어이지 대체가 아니다.
- gate protocol 3 vs gate_candidate protocol 2 불일치(C02-6)는 여전히 미해결. `admission_owned_holds` 경로에만 영향.
- 모델 ID는 호출자가 정한다. 현재 llama-server가 어떤 alias를 노출하는지 이 저장소에서 확인되지 않았다.
- 실제 모델이 이 JSON 형식을 지키는지는 미확인. I02는 형식 강제·실패 분리까지만 보장한다.
```

### LLM-I03 — 인증된 제안 API 연결 · 완료

- 선행: LLM-I02. 수정: 별도 제안 router, 등록 지점, API 테스트 및 docs/API.md의 계약 설명.
- 실행: C02에서 정한 endpoint/capability를 구현. 기존 API 인증과 요청 한도 적용, 지원하지 않는 서버에서 기존 직접 생성 유지. endpoint명/타입은 C02 결과 사용, 임의 추정 금지.
- 완료: 인증 실패/요청 초과/지원 안 됨/정상/취소·시간 초과 API 테스트. 기존 P 및 관련 S 통과. job 저장 계약을 조용히 확장하지 않음.

#### I03-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 신규 라우터 | `backend/app/api/proposals.py` — `APIRouter(prefix="/api/v1/prompt", dependencies=[Depends(authenticate)])`, `POST /proposals` 하나 |
| 등록 | `main.py`에서 `include_router(proposals_router)`. 기존 `/api/v1` router·`BodyLimit`·인증을 그대로 통과한다 |
| 사전 주입 | `backend/app/services/prompt_dictionary.py` — `load_dictionary()` / `cached(holder, settings)`가 `app.state`에 프로세스당 1회 로드 |
| 설정 | `llm_model: str = ""`, `prompt_dictionary_path: Path = ROOT / "config/prompt_dictionary.json"` |
| capability | `routes.py`가 `prompt_proposals`를 조건부로 추가. `proposals_advertised()`는 `engine != "fake"` + `admission_url` + `llm_model` + 사전 로드 성공을 모두 요구 |
| 테스트 | `backend/tests/test_proposal_api.py` — 25 passed (실제 라우트·실제 provider, `httpx.MockTransport`) |
| job 계약 | `jobs.spec`·`prompt_composition` 스키마·`services/llm.py`·GPU lock **전부 무변경** |

#### I03-1. 계약 대비 판단이 필요했던 5가지

1. **사전은 손으로 베낀 사본이 아니라 생성된 거울이다.** `config/prompt_dictionary.json`(100개, version `1.2.0`)은 `frontend/src/prompt/dictionary.ts`에서 기계적으로 유도했고, `test_dictionary_mirror_matches_the_frontend_source`가 TS 원본을 다시 파싱해 비교한다. 두 목록을 사람이 관리하면 서버가 브라우저에 없는 ID를 제안하거나 그 반대가 되어 조용히 어긋난다. 이 테스트가 깨지면 사전을 고치지 말고 거울을 다시 생성해야 한다.
2. **사전을 클라이언트에 내려보내지 않는다.** whitelist를 브라우저로 보내면 요청마다 100개 ID가 왕복하고, 클라이언트가 보낸 사전을 서버가 신뢰하는 구조가 된다. 서버가 자기 사본으로 검증하고, 클라이언트는 `dictionary_version` 문자열만 비교한다.
3. **`llm_model`을 광고 조건에 넣었다.** C02-4는 `admission_url` + `engine != fake`만 요구했지만, 모델 alias가 비어 있으면 llama가 400을 돌려주므로 UI는 항상 실패하는 버튼을 갖게 된다. "capability는 실제로 성공할 수 있을 때만"이라는 원칙에 따라 `llm_model`을 필수 조건으로 추가했다. 그래서 `test_capability_is_omitted_on_a_fake_engine_or_without_a_gate`가 3가지 경우(fake / gate 없음 / 모델 없음)를 모두 확인한다.
4. **200과 4xx의 경계를 "누가 고칠 수 있는가"로 나눴다.** GPU·gate·모델·validator 실패는 사용자가 재시도 외에 할 일이 없으므로 200 + `status: "unavailable"`이다. 반면 401(자격 없음)·413(8 KiB 초과)·422(스키마 위반)은 클라이언트 결함이므로 조용히 degrade시키면 안 된다. `unsupported_kind`만 예외적으로 200인데, C01-4가 이를 "미지원"이지 "오류"가 아니라고 확정했기 때문이다.
5. **동시성은 라우트가 아니라 프로세스 자원에 붙였다.** `ProposalProviderClient`를 `app.state.proposal_client`에 1회만 만들어 세마포어가 요청마다 초기화되지 않게 했다. 요청마다 새 client를 만들면 전역 상한 2가 사실상 사라진다. 세션 키는 토큰 원문이 아니라 `sha256` 앞 32자다(`credentials()`).

추가로, 실패 문구는 `FAILURE_MESSAGES`(실패 코드별) + `DETAIL_MESSAGES`(GPU `detail`별)로 나눴다. C02-3이 `recovery_required`/`image_running`/`manual_approval`에 서로 다른 안내를 요구하는데, 코드만으로는 세 경우가 같은 `gpu_unavailable`이기 때문이다.

#### I03-2. 실패 코드 → API 테스트 대응표

| 결과 | 테스트 | HTTP |
| --- | --- | --- |
| 지원하지 않는 서버 | `test_unsupported_server_answers_not_configured_instead_of_failing` | 200 `not_configured` |
| 자격 없음 | `test_request_requires_a_bearer_credential` | 401 + `WWW-Authenticate` |
| 본문 8 KiB 초과 | `test_oversized_body_is_413_at_the_route` | 413 |
| 스키마·JSON 위반 | `test_malformed_requests_are_422_not_200` | 422 (깨진 JSON/짧은 `request_id`/빈 원문/미지 필드) |
| 미지원 `kind` | `test_unsupported_kind_is_a_200_not_a_schema_error` | 200 `unsupported_v1` |
| 정상 | `test_ready_reply_is_returned_with_the_contract_fields` | 200, control GET 1 + chat POST 1 |
| 사전 버전 불일치 | `test_stale_dictionary_version_is_refused_before_any_http` | 200, HTTP 0회 |
| 광고된 버전 일치 | `test_the_route_uses_the_same_dictionary_version_it_advertises` | 200, capability와 같은 버전만 통과 |
| GPU 상태 | `test_gpu_states_are_refused_with_distinct_messages`, `test_manual_policy_is_refused_rather_than_borrowing_the_gpu` | 200, 문구가 상태별로 다름 |
| upstream 오류 / 깨진 응답 | `test_upstream_status_and_invalid_reply_are_200_unavailable` | 200 `upstream_status` / `invalid_reply` |
| gate 연결 실패 | `test_gate_failure_is_its_own_code` | 200 `gate_unreachable` |
| gate 일시정지 | `test_paused_gate_is_reported_as_unavailable` | 200, chat 호출 0회 |
| timeout | `test_timeout_is_reported_and_nothing_is_adopted` | 200 `timeout`, 채택 없음 |
| validator 거절 | `test_validator_rejection_keeps_the_diagnostic_spans` | 200 `invalid_reply`, 진단 span만 유지 |
| 미지/부정 ID | `test_unknown_ids_are_rejected_while_negated_ids_are_held` | 200, `rejected`/`unresolved_spans` |
| 다른 revision의 응답 | `test_a_reply_for_another_revision_is_not_adopted` | 200 `invalid_reply`, 채택 없음 |
| 지연 측정 | `test_the_server_measures_latency_not_the_model` | 모델이 주장한 `latency_ms`를 서버 측정값으로 덮어쓴다 |
| 취소 | `test_cancelled_client_disconnect_is_reported_as_cancelled` | 200 `cancelled` (timeout과 구분) |
| 세션 단위 | `test_the_session_limit_is_per_credential_not_per_route` | 자격별 버킷, 비밀값 미포함 |
| 사전 거울 | `test_dictionary_mirror_matches_the_frontend_source`, `test_dictionary_loader_refuses_missing_or_malformed_files` | — |

**`busy`는 라우트 수준에서 새 테스트를 만들지 않았다.** `TestClient`는 동기이고, 실제 동시 실행을 만들려면 `sleep`에 의존해야 해서 flaky해진다. 세마포어 상한과 `busy` 반환은 `test_proposal_provider.py`의 `test_concurrency_limits_are_session_one_and_global_two`가 비동기로 직접 검증하며, 라우트는 세션 키만 만들어 넘긴다(`test_the_session_limit_is_per_credential_not_per_route`). 중복 테스트를 만들지 않은 이유를 여기 남긴다.

#### I03-3. 인계

```text
LLM-I03 / 완료 / 2026-11-17 / 기준 HEAD: I01·I02 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: backend/app/api/proposals.py — 인증된 POST /api/v1/prompt/proposals 하나. 프론트가 아직 호출하지 않으므로 화면 동작 변화 없음
- 신규: backend/app/services/prompt_dictionary.py — 사전 거울 로더(프로세스당 1회)
- 신규: config/prompt_dictionary.json — dictionary.ts의 생성된 거울(100개, 1.2.0)
- 신규: backend/tests/test_proposal_api.py (25 tests)
- 수정: backend/app/api/routes.py(capability), backend/app/core/studio_config.py(llm_model·사전 경로), backend/app/main.py(router 등록)
- 수정: backend/app/services/prompt_proposals.py(reply request_id/revisions 대조), proposal_provider.py(proposals_advertised)
- 문서: docs/API.md "LLM prompt proposals" 신설, docs/PROMPT_COMPOSER_CURRENT.md 규칙 제안 절에 서버 현황, deploy/studio.env.example에 STUDIO_LLM_MODEL
보존한 계약: jobs.spec / prompt_composition 스키마 / compileScene / 사전 ID / services/llm.py / 이미지 job / GPU lock / scheduler 제어 전부 무변경.
실행한 명령과 결과:
- .venv/bin/python -m pytest backend/tests/test_proposal_api.py -q -> 25 passed
- .venv/bin/python -m pytest test_proposal_api + test_prompt_proposals + test_proposal_provider + test_prompt_composition + test_api + test_coordination_capability -q -> 118 passed
- .venv/bin/python -m ruff check backend/app backend/tests -> All checks passed
- .venv/bin/python -m pytest backend/tests -q -> 48 failed, 343 passed, 6 skipped (기존 baseline 48건과 동일, 통과만 318→343)
- git diff --check -> exit 0
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: UI 변경 없음. 브라우저 검증 대상 아님.
미완료·위험·다음 태스크가 알아야 할 사실:
- 프론트는 아직 이 endpoint를 호출하지 않는다(LLM-I04). 지금 화면의 제안은 전부 규칙 기반이다.
- 실제 LLM은 한 번도 호출되지 않았다. 25건은 계약·실패 분리의 회귀 방지 장치이며 모델 품질 증거가 아니다.
- backend/tests 전체의 기존 실패 48건(주로 test_switch_worker·test_model_switch 등)은 이번 변경과 무관하며 고치지 않았다.
- gate protocol 3 vs gate_candidate protocol 2 불일치(C02-6)는 여전히 미해결. `admission_owned_holds` 경로에만 영향.
- 사전을 수정하면 config/prompt_dictionary.json도 함께 재생성해야 한다. 거울 테스트가 강제한다.
- `llm_model`은 llama-server alias와 맞아야 한다. 어떤 alias가 존재하는지는 이 저장소에서 확인되지 않았다.
```


### LLM-I04 — 프론트 요청 상태와 오래된 응답 방어 · 완료

- 선행: LLM-I03, UX05. 수정: 프론트 API client/제안 상태 모듈과 테스트. App 전체 state 재배치 금지.
- 실행: idle/loading/ready/error/cancelled, 요청 ID+원문/family/선택 revision 관리. 타이핑 중 자동 호출 없음. 원문·모델 변경, 새 요청, 취소 후 도착한 이전 응답은 폐기.
- 완료: 응답 순서 역전·타임아웃·모델 전환 테스트. 실패해도 원문·최종 prompt·선택 유지. capability 없으면 규칙 제안으로 명확히 표시.

#### I04-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 상태 모듈 | `frontend/src/prompt/llmProposals.ts` — 순수 함수 상태 기계. React/fetch/timer 없음 |
| capability | `frontend/src/prompt/proposalCapability.ts` — `supported`/`absent`/`unsupported_schema`/`stale_dictionary` 판정 + 폴백 문장 1개 |
| 지문 | `frontend/src/prompt/digest.ts` — 동기 SHA-256 (`revisions`가 계약상 `sha256:<hex>`) |
| API client | `api.ts` — `capabilities()`에 `prompt_proposals` 타입, `proposals(body, signal)` 추가 |
| 연결 | `App.tsx`가 capability를 읽어 `PromptBuilder`에 `proposalCapability`/`sendProposal` 전달. App의 builder state·최종 prompt·적용 로직 무변경 |
| UI | `PromptBuilder` — AI 버튼(지원 시에만), 상태 한 줄(`role="status"`), 폴백 문장. 요청 호출 지점은 버튼 하나 |
| 테스트 | `frontend/tests/prompt-llm-proposals.test.mjs` — 18건 |
| 브라우저 | `suite-contracts.mjs` L6/N/O 절 — 폴백 3건, 지원 경로 12건, 오래된 응답 4건 추가(총 121 checks) |

#### I04-1. 설계 판단 (근거 있는 것만)

1. **응답 폐기는 두 단계다.** ① `request_id` 불일치 → 조용히 폐기(더 새로운 요청이 이미 상태를 소유). ② 서버가 돌려준 `revisions`가 *보낸 값*과 다르면 프로토콜 오류(422적 성격, `mismatched` 문구). ③ 보낸 값은 맞지만 *지금 화면의* 지문이 다르면 `cancelled/stale_revision`. 세 경우를 구분하지 않으면 "내가 방금 친 글자 때문에 버려졌다"와 "서버가 이상한 걸 보냈다"가 같은 문구가 된다.
2. **`loading`을 effect로 취소하지 않고 렌더에서 파생했다.** 타이핑마다 setState하는 effect는 키 입력마다 리렌더를 한 번 더 만들고, `react-hooks/set-state-in-effect` 위반이었다. 대신 `visibleProposal = invalidateProposal(proposal, revisions)`로 화면 상태만 파생하고, 실제 폐기는 `settleProposal`의 revision 비교가 한다. 결과는 같고 effect가 없다.
3. **지문은 동기 SHA-256이어야 했다.** 계약이 `sha256:<hex>`를 요구하는데 `crypto.subtle`은 async라서, 같은 동기 동작 안에서 요청 본문을 만드는 경로에 쓸 수 없다. `digest.ts`는 FIPS 180-4 구현이고 Node `crypto`와 5개 벡터(빈 문자열·`abc`·64자·한글·1,000자)에서 비교해 일치를 확인했다.
4. **타임아웃은 서버 값 + 5초.** capability가 `timeout_ms`를 광고하면 그보다 늦게 abort한다. 서버가 먼저 20초에 `timeout`을 돌려주고, 브라우저 abort는 그 뒤의 안전망이다. 광고값이 1초 미만/60초 초과면 신뢰하지 않고 기본값을 쓴다.
5. **AI 버튼은 없거나, 있다.** 비활성 버튼은 "고장"으로 읽힌다는 C02-4 원칙에 따라 `absent`일 때 아예 렌더하지 않고 한 문장으로 대체 경로를 설명한다. 사전 버전 불일치도 호출하지 않는다(호출해도 사용자가 조치할 수 없는 `stale_dictionary`만 온다).
6. **수락 경로를 만들지 않았다.** I04는 요청·폐기·표시까지다. 제안 카드와 `selectEntry` 연결은 I05이므로, 지금 AI 응답은 화면 상태 문구만 남기고 선택을 건드리지 않는다. 브라우저 검사가 `chips` 불변을 확인한다.

#### I04-2. 테스트 대응표

| 완료 조건 | 근거 |
| --- | --- |
| 응답 순서 역전 | `two requests in flight: only the newest answer reaches the screen, in either arrival order` (JS), L6/O 절(브라우저) |
| 타임아웃 | `a timeout is reported as a timeout and never as a cancel` — `timeoutMs: 5`로 실제 abort 유도 |
| 모델 전환 | `editing the text or switching the model while loading discards the answer` (family 변경 지문) |
| 지문 정확성 | `the revision fingerprint uses sha256…` — Node `createHash`와 문자열 비교 |
| 원문·선택·최종 prompt 보존 | `no outcome changes the original text, the selections or the final prompt` — `Object.freeze`된 scene으로 3가지 결과 순회 |
| capability 없음 → 규칙 제안 명확 표시 | `the capability gate keeps the rule-based fallback…` + 브라우저 `capability 없음 · 폴백 문구` |
| 자동 호출 없음 | `the composer asks for a proposal only from the AI action…` (호출 지점 1개, effect/onChange 경로 없음) + 브라우저 `자동 호출 없음`/`입력만으로 호출 없음` |
| 서버 실패 문구 그대로 | `200 failures become their own state…` — `message` 미변형 확인 |
| 401/413/422/네트워크 구분 | `transport failures are separated…` — 4개 상태 + malformed 200 |

**수락(카드)은 이 태스크에서 검증하지 않았다.** 계획상 I05이며, I04 화면에는 제안 항목을 선택으로 옮기는 컨트롤이 없다.

#### I04-3. 인계

```text
LLM-I04 / 완료 / 2026-11-17 / 기준 HEAD: I01–I03 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: frontend/src/prompt/llmProposals.ts, proposalCapability.ts, digest.ts
- 신규: frontend/tests/prompt-llm-proposals.test.mjs (18 tests)
- 수정: frontend/src/api.ts(capabilities 타입 + proposals()), App.tsx(capability 읽기·전달),
  components/PromptBuilder.tsx(AI 버튼·상태 줄·폴백), styles.css(2 규칙), tsconfig.app.json(allowImportingTsExtensions)
- 수정: scripts/prompt-composer-browser/suite-contracts.mjs(L6/N/O 절)
- 문서: PROMPT_COMPOSER_CURRENT.md 제안 절 재작성
사용자에게 달라지는 동작:
- 서버가 prompt_proposals를 광고하면 "장면 정리하기" 버튼이 생기고, 누르면 한 번 요청한다. 입력 중에는 호출하지 않는다.
- 서버가 광고하지 않으면(AI 미구성·fake 엔진) 버튼 대신 "이 서버에서는 AI 제안을 사용할 수 없습니다…" 한 줄이 보이고 규칙 제안만 남는다.
- 요청이 오래되었거나 취소되면 "원문이나 선택이 바뀌어 이전 제안을 버렸습니다"가 뜨고 원문·선택·최종 prompt는 그대로다.
보존한 계약: Scene v1 / compileScene / 사전 ID·버전 / builderState / applied 이력 / job 저장 / services/llm.py / GPU lock / image job / 서버 라우트 전부 무변경.
실행한 명령과 결과:
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 79 passed (기준 61 + 신규 18)
- node --experimental-strip-types --test frontend/tests/prompt-llm-proposals.test.mjs -> 18 passed
- npm --prefix frontend run build -> 성공 (307.69 kB)
- npm --prefix frontend run lint -> 오류 0
- .venv/bin/python -m pytest test_proposal_api + test_prompt_proposals + test_proposal_provider + test_prompt_composition -q -> 75 passed
- .venv/bin/python -m pytest 위 4개 + test_api + test_coordination_capability -q -> 119 passed
- .venv/bin/python -m ruff check backend/app backend/tests -> All checks passed
- sh scripts/prompt-composer-browser/verify.sh -> checks 121, failed 0, EXIT 0
- git diff --check -> exit 0
브라우저 환경: Playwright 번들 Chromium(chromium-1228, headless CDP), fake 백엔드 + Vite, 1280/390/360 뷰포트.
관찰한 DOM/텍스트: `.prompt-proposals__ai` 존재·라벨 "장면 정리하기"·`role="status"` 문구, 폴백 시 `.prompt-proposals__ai` 없음 + 규칙 버튼 유지, 오래된 응답 후 chips 불변·최종 prompt 빈 문자열 유지.
미완료·위험·다음 태스크가 알아야 할 사실:
- 실제 LLM 호출은 여전히 0회. 브라우저 지원 경로는 페이지 내 fetch 스텁이며 모델 품질 증거가 아니다.
- 제안 항목을 선택으로 옮기는 UI가 없다(LLM-I05). `ready` 응답은 개수 문구만 남는다.
- `unresolved_spans`/`ambiguities`는 파싱만 하고 화면에 쓰지 않는다(I05 몫).
- gate protocol 3 vs 2 불일치(C02-6)는 여전히 미해결이며 이 태스크와 무관.
- `llm_model`에 넣을 실제 llama-server alias는 여전히 미확인.
```

### LLM-I05 — 장면 제안 카드와 명시적 수락 · 완료

- 선행: LLM-I04. 수정: 신규 제안 카드 컴포넌트/PromptBuilder 최소 연결/styles.
- 실행: 원문에서 찾은 항목 / AI 추가 제안 / 아직 표현 못 한 내용 구분. 기존 사전 항목만 선택적으로 수락하며 일괄 수락은 추가 AI 항목을 기본 제외. 거절은 선택을 변경하지 않음.
- 완료: 원문·미반영 구절 보존, ID/중복/충돌 검증 후 기존 selectEntry/컴파일 경로 사용. 승인되지 않은 번역을 최종 prompt에 넣지 않음. 수락은 초안만 갱신하며 최종 적용은 별도. 키보드 접근·취소·빈 제안·오류 상태 기술 및 F·B.

#### I05-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 카드 모듈 | `frontend/src/prompt/proposalCards.ts` — 순수 함수. `proposalCards({reply, scene, dictionary, family})`가 카드·개수·`batchIds`·`excluded`·`truncated`·`rejectedCount` 반환. scene을 변경하지 않는다 |
| 충돌 단일 출처 | `compiler.ts`에 `conflictsAmong(ids)`를 export하고 `compileScene`도 이를 호출하도록 바꿔, 열두 쌍의 정의가 한 곳에만 있다 |
| 상태 모듈 | `llmProposals.ts` — `ready`/`empty`에 `acceptedIds` 추가, `reapplyProposal()`, `dismissProposal()` 추가, `proposalNotice()`가 수락 개수를 문장에 포함 |
| UI | `PromptBuilder` — `visibleProposal`에서 `useMemo`로 카드 계산, `section#prompt-cards`(개수 머리글·카드 목록·일괄 제외 접이식·잘림 주의·일괄/닫기 버튼·안내), 카드마다 `선택에 추가` |
| 스타일 | `styles.css` — `.prompt-cards*`/`.prompt-card*`, 유형별 왼쪽 테두리 색, 460px에서 수락 버튼 전체 폭 |
| 테스트 | `frontend/tests/prompt-proposal-cards.test.mjs` — 14건 |
| 브라우저 | `suite-contracts.mjs` P 절 — 22건 추가(총 143 checks). 스텁이 `window.__proposalReply`를 읽어 유형·구절·모호 카드를 실제로 렌더 |

#### I05-1. 설계 판단 (근거 있는 것만)

1. **카드는 네 종류이고 서로 다른 질문에 답한다.** `quoted`(원문에 있다), `inferred`(모델이 추정했다), `unresolved`(사전에 없다), `ambiguous`(해석이 여럿이다). 뒤의 둘을 하나로 합치면 "사전을 늘리면 되는 것"과 "사용자가 골라야 하는 것"이 같은 카드가 된다.
2. **`basis: "inferred"`는 차단 사유가 아니다.** C01-3/C01-4는 *일괄* 수락에서만 제외하라고 한다. 그래서 `batchEligible: !inferred && blocks.length === 0`으로 두고 개별 수락 버튼은 그대로 남긴다. 처음엔 `blocks.push("inferred")`로 구현했다가 명세와 어긋나 되돌렸다.
3. **충돌은 클릭 전에 판정한다.** `accepted` 집합에 응답 순서대로 반영해 나가며 `conflictsAmong([...accepted, id])`로 미리 본다. 클릭 뒤 컴파일러 경고로 알게 되면 "방금 추가했더니 경고"가 되어 원인과 결과가 뒤집힌다.
4. **`already_selected`는 거절이 아니다.** 서버는 이미 선택된 항목을 보내지 않으므로 이 사유는 요청과 응답 사이에 사용자가 직접 추가했을 때만 나타난다. 사용자가 한 일이므로 "빠진 항목" 목록에 넣지 않는다.
5. **수락은 장면만 만진다.** `selectEntry`/`compileScene` 기존 경로를 재사용한다. 별도 적용 경로를 만들면 카드가 선택기로는 만들 수 없는 장면을 만들 수 있게 되고, "수락은 초안만 갱신, 최종 적용은 별도"라는 계약도 깨진다.
6. **클릭은 카드를 지우지 않는다.** `reapplyProposal`이 응답의 지문만 새 선택에 맞춰 다시 잡는다(`ready`/`empty`이고 원문이 같을 때만). 반면 원문 수정은 `invalidateProposal`을 지나 `cancelled/stale_revision`이 되므로 카드가 전부 철회된다 — 요청이 설명하던 문장이 사라졌는데 제안이 남아 있으면 근거가 없다.
7. **포커스 대상은 커밋된 DOM에서 찾는다.** 수락하면 그 카드의 버튼이 같은 커밋에서 사라진다. ref map은 분리된 노드를 들고 있어 살아남은 형제를 놓쳤고, `#prompt-cards .prompt-card button:not(:disabled)` 질의가 남은 첫 수락 버튼을 정확히 집는다.
8. **닫힌 패널 안에서는 포커스를 주장하지 않는다.** 브라우저 검사가 `BODY`로 실패했는데, 원인은 제품이 아니라 하네스가 reload 후 빌더 패널을 다시 열지 않은 것이었다(`hidden` 안에서는 `focus()`가 무시된다). `ui.mjs`에 `openBuilder()`를 추가해 검사 절차를 실제 사용자 동작에 맞췄다.

#### I05-2. 테스트 대응표

| 완료 조건 | 근거 |
| --- | --- |
| 원문에서 찾은 항목 / AI 추가 / 미표현 / 모호 구분 | `a quoted card is acceptable, an inferred one is shown but never batched`, `unresolved spans and ambiguities are listed, and neither can be accepted` (JS); P 절 `유형 구분`·`미표현 구절 원문` (브라우저) |
| 사전에 없는 ID는 수락 불가 | `a card whose id is not in the dictionary is displayed with a reason and no button` |
| 이미 선택된 항목 | `an item already in the scene is not offered again and is not called a rejection` |
| ID/중복/충돌 검증 | `the same id twice is a duplicate card, and only the first may be accepted`, `a card that would collide with a choice is blocked instead of warning after the fact` — 같은 fixture를 `compileScene`에도 넣어 경고와 차단이 일치함을 확인 |
| 모델 계열 검증 | `a family without a mapping blocks acceptance and says which family failed` |
| 기존 selectEntry/컴파일 경로 사용 | `accepting a card re-bases the reply on the new selection and counts what was taken`; 브라우저 `수락 시 선택 추가`·`수락은 최종 prompt 불변` |
| 승인되지 않은 번역을 최종 prompt에 넣지 않음 | 브라우저 `수락 전 최종 prompt 불변`·`수락은 최종 prompt 불변` — 클릭 전후 모두 빈 문자열 |
| 일괄은 추가 AI 항목 기본 제외 | `two different quoted ids both enter the batch, in reply order`, `an inferred card keeps its accept button and only loses batch membership`; 브라우저 `수락 버튼은 2개`·`일괄 문구는 원문 근거만` |
| 거절은 선택을 변경하지 않음 | `editing the text still withdraws a re-based reply, and dismissing clears it`; 브라우저 `거절 시 카드 제거`·`거절 시 선택 불변`·`거절 안내 문구` |
| 키보드 접근 | 브라우저 `수락 후 포커스 유지` — 실제 `document.activeElement.tagName === "BUTTON"` |
| 취소·오래된 응답 | 같은 테스트에서 `invalidateProposal`이 `cancelled/stale_revision`이 되고 `reapplyProposal`이 철회됨을 확인; 브라우저 `편집 후 카드 철회`·`편집 후 철회 문구` |
| 빈 제안·오류 상태 | 카드는 `ready`/`empty`에서만 계산. 같은 테스트가 `dismissProposal`의 `loading` 무변경을 확인 |
| 잘림·거절 개수 표시 | `truncation and rejected items are surfaced instead of dropping silently` |
| 신뢰도 표시 | `a card with a confidence outside 0..1 is clamped for display only` |

#### I05-3. 인계

```text
LLM-I05 / 완료 / 2026-11-17 / 기준 HEAD: I01–I04 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: frontend/src/prompt/proposalCards.ts, frontend/tests/prompt-proposal-cards.test.mjs (14 tests)
- 수정: frontend/src/prompt/compiler.ts(conflictsAmong export), llmProposals.ts(acceptedIds/reapplyProposal/
  dismissProposal/문구), components/PromptBuilder.tsx(카드 패널·수락·일괄·닫기·포커스), styles.css(카드 규칙·460px)
- 수정: scripts/prompt-composer-browser/suite-contracts.mjs(P 절), ui.mjs(openBuilder 헬퍼)
- 문서: PROMPT_COMPOSER_CURRENT.md 제안 절, docs/API.md 제안 절
사용자에게 달라지는 동작:
- AI 응답이 오면 "장면 정리 제안 N개" 카드 목록이 뜬다. 원문 근거/AI 추가/미표현 구절/모호 표현이 구분된다.
- 사전 항목이고 막는 사유가 없는 카드에만 "선택에 추가"가 붙는다. 누르면 그 항목만 선택에 들어가고 원문과 최종 프롬프트는 그대로다.
- "원문 근거 n개 선택에 추가"는 원문에 근거가 있는 항목만 넣는다. AI가 덧붙인 항목은 개별로 눌러야 하고, 빠진 이유는 접이식 목록에 있다.
- "제안 닫기"는 카드만 없앤다. 선택·원문·최종 프롬프트는 그대로다.
- 원문을 고치면 카드가 전부 사라지고 "이전 제안을 버렸습니다"가 뜬다.
보존한 계약: Scene v1 / compileScene 출력 의미 / 사전 ID·버전 / builderState / applied 이력 / job 저장 / 서버 라우트·proposal 계약 전부 무변경. 카드가 만드는 선택은 선택기가 만드는 것과 동일하다.
실행한 명령과 결과:
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 93 passed (기준 79 + 신규 14)
- node --experimental-strip-types --test frontend/tests/prompt-proposal-cards.test.mjs -> 14 passed
- npm --prefix frontend run build -> 성공 (314.86 kB)
- npm --prefix frontend run lint -> 오류 0
- .venv/bin/python -m pytest 6개 파일 -q -> 119 passed
- .venv/bin/python -m ruff check backend/app backend/tests -> All checks passed
- sh scripts/prompt-composer-browser/verify.sh -> checks 143, failed 0, EXIT 0
- git diff --check -> exit 0
브라우저 환경: Playwright 번들 Chromium(chromium-1228, headless CDP), fake 백엔드 + Vite, 1280/390/360 뷰포트.
관찰한 DOM/텍스트: 카드 4개(quoted/inferred/unresolved/ambiguous), 라벨 "네온 조명"/"개"/"골목에 선"/"그 사람",
수락 버튼 2개, 일괄 라벨 "원문 근거 1개 선택에 추가", 수락 후 chips ["네온 조명"]·원문 유지·최종 prompt "",
포커스 BUTTON("선택에 추가"), 닫기 후 카드 0·chips 1·"AI 제안을 닫았습니다…", 편집 후 카드 0·"이전 제안을 버렸습니다…".
미완료·위험·다음 태스크가 알아야 할 사실:
- 실제 LLM 호출은 여전히 0회. 카드 렌더링 근거는 페이지 내 fetch 스텁(`window.__proposalReply`)이며 모델 품질 증거가 아니다.
- 표시 상한(제안 8개·span 8개)에 잘린 경우만 "일부를 표시하지 못했습니다"로 알린다. 원인별 문구는 없다.
- 카드 목록은 응답 순서를 그대로 쓴다. 유형별 정렬·필터·카드 접기는 I05 범위가 아니다.
- 수락 되돌리기는 이 태스크에 없다(I06에서 한 단계 구현).
- gate protocol 3 vs 2 불일치(C02-6), `llm_model` 실제 alias는 여전히 미확인.
```


### LLM-I06 — 부분 변경 제안과 되돌리기 · 완료

- 선행: LLM-I05. 수정: 제안 상태 모듈/카드 및 테스트.
- 실행: `조명만 변경`처럼 수정 대상 그룹과 잠금값을 요청에 전달. 전체 새 장면 자동 대체 금지. 수정 전후 diff 표시 후 수락, 직전 제안 수락 한 단계 되돌리기 제공.
- 완료: 잠긴 값 변경 응답을 거부, 대상 외 선택·원문·최종 입력 보존. 되돌리기는 제안 수락의 영향만 취소하며 이후 직접 편집을 덮어쓰지 않도록 revision 불일치 시 차단/안내. 고정은 설정 고정이지 시각적 동일 인물 보장이 아님.

#### I06-0. 구현 결과 (2026-11-17)

| 항목 | 내용 |
| --- | --- |
| 범위 모듈 | 신규 `frontend/src/prompt/partialChange.ts` — `partialScope(scene, groups)`가 `targetGroups`(표시 순서)와 `lockedIds`(그룹 밖의 현재 선택)를 계산. `scopeIsActive`, `describeScope`(`배경만 변경 · 고정 1개`), `partialDiff`(kept/change/blocked 행과 `noChange`), `LOCK_NOTE` |
| 되돌리기 모듈 | 신규 `frontend/src/prompt/proposalUndo.ts` — `recordAcceptance`(이번 클릭이 *추가한* ID만), `undoStatus`(지문 불일치·이미 되돌림·기록 없음 구분), `undoScene`(기록된 ID만 제거) |
| 요청 | `llmProposals.ts` — `PARTIAL_KIND`, `ProposalBody.target_groups`/`locked_ids`(선택 필드, `selection_hint`에는 없음), `proposalBody({..., scope})`, 상태에 `kind`/`scope` 추가, `settleProposal`이 응답 `kind` 불일치를 프로토콜 오류로 거부, `unapplyProposal` 추가 |
| 카드 | `proposalCards.ts` — `scope` 입력, `locked`/`out_of_scope` 차단 사유 2개 추가(총 8개). 이미 선택된 항목은 `already_selected`만 붙여 사유가 겹치지 않는다 |
| UI | `PromptBuilder` — `부분 변경 범위` 접이식 그룹 선택, 버튼 라벨 `선택한 그룹만 정리`, `수락하면 이렇게 바뀝니다` diff 패널, 카드 패널 밖 `prompt-undo` 한 단계 되돌리기 |
| 스타일 | `styles.css` — `.prompt-scope*`, `.prompt-diff*`, `.prompt-undo`, 460px 줄바꿈 규칙 |
| 테스트 | 신규 `frontend/tests/prompt-partial-change.test.mjs` — 8건 |
| 브라우저 | `suite-contracts.mjs` Q 절 — 30건 추가(총 172 checks), 스크린샷 25–29 |

#### I06-1. 설계 판단 (근거 있는 것만)

1. **잠금은 사용자가 입력하지 않는다.** 계약은 `locked_ids`를 요청 필드로 두지만, "같은 인물과 의상을 유지"는 사용자가 ID를 알 필요가 없는 요청이다. `partialScope()`가 대상 그룹 **밖의 현재 선택**을 계산해 채우므로 잠금 목록이 화면과 어긋날 수 없다. 사용자는 그룹만 고르고 나머지는 파생된다.
2. **잠금 규칙을 클라이언트에도 복제했다.** 서버가 `locked`/`out_of_scope`를 이미 거절하지만 카드도 같은 두 규칙으로 차단한다. 브라우저 증거는 페이지 스텁 응답을 쓰므로, 스텁이 잠금을 어기는 제안을 돌려주면 서버 규칙은 검증되지 않는다. 클라이언트 판정이 있어야 "잠긴 값을 바꾸는 제안은 표시하지 않는다"를 실제 DOM으로 확인할 수 있다.
3. **`already_selected`가 다른 사유를 덮는다.** 이미 선택된 항목에 `locked`를 겹쳐 붙이면 "고정했는데 이미 선택됨"이라는 모순된 두 사유가 한 카드에 뜬다. 수락이 아무것도 바꾸지 않는 카드이므로 첫 사유만 남긴다.
4. **되돌리기는 지문으로 판정한다.** 시간·개수 비교는 "그 사이 무엇이 바뀌었는지"를 알 수 없다. `revisionsFor(scene)`가 원문·계열·선택을 모두 덮으므로, 수락 직후 지문과 지금 지문이 다르면 기록이 화면을 설명하지 못한다 → 비활성하고 사유를 쓴다. 강제 실행해도 `undoScene`은 기록된 ID만 제거하므로 직접 고른 항목은 남는다(테스트로 고정).
5. **되돌리기 버튼은 카드 패널 밖에 둔다.** 카드를 모두 수락하면 패널이 비고, 되돌릴 대상과 함께 사라지는 컨트롤은 되돌리기가 아니다. `prompt-undo`는 제안 영역에 남는다.
6. **부분 변경은 kind 불일치를 프로토콜 오류로 다룬다.** `selection_hint` 응답을 `partial_change` 범위로 판정하면 잠금이 조용히 풀린다. `settleProposal`이 응답 `kind`를 요청 `kind`와 비교하고, `kind`가 없는 구버전 응답은 그대로 채택한다.
7. **`target_groups` 밖 제안은 서버가 거절하고 카드는 표시하지 않는다.** C01-4의 `out_of_scope`를 화면에서도 같은 문장(`이번 요청의 변경 대상이 아닙니다`)으로 보여야 사용자가 "왜 사라졌는지"를 안다. 사유 문구는 `proposalCards.ts` 한 곳에만 있다.

#### I06-2. 완료 조건 대응

| 완료 조건 | 근거 |
| --- | --- |
| 잠긴 값 변경 응답 거부 | `locked and out-of-scope suggestions are blocked, with the server wording`(locked 분기); 브라우저 `범위 밖·고정 카드 차단`=2 |
| 대상 그룹 밖 거부 | 같은 테스트(`out_of_scope`); 브라우저 `diff 행 구분`의 `blocked:네온 조명` |
| 대상 외 선택 보존 | `a partial scope locks every selection outside the chosen groups`; 브라우저 `요청 locked_ids`=`["subject.person"]` |
| 원문·최종 입력 보존 | 브라우저 `수락 전 원문 불변`·`수락해도 원문 불변`·`수락해도 최종 prompt 불변`·`되돌려도 최종 prompt 불변` |
| 전체 장면 자동 대체 금지 | `the request becomes partial_change only when a group was chosen` — 범위가 없으면 I04 요청 그대로, 잠금 필드 없음 |
| 수정 전후 diff 표시 | `the diff separates what stays, what is added and what cannot be taken`; 브라우저 `diff 머리글`=`고정 1 · 추가 1 · 적용 불가 1` |
| 한 단계 되돌리기 | `one-step undo removes only what the acceptance added…`; 브라우저 `되돌리면 선택 복원`·`되돌리기 후 버튼 사라짐` |
| 이후 직접 편집을 덮어쓰지 않음 | 같은 테스트의 `scene_changed`·`already_undone` 분기와 강제 실행 검사; 브라우저 `편집 후 되돌리기 차단`·`차단 사유 문구` |
| 고정은 설정 고정임을 표시 | `diff.note === LOCK_NOTE`; 브라우저 `고정은 동일 인물 보장이 아님`(범위 패널·diff 양쪽) |
| 같은 컴파일 경로 | `undoing produces the same draft as removing the chips by hand` |

#### I06-3. 인계

```text
LLM-I06 / 완료 / 2026-11-17 / 기준 HEAD: I01–I05 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: frontend/src/prompt/partialChange.ts, proposalUndo.ts,
  frontend/tests/prompt-partial-change.test.mjs (8 tests)
- 수정: frontend/src/prompt/llmProposals.ts(PARTIAL_KIND·scope 필드·kind 가드·unapplyProposal),
  proposalCards.ts(locked/out_of_scope·scope 입력), components/PromptBuilder.tsx(범위 선택·diff·되돌리기),
  styles.css(.prompt-scope/.prompt-diff/.prompt-undo·460px)
- 수정: scripts/prompt-composer-browser/suite-contracts.mjs(Q 절 30건)
- 문서: PROMPT_COMPOSER_CURRENT.md 제안 절, docs/API.md 제안 절, PROMPT_COMPOSER_LLM_AUTOMATION.md
사용자에게 달라지는 동작:
- 제안 영역에 "부분 변경 범위"가 생긴다. 그룹을 고르면 버튼이 "선택한 그룹만 정리"가 되고 요청은
  partial_change로 나가며 나머지 선택은 잠금으로 전달된다.
- 잠긴 값이나 범위 밖을 바꾸는 제안 카드는 "이번 요청에서 고정한 값입니다"/"이번 요청의 변경 대상이
  아닙니다"로 차단되고 수락 버튼이 없다.
- 부분 변경 응답에는 "수락하면 이렇게 바뀝니다"(고정·추가·적용 불가)가 붙고, 바뀌는 게 없으면 그렇게 말한다.
- 수락 뒤 "방금 추가한 … 되돌리기"가 생긴다. 그 클릭이 추가한 항목만 되돌리며, 이후 원문이나 선택이
  바뀌면 비활성되고 사유가 뜬다.
보존한 계약: Scene v1 / compileScene 출력 의미 / 사전 ID·버전 / builderState / applied 이력 / job 저장 /
서버 라우트·proposal 응답 스키마 전부 무변경. C01-2의 두 kind와 locked_ids/target_groups만 실제로 쓰기 시작했다.
실행한 명령과 결과:
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 101 passed (기준 93 + 신규 8)
- node --experimental-strip-types --test frontend/tests/prompt-partial-change.test.mjs -> 8 passed
- npm --prefix frontend run build -> 성공 (321.57 kB)
- npm --prefix frontend run lint -> 오류 0
- .venv/bin/python -m pytest 6개 파일 -q -> 119 passed
- .venv/bin/python -m ruff check backend/app backend/tests -> All checks passed
- sh scripts/prompt-composer-browser/verify.sh -> checks 172, failed 0, EXIT 0
- git diff --check -> exit 0
브라우저 환경: Playwright 번들 Chromium(chromium-1228, headless CDP), fake 백엔드 + Vite, 1280/390/360.
관찰한 DOM/텍스트: 요청 {"kind":"partial_change","target_groups":["setting"],"locked_ids":["subject.person"]},
카드 3장 중 차단 2·수락 가능 1, diff "고정 1 · 추가 1 · 적용 불가 1"
(kept:인물, change:단색 배경, blocked:네온 조명), 수락 후 chips ["인물","단색 배경"]·
되돌리기 라벨 "“단색 배경” 추가 되돌리기", 되돌린 뒤 chips ["인물"]·버튼 사라짐,
편집 후 되돌리기 disabled + "수락 이후 선택이나 원문이 바뀌어 되돌릴 수 없습니다…".
미완료·위험·다음 태스크가 알아야 할 사실:
- 실제 LLM 호출은 여전히 0회. 부분 변경 판정 증거도 페이지 스텁이며 모델 품질 증거가 아니다.
  실제 모델이 target_groups를 지키는지는 확인되지 않았다.
- 되돌리기는 한 단계이고 다음 수락이 오면 기록이 대체된다. 다단계 이력·장면 전체 undo는 없다(의도적).
- 그룹 선택은 표시 그룹 10개를 그대로 쓴다. diff는 "이전 대비"가 아니라 "지금 선택 대비"다.
- 잠금은 설정 고정이며 시각적 동일 인물을 보장하지 않는다. 화면 문구·문서 모두 그렇게 쓴다(C01-6 #5).
- gate protocol 3 vs 2 불일치(C02-6), llm_model 실제 alias는 여전히 미확인.
```

### VAR01 — 여러 상황 후보의 비영속 계약 · 완료

- 선행: LLM-I06. 수정: 이 문서의 계약 예시/기존 제안 타입·검증 fixture. 확장 번역 계약이 미결이면 설계까지만.
- 실행: 승인 장면을 기준으로 고정할 대상/의상과 바꿀 장소/행동을 정의. 최대 3개 한국어 상황 후보, 바뀐 부분과 사전 밖 표현 표시. 다인 귀속은 SCENE01/02 검토 결과 없이 v1에 압축 저장하지 않음.
- 완료: 잠금 위반·후보 초과·누락·사전 밖 복합 행동의 판정 예시. 기존 job/API에 후보 배열 저장 안 함. 영어 변환 의미와 compiler 책임 변경이 필요하면 C01/C02에 결정 기록 후 진행.

#### VAR01-1. 설계 판단 (근거 있는 것만)

1. **후보는 제안이 아니라 별도 kind다.** `selection_hint` 응답에 `variants`를 실어 보내면 화면에서 같은 필드가 "수락할 항목"과 "비교할 문장" 두 뜻을 갖는다. 서버는 kind별로만 후보를 판정하고(`validate_variants`), 다른 kind에 후보가 오면 `unexpected_kind`로 거절한다. 클라이언트 파서도 자기 kind일 때만 후보를 읽는다.
2. **범위는 표시 그룹 `pose`·`setting`으로 고정했다.** 사전이 `action`→`pose`(동작→포즈), `location`→`setting`(장소→배경)으로 별칭하므로 원 카테고리로 비교하면 같은 그룹이 두 이름으로 갈린다. 잠금·범위 판정 모두 `DISPLAY_GROUP`을 거친 뒤 비교한다.
3. **후보는 통째로 거절한다.** "장소만 바뀌고 행동은 조용히 사라진" 반쪽 상황은 모델이 약속하지 않은 장면이다. `changed_ids`/`removed_ids` 중 하나라도 사유가 있으면 그 후보 전체를 `rejected`에 넣고 표시하지 않는다.
4. **`actor`는 v1에서 거절한다.** SCENE01/02 이전에는 사람별 귀속을 저장할 곳이 없고, 평면 장면으로 압축하면 누가 무엇을 입었는지 잃는다. 대신 `actor_unknown` 모호성으로 남겨 "왜 후보가 없는지"를 사용자가 알 수 있게 했다.
5. **후보는 수락 경로가 없다.** `AcceptedVariant`는 `selectEntry`/`compileScene`을 호출하지 않고, `situationVariants.ts`에는 accept/apply 함수가 없다(테스트로 고정). 후보 선택·diff·되돌리기는 VAR02다. *(VAR02에서 `variantApply.ts`가 적용·되돌리기를 맡았고, `situationVariants.ts`는 여전히 표시 전용이다.)*
6. **예전 kind 응답은 바이트 그대로다.** `serialize`는 새 kind일 때만 `variants`를 싣고, `unavailable(kind)`도 `variants: []`를 kind와 함께 돌려준다. I03/I06 계약 테스트가 두 구 kind의 payload를 고정하고 있다.
7. **컴포저 패널은 지금 잠들어 있다.** 요청 버튼은 VAR02이므로 `kind: "situation_variants"`를 보내는 코드 경로가 아직 없다. 렌더 규칙·차단 사유·`truncated` 안내는 미리 연결해 두어 VAR02가 버튼만 추가하면 되게 했다. *(VAR02에서 `장소와 행동만 바꾼 상황 3개` 버튼이 그 경로를 연결했다.)*

#### VAR01-2. 완료 조건 대응

| 완료 조건 | 근거 |
| --- | --- |
| 잠금 위반 판정 | `test_a_variant_that_breaks_the_lock_is_rejected_by_the_server`(서버), `test_situation_variants_are_adopted_with_their_diff`(후보/사유), `a candidate that would change the cast or a locked value is carded but not usable`(클라이언트) |
| 후보 초과 판정 | `candidates are capped at three, deduplicated and never repaired`; 응답 상한은 `validate_variants`의 `MAX_VARIANTS` 절단 + `truncated` |
| 누락(빈 diff) 판정 | `no_change` 분기(`_variant_rejections`), `variantBlockReason('no_change')` |
| 사전 밖 복합 행동 | `not_in_dictionary`/`inactive_entry` 분기 + `a clean candidate shows its place/action diff…`의 `unresolved_ko` 원문 보존 |
| kind 간 혼입 거절 | `test_variants_in_a_selection_hint_reply_are_not_adopted`, `test_the_older_kinds_do_not_gain_a_variants_key`, `candidates are read only for their own kind…` |
| 중복 후보 | `test_duplicate_variant_ids_are_rejected_once` |
| 저장 안 함 | `test_the_older_kinds_do_not_gain_a_variants_key`·`test_a_variant_request_that_fails_keeps_an_empty_candidates_key`(`variants` 키 처리), `jobs.spec`·DB 변경 없음 |
| compiler 책임 불변 | `situationVariants.ts`가 `selectEntry`/`compileScene`을 import하지 않음(테스트로 고정), Scene v1 그대로 |

#### VAR01-3. 인계

```text
VAR01 / 완료 / 2026-11-17 / 기준 HEAD: I01–I06 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: frontend/src/prompt/situationVariants.ts, frontend/tests/prompt-situation-variants.test.mjs (7 tests)
- 수정: frontend/src/prompt/llmProposals.ts(VARIANT_KIND·VARIANT_GROUPS·parseVariants·캡·variant 요청 분기·안내 문구),
  components/PromptBuilder.tsx(상황 후보 패널·scope 전달), styles.css(.prompt-variants/.prompt-variant·460px)
- 수정: backend/app/services/prompt_proposals.py, api/proposals.py, services/proposal_provider.py,
  backend/tests/test_prompt_proposals.py·test_proposal_api.py·test_proposal_provider.py
- 문서: API.md, PROMPT_COMPOSER_CURRENT.md, PROMPT_COMPOSER_LLM_AUTOMATION.md, 이 문서
사용자에게 달라지는 동작:
- 아직 없다. 상황 후보를 요청하는 버튼은 VAR02다. 응답이 오면 장소·행동 diff와 사전 밖 표현을
  카드로 보여주며 수락 버튼은 없다.
보존한 계약: Scene v1 / compileScene 출력 의미 / 사전 ID·버전 / builderState / applied 이력 / job 저장.
두 구 kind의 요청·응답 바이트는 그대로다(테스트 고정).
실행한 명령과 결과:
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 108 passed (기준 101 + 신규 7)
- npm --prefix frontend run build -> 성공 (326.70 kB)
- npm --prefix frontend run lint -> 오류 0
- .venv/bin/python -m pytest backend/tests -q -> 48 failed, 364 passed, 6 skipped
  (실패 48건은 전부 test_switch_*이며 macOS에 os.listxattr이 없어 생기는 기존 환경 문제다.
   제안 관련 3개 파일만 돌리면 91 passed)
- .venv/bin/python -m ruff check backend/app backend/tests -> All checks passed
- sh scripts/prompt-composer-browser/verify.sh -> checks 172, failed 0, EXIT 0
- git --no-pager diff --check -> exit 0
미완료·위험·다음 태스크가 알아야 할 사실:
- 실제 LLM 호출은 여전히 0회다. 후보 품질·모델이 `target_groups`를 지키는지는 확인되지 않았다.
- 후보 카드 UI는 렌더 경로만 있고 요청 버튼이 없어 화면에서 도달할 수 없다(VAR02).
- `적용 가능` 판정을 compiler/Scene 타입에서 가져올지는 v1+ 결정으로 남긴다. SCENE01/02 이전에는
  다인 귀속 후보를 만들지 않는다.
```


### VAR02 — 상황 카드 비교·선택 · 완료

- 선행: VAR01 계약 확정. 수정: 후보 카드 UI/제안 상태와 대응 테스트.
- 실행: `장소와 행동만 바꾼 상황 3개`를 명시적 버튼으로 요청. 모바일은 세로 카드, 데스크톱은 가용 폭에 맞춰 배치. 선택 전후 diff·되돌리기. 이미지 3장 자동 생성하지 않음.
- 완료: 후보 선택만으로 최종 prompt/저장 데이터/생성 요청 변경 없음. 오래된 후보 폐기, 잠금 검증, 미반영 내용 안내. 승인된 표현 경로가 없는 복합 상황은 적용 가능하다고 표시하지 않음.

#### VAR02-1. 설계 판단 (근거 있는 것만)

1. **요청은 별도 버튼이고 kind는 고정이다.** `장소와 행동만 바꾼 상황 3개`가 `requestProposal("variant")`를 호출하고, `proposalBody`가 `kind: "situation_variants"`로 보낸다. 기존 `장면 정리하기` 버튼을 재사용하지 않는다 — 두 응답은 서로 다른 패널을 덮어쓰므로 한 버튼이 두 뜻을 가지면 사용자가 어느 쪽을 받는지 알 수 없다. 후보의 `target_groups`는 **항상** `VARIANT_GROUPS`(`pose`·`setting`)이며, 부분 변경 범위를 골라 둔 상태여도 후보는 그 범위를 따르지 않는다(인물을 바꾸는 "상황"은 상황이 아니다).
2. **적용은 카드 하나에 한 번, 그리고 명시적이다.** 후보 도착만으로는 아무것도 바뀌지 않고, 카드의 `적용` 버튼이 유일한 경로다. 차단된 카드에는 버튼이 없고, `applyVariantScene()`이 클릭 시점에 차단 사유와 중복/누락/미등록 ID를 **다시** 확인한다(렌더와 클릭 사이의 경쟁을 막는다).
3. **장면 편집은 기존 경로만 쓴다.** `applyVariantScene()`은 `selectEntry`/`removeEntry`만 호출한다. 후보가 선택기로 만들 수 없는 장면을 만드는 경로는 없고, Scene v1·`compileScene` 의미도 그대로다. 초안은 일반 선택 변경과 똑같이 `withGeneratedDraft`로 다시 만들지만 최종 prompt는 건드리지 않는다.
4. **되돌리기는 "적용 전 장면 전체"를 복원한다.** 후보는 장소·행동을 *제거*하기도 하므로 "이번 클릭이 추가한 ID"만 다시 넣으면 제거된 항목의 저장된 표현을 잃는다. 그래서 `VariantApplyRecord.before`가 장면 전체를 들고, `undoVariantScene()`이 그대로 돌려준다. 허용 여부는 타이머가 아니라 지문(`variantUndoStatus`)이 정한다.
5. **되돌리기 슬롯은 하나다.** 카드 수락 되돌리기(I06)와 상황 적용 되돌리기(VAR02)는 둘 다 "마지막 장면 편집"을 가리키므로, 새 편집이 이전 기록을 대체한다. 두 줄이 동시에 서로 다른 장면을 설명하는 상태를 만들지 않는다.
6. **적용한 후보가 다른 후보를 막지 않는다.** 후보 세 장은 적용 *전* 장면을 기준으로 계속 계산된다(`variantBase`). 그러지 않으면 첫 후보를 적용한 순간 두 번째 후보의 `removed_ids`가 모두 `not_selected`가 되어 "지금 선택에 없는 항목입니다"로 잘못 차단된다. 적용한 카드는 `지금 선택에 반영됨`으로 표시하고 버튼을 숨긴다.
7. **사전 밖 표현은 적용되지 않는다고 말한다.** `unresolved_ko`는 원문 그대로 카드에 남고, 적용 안내 문구가 "사전에 없는 표현 … 은(는) 반영되지 않았습니다"를 덧붙인다. 그 문장이 없는 복합 상황을 "적용 가능"으로 표시하지 않는다는 완료 조건의 이행이다.
8. **오래된 후보는 기존 두 겹 방어로 폐기된다.** 원문·선택·모델이 바뀌면 `invalidateProposal`이 `ready/empty`를 `cancelled/stale_revision`으로 바꾸므로 후보 전체가 사라지고, 적용 직후의 재기준화만 `reapplyProposal`이 담당한다.

#### VAR02-2. 완료 조건 대응

| 완료 조건 | 근거 |
| --- | --- |
| 명시적 버튼 요청 | `VAR02 · 상황 요청 1회`, `VAR02 · 요청 kind`, `VAR02 · 요청 target_groups`(브라우저), `a variant request names its kind and carries the locked cast` |
| 후보 선택만으로 최종 prompt/저장/생성 요청 불변 | `VAR02 · 후보 표시만으로 최종 prompt 불변`·`VAR02 · 적용해도 최종 prompt 불변`(브라우저), `the composer requests candidates explicitly and applies them through the shared path`(모듈이 `onChange`/`withAppliedDraft`/`draftComposition`을 쓰지 않음) |
| 선택 전후 diff | 카드의 `changes`(추가/제거 방향 포함) + `VAR02 · 바뀌는 항목 표시`, `a candidate applies exactly the scene its diff describes` |
| 되돌리기 | `VAR02 · 되돌리면 선택 복원`·`VAR02 · 되돌리기 줄은 하나`(브라우저), `undo restores the exact pre-apply scene, including a removed expression`, `undo is allowed only while the scene still matches the apply` |
| 잠금 검증 | `VAR02 · 인물·의상은 잠금`(요청 `locked_ids`), `VAR02 · 범위 밖 후보 차단`(버튼 없음), `a candidate that cannot be applied is refused, never partly applied` |
| 오래된 후보 폐기 | `VAR02 · 편집 후 후보 폐기`, 기존 `LLM-I04 · 오래된 응답 폐기 문구`, `invalidateProposal` 계약 |
| 미반영 내용 안내 | `VAR02 · 사전 밖 표현은 원문 유지`, `VAR02 · 미반영 표현 안내` |
| 복합 상황을 적용 가능으로 표시하지 않음 | 차단 카드에 적용 버튼 없음(`VAR02 · 적용 버튼은 2개`), `unmappedFamily` 안내, `variantBlockReason` 사유 문장 |
| 모바일 세로 배치 | `VAR02 360px · 가로 넘침 없음`·`카드가 화면 안`·`적용 버튼은 문장 아래`, 스크린샷 `31-variant-360.png` |
| 이미지 3장 자동 생성 없음 | 새 job/생성 경로 없음. `variantApply.ts`는 `onChange`도 `api`도 import하지 않는다 |

#### VAR02-3. 인계

```text
VAR02 / 완료 / 2026-11-18 / 기준 HEAD: I01–I06·VAR01 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: frontend/tests/prompt-variant-apply.test.mjs (6 tests)
- 수정: frontend/src/components/PromptBuilder.tsx(상황 요청 버튼·카드 적용·적용 표시·되돌리기 줄),
  frontend/src/styles.css(.prompt-variant 그리드/적용 버튼/적용 표시/.prompt-variant-undo/460px),
  scripts/prompt-composer-browser/suite-contracts.mjs(스텁 variants 필드, VAR02 섹션 R 46 checks)
- 문서: PROMPT_COMPOSER_CURRENT.md, PROMPT_COMPOSER_LLM_AUTOMATION.md, API.md, 이 문서
사용자에게 달라지는 동작:
- `장소와 행동만 바꾼 상황 3개` 버튼으로 후보를 요청한다. 카드마다 바뀌는 장소·행동과 사전 밖
  표현이 보이고, 쓸 수 있는 후보에만 `적용` 버튼이 있다.
- `적용`은 선택만 바꾸고 초안을 다시 만든다. 원문과 최종 prompt는 그대로이며, 적용한 카드는
  `지금 선택에 반영됨`으로 표시되고 `“…” 상황 적용 되돌리기`가 적용 전 선택을 그대로 복원한다.
- 적용 후 원문이나 선택을 바꾸면 되돌리기가 비활성되고 사유가 뜬다(낡은 기록으로 다른 장면을
  되돌리지 않는다). 카드 수락 되돌리기와 상황 되돌리기는 한 슬롯을 공유한다.
보존한 계약: Scene v1 / compileScene 출력 의미 / 사전 ID·버전 / builderState / applied 이력 /
job 저장 / 서버 라우트·proposal 응답 스키마 전부 무변경. 후보 배열은 어떤 저장 경로에도 들어가지 않는다.
실행한 명령과 결과:
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 114 passed (기준 108 + 신규 6)
- npm --prefix frontend run build -> 성공 (330.43 kB)
- npm --prefix frontend run lint -> 오류 0
- sh scripts/prompt-composer-browser/verify.sh -> checks 218, failed 0, EXIT 0
브라우저 환경: Playwright 번들 Chromium(chromium-1228, headless CDP), fake 백엔드 + Vite, 1280/360.
관찰한 DOM/텍스트: 요청 {"kind":"situation_variants","target_groups":["pose","setting"],
locked_ids":["subject.person","clothing.white_shirt"]}, 후보 3장(차단 1·적용 버튼 2),
머리글 "상황 후보 3개 · 표시 불가 1", 적용 후 chips ["인물","흰 셔츠","앉기","카페"]·
`“카페에 앉기” 상황 적용 되돌리기`, 되돌린 뒤 chips ["인물","흰 셔츠","서 있기","거리"]·
버튼 사라짐, 편집 후 되돌리기 disabled + "상황을 적용한 뒤 선택이나 원문이 바뀌어 되돌릴 수
없습니다…", 360px 적용 버튼 폭 272px·가로 넘침 없음.
미완료·위험·다음 태스크가 알아야 할 사실:
- 실제 LLM 호출은 여전히 0회. 후보 3장은 페이지 스텁이며 모델이 `target_groups`를 지키는지,
  후보 문장 품질이 어떤지는 확인되지 않았다.
- 후보는 적용해도 저장되지 않는다. 적용된 선택만 장면·구성 이력에 남고, 후보 문장 자체는
  원문·최종 prompt·job 어디에도 없다.
- 되돌리기는 한 단계이고 다음 장면 편집(카드 수락 포함)이 기록을 대체한다. 다단계 이력 없음(의도적).
- 두 번째 후보 적용은 "쌓기"가 아니라 "교체"다. 세 후보 모두 같은 시작 장면 기준으로 적용·되돌린다.
- 후보의 `unresolved_ko`는 적용 경로가 없다. 사전에 표현을 추가하기 전에는 문장만 남는다.
- EVAL-UX01이 이 화면을 재사용할 수 있지만 실제 모델 응답 평가는 아직 없다.
```

### EVAL-UX01 — 설명 작업의 효율·의도 보존 평가 · 완료 (2026-11-18)

- 선행: UX05(규칙 모드 기준선), LLM-I05 및 VAR02(각 구현 후 같은 평가 재사용). 기존 EVAL01/02의 원문 fixture를 재사용하되 지표는 분리. — **충족.** EVAL01/02가 아직 fixture를 만들지 않았으므로 손수 작성한 12장면을 이 태스크가 직접 만들었다(재사용할 대상이 없었다).
- 실행: 공통 예시와 제품/풍경/다인/부정/부분 수정 등 12개 수작업 장면으로 입력→초안 승인 시간·클릭 수·원문 의미 누락·원치 않은 추가·수정 횟수 기록. LLM 실제 연결 전 fixture 평가와 실제 응답 평가 구분. — **완료.** 클릭·누락·원치 않은 추가·수정 횟수는 측정했고, **시간은 측정하지 않았다**(사람이 없었다. 자동화 시간만 있고 이를 사람 시간으로 쓰지 않는다). 실제 응답 평가는 하지 않았으므로 "fixture 평가"로만 표시했다.
- 완료: 분모·기준 소스·모델 설정·실패 사례와 사용자 의견 기록. 미측정 시간을 추정하지 않음. GPU 이미지 품질은 QUALITY01/02 별도. “최적” 판정은 비교 결과 없이 내리지 않음. — **충족.** 단 **사용자 의견은 여전히 없다**(U11 선행). 문서는 그 사실을 7절에 명시했다.
- 결과: [PROMPT_COMPOSER_EVAL_UX01.md](PROMPT_COMPOSER_EVAL_UX01.md) · 스크립트 `scripts/eval-ux01/` · 테스트 `frontend/tests/prompt-eval-ux01.test.mjs`(10) · 원자료 `docs/evidence/prompt-composer-eval-ux01/`.

#### EVAL-UX01-1. 인계

```text
EVAL-UX01 / 완료 / 2026-11-18 / 기준 HEAD: VAR02 미커밋 변경 위
변경 파일과 사용자에게 달라지는 동작:
- 신규: scripts/eval-ux01/scenes.mjs(12장면 fixture), scripts/eval-ux01/evaluate.mjs(규칙 모델),
  scripts/eval-ux01/browser.mjs + browser.sh(실제 UI 클릭 측정),
  frontend/tests/prompt-eval-ux01.test.mjs(10 tests), docs/PROMPT_COMPOSER_EVAL_UX01.md,
  docs/evidence/prompt-composer-eval-ux01/{results.json,summary.txt,browser.json,browser-results.json}
- 수정: 이 문서(상태·인계), docs/PROMPT_COMPOSER_CURRENT.md(평가 문서 연결)
사용자에게 달라지는 동작: **없음.** 사전·컴파일러·Scene v1·API·저장 계약·화면 모두 무변경.
측정한 값(규칙 모드, sd15, 사전 1.2.0, compiler 1.3.0, LLM 0회):
- 기대 38 · 적중 29(recall 76.3%) · 누락 9 · 원치 않은 추가 3 · 미분류 2
- precision 91.2%(31/34) · 판정 가능 precision 90.6%(29/32) · 사전 밖 표현 23개
- 규칙 경로 클릭 80(장면당 6.7), 그중 수동 보정 27(누락 9 × 3), 규칙 제안만 쓸 때 53
- 부분 변경: 범위 lighting · 잠금 [인물, 흰 셔츠] · 수락 [어두운 조명] · 차단 [카페:out_of_scope]
- 상황 후보(스크립트): 장면당 3장 중 2장 적용 가능 · 1장(의상 변경) 12/12 차단 · 되돌리기 12/12
실제 UI(Chromium 1280×900, fake 백엔드, 3회 연속 동일):
- 클릭 43(장면당 3.58) · 모델과 클릭 일치 12/12 · 초안 = compileScene 12/12
- 적용 후 최종 프롬프트 = 초안 11/11 · 초안이 비어 승인 불가 1(landscape-lake-dusk)
보존한 계약: Scene v1 / compileScene 출력 의미 / 사전 ID·버전 / builderState / applied 이력 /
job 저장 / 서버 라우트 전부 무변경. 평가 스크립트는 네트워크·생성 경로를 호출하지 않는다.
실행한 명령과 결과:
- node --experimental-strip-types scripts/eval-ux01/evaluate.mjs -> 표 + 합계 출력
- sh scripts/eval-ux01/browser.sh -> checks 8, failed 0 (3회 연속, 클릭 합계 43 동일)
- node --experimental-strip-types --test frontend/tests/*.test.mjs -> 124 passed (기준 114 + 신규 10)
- node --experimental-strip-types --test frontend/tests/prompt-eval-ux01.test.mjs -> 10 passed
미완료·위험·다음 태스크가 알아야 할 사실:
- **사람의 시간을 측정하지 않았다.** 자동화 소요 7.6초는 UI 반응 시간이며 입력→승인 시간이 아니다.
- **실제 LLM 응답 평가가 아니다.** 호출 0회. 후보 문장은 스크립트이므로 후보 품질·target_groups
  준수는 판단할 수 없다. 실제 연결 후 같은 fixture로 다시 측정해야 한다.
- **사용자 의견이 없다.** U11이 여전히 선행이며 이 평가가 그 의견을 대신하지 않는다.
- fixture 기대값은 문장을 읽고 직접 판정했다. 규칙 출력을 복사하지 않았고, 그 사실을 테스트로
  고정했다(`the expectations were not derived from the engine under test`).
- 실패 9건은 제품 결함 후보 목록일 뿐 수정하지 않았다(부정 장면 인물 오탐 2, 다인→단수 1,
  활용형/별칭 누락 4, 규칙 경로의 범위 무시 1, 사전 밖 표현 23).
- 규칙 경로에는 부분 변경 범위 개념이 없다. `partial_change` 경로만 `out_of_scope`로 막는다.
  이 차이는 문서 4절 8번에 적었다.
- 테스트가 합계(38/29/9/3/2/80/43…)를 고정한다. 사전이나 매처를 바꾸면 깨지는 것이 정상이며
  문서와 테스트를 함께 갱신한다.
```

### 캡처가 없을 때의 검증·인계 방식

각 실행자는 아래 형식으로 현재 구현을 **텍스트로 묘사**한다. 디자인 의도와 실제 관찰을 구분한다.

```text
태스크 / 기준 HEAD / 변경 파일:
화면 위→아래 순서 및 기본 펼침 상태:
빈 상태 / 입력 중 / 제안 중 / 오류 / 수락 후 / 직접 수정 후:
버튼명 → 클릭 효과 → 바뀌지 않아야 할 데이터:
키보드 진입점 / 다음 초점 / 삭제 후 초점:
360·390px 예상 배치 / 실제 확인한 배치:
테스트 명령과 결과:
브라우저 관찰: DOM·접근성 트리·activeElement·측정값 또는 실행 불가:
미검증: 시각적 겹침·줄바꿈·실기기 터치 등:
다음 실행 ID와 선행 완료 여부:
```

캡처가 없어도 사용 가능한 브라우저의 DOM/접근성 트리·초점·크기 측정으로 기능을 확인할 수 있다. 브라우저 연결 자체가 없으면 소스/단위 테스트까지만 기록하고 화면 실측·키보드 조작 통과를 주장하지 않는다. UI가 구현 완료/시각 검증 대기여도 그 결함에 의존하지 않는 다음 구현은 진행 가능하며 U11/U12의 최종 종료는 보류한다. 기존 도구 접근 규칙을 우회해 브라우저를 실행하지 않는다.

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
| LLM01 / LLM-C01로 분해 | P8-L01 | §1A의 LLM-C01에서만 실행·상태 관리 | 별도 중복 구현 없음 |
| LLM02 / LLM-C02로 분해 | P8-L01 | §1A의 LLM-C02(완료) 및 후속 LLM-I01–I06에서 실행 | 계약 결정 전 endpoint·저장 의미 변경 없음 |

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
| AUDIT-A6 / 검토 대기 | LLM-A6, SCENE01·LLM-C01 | actor 귀속 제안과 불명확성 표시 예시 작성 | 사용자 수락 전 귀속 변경 없음. Scene v1을 임의 확장하지 않음 |

## 6. 접근성·플랫폼 잔여 검증

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| AT01 / 환경 대기 | P5-C03-AT, U09 | 실제 브라우저 200% 확대 및 360/390px와 소프트 키보드 확인 | viewport 축소와 실제 zoom을 구분. 가려진 입력·적용 버튼·focus clipping의 증거. 결함은 U09로 환류 |
| AT02 / 환경 대기 | P5-C03-AT, U09 | 실제 보조기기에서 이름·상태·오류·분류·선택 해제 낭독 검증 | OS/브라우저/스크린리더·실행 순서·관찰 기록. 자동 axe만으로 대체하지 않음 |
| PLATFORM01 / 대기 | TEST-PLATFORM01 | 기존 실패 보고에서 48개 실패의 파일/실패명/최초 예외/OS 기능 의존 목록 정리 | 문서의 기존 분류를 가설로 취급. 전체 실패를 자동으로 환경 탓으로 닫지 않음. 기존 실패를 숨기는 skip 추가 금지 |
| PLATFORM02 / 환경 대기 | TEST-PLATFORM01, PLATFORM01 | 격리 Linux/Fedora에서 같은 커밋·의존성·명령 실행 후 비교 | 0건 확인 또는 실제 결함별 후속 ID 생성. 운영 서비스/권한 변경 없이 실행 가능한 환경 필요 |

## 이번 대조의 검증 기록 (2026-11-17)

- F: **61/61 통과**, build·lint·tsc 통과.
- P: **14/14 통과**(prompt composition 및 coordination capability). 과거 `max_body_bytes` 실패와 관련된 capability 테스트를 포함한다.
- 브라우저(B): `sh scripts/prompt-composer-browser/verify.sh` **103/103 통과**, 2회 연속. UX01–UX05와 VERIFY01/VERIFY02 항목 포함. 결과 파일은 `docs/evidence/prompt-composer-gap04/results.json`, 캡처 17장(`01-open.png`–`17-capability-offline.png`).
- 화면 관찰: DOM 순서·`activeElement`·요소 크기·`aria-expanded`를 측정했다. 1280×900, 390px, 360px 뷰포트에서 가로 넘침 없음. 실제 확대/보조기기·소프트 키보드는 미검증(AT01/AT02).
- S/전체 pytest·운영/GPU·LLM 호출은 실행하지 않았다. 재시도·capability 검사는 `STUDIO_ENGINE=fake`와 격리 데이터 디렉터리에서만 수행했고 운영 데이터를 쓰지 않았다.
- 같은 계열/계열 전환·재시도·capability 실패는 이번 실행 결과이며, 기존 58건을 재사용하지 않았다.

## 2026-11-17 설명 우선 UX 태스크 분해 인계

UX01–UX05, LLM-C01/C02, LLM-I01–I06, VAR01/02, EVAL-UX01을 신규 실행 단위로 정의했다. 사용자 합의 방향은 반영했으며 개별 API/저장/컴파일 계약은 C01/C02에서 구체화한다. UX01–UX05는 구현과 브라우저 검증(103/103, 2회 연속)을 마쳤고, VERIFY01/VERIFY02도 판정을 강화해 완료했다. 다음 실행 태스크는 **U11(사용자 화면 확인)**이다. LLM·GPU·운영 실행은 하지 않았다.

### 인계 (VERIFY01/VERIFY02, 2026-11-17)

```text
ID / 상태 / 날짜 / 기준 HEAD: VERIFY01·VERIFY02 / 완료 / 2026-11-17 / 526991e 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작: suite-keyboard/suite-contracts/suite-messages/suite.mjs/ui.mjs/run.mjs/verify.sh, PromptBuilder.tsx(포커스 커밋 타이밍, #prompt-search). 사용자 화면 동작 변화는 “마지막 칩 제거 후 검색 포커스가 항상 보이는 입력으로 감”뿐이다.
보존한 계약: Scene v1, 컴파일 출력 의미, applied 이력, 직접 생성, retry API. 스키마/저장 의미 변경 없음.
실행한 명령과 결과: verify.sh 103/103 (2회), npm run build·lint 통과, tsc --noEmit 통과, frontend 테스트 61/61.
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰: HeadlessChrome 149, 1280×900/390/360. Tab 4정지점과 Shift+Tab 역순 일치, 계열 전환 문자열 완전 일치, stale 미적용, 재시도 카드 클릭→retry_of 생성, capability fetch 거절 후 직접 입력 유지 관찰.
미완료·위험·다음 태스크가 알아야 할 사실: 실제 200% 확대·보조기기·소프트 키보드 미검증(AT01/AT02). HTTP 422/413은 UI 거절 표시 시험이지 실제 서버 한도 검증이 아니다. applyDisabled가 null(버튼 미노출)인 경우도 적용 불가로 판정한다.
```
