# 사전 프롬프트 단일 실행 태스크

갱신일: 2026-11-17 · 기준: HEAD `eb5664c` + 현재 미커밋 구현(GAP01–GAP03, App 메시지, 브라우저 하네스). **사전 프롬프트의 활성 상태·선행 조건·완료 기준은 이 문서에서만 관리한다.** CURRENT는 구현 설명, P5/LLM 문서는 계약·설계 참고자료이며 별도 진행표로 사용하지 않는다.

완료된 구현·검증의 상세 기록은 [2026-11-17 archive](archive/prompt-composer/2026-11-17/README.md), 이전 단계는 [2026-11-16 archive](archive/prompt-composer/2026-11-16/README.md)에 있다. archive의 상태는 당시 주장이고 현재 완료 판정은 아래를 따른다.

## 현재 판정과 우선순위

- 코드 대조 결과 GAP01(포커스 복귀), GAP02(정보/주의/오류 분리), GAP03(전체 목록 + 대상 시작 버튼)는 구현됐다. U01–U08의 진행 기록은 archive로 이동했다.
- GAP04/U09/U10은 기존 58개 검사 통과 기록이 있으나 **검증 보완 필요**다. 아래 VERIFY01/VERIFY02가 남았으므로 “사용자 의견만 남음”으로 닫지 않는다.
- P6-UX-R2 실행 순서: **VERIFY01 → VERIFY02 → U11 → U12**. 실제 확대/보조기기는 AT01/AT02, GPU/운영은 별도 후속이다.
- 원래 상위 ID와 아래 자식 ID는 같은 작업의 묶음이다. 부모 완료는 모든 필수 자식의 증거가 있을 때만 갱신한다.
- Actions 최적화 DEP01–DEP03과 플랫폼 PLATFORM01–PLATFORM02는 사전 프롬프트 자체 기능이 아닌 공통 의존 작업이다. 요청 이력 보존을 위해 이 문서의 후속 표에 남기며 UX 완료와 혼동하지 않는다.

## 공통 실행 지시문

다음 블록의 ID만 바꿔 실행자에게 전달한다.

```text
이 저장소에서 docs/PROMPT_COMPOSER_EXECUTION_TASKS.md의 <태스크 ID> 하나를 수행한다.
먼저 git status --short, 해당 명세, 선행 태스크 인계 기록, 수정 대상 소스를 읽는다.
기준 커밋 이후 변경과 사용자 작업을 보존하고 현재 코드에 맞춰 수행한다.
선행 태스크가 미완료면 의존 작업을 구현하지 말고, 가능한 조사와 구체적인 차단 사유를 기록한다.
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
| F | `node --experimental-strip-types --test frontend/tests/*.test.mjs` | 기존 38건 기준. 데이터·컴파일러·P5·규칙 제안 회귀. Python/Pydantic 교차 검증 의존성 필요 |
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
실제 브라우저 환경·스크린샷/관찰 파일 (없으면 미검증):
미완료·위험·다음 태스크가 알아야 할 사실:
```

## 1. 최우선: P6-UX-R2 남은 검증

### VERIFY01 — 키보드·계열 전환 검사의 판정 강화 · 대기

- 연결: GAP04/U09/U10. 수정: `scripts/prompt-composer-browser/suite-keyboard.mjs`, `suite-contracts.mjs`, 필요한 최소 driver/결과 기록. 제품 코드는 결함이 재현되었을 때 별도 근거를 남겨 수정.
- 확인된 갭: `suite-keyboard.mjs:23`은 `backward.length === 3`만 확인한다. 키 입력이 실패해도 기록이 세 번 쌓이면 통과한다. `suite-contracts.mjs:110`은 계열 전환 후 문자열 길이만 검사해 실제 최종 입력 보존을 보장하지 못한다. `applyDisabled`는 수집만 하고 판정하지 않는다.
- 실행: Tab 전진 경로의 요소 식별자를 저장하고 Shift+Tab 후 예상 역순 요소와 비교. 계열 전환 전후 최종 문자열의 정확한 일치, stale 초안 적용 불가, 재생성 후 진행 가능을 검사.
- 완료: 정상 경로 통과와 잘못된 초점/변경된 문자열/활성 stale 적용을 거부하는 판정 근거. 360/390px·데스크톱 실제 브라우저 환경·입력·예상·실제 결과 기록. 브라우저를 실행하지 못하면 미검증 유지.

### VERIFY02 — 누락 시나리오와 검증 범위 정정 · 대기

- 선행: VERIFY01. 연결: GAP04/U10. 수정: 브라우저 suite·fake fixture·검증 결과 자료. 운영 데이터 사용 금지.
- 확인된 갭: 현재 suite-contracts의 “generation and retry”는 완료 작업 생성·복원만 확인한다. 실패 작업의 retry 버튼/API 경로는 검사하지 않는다. 같은 계열 `fake-sd15 → fake-sd15-alt` 및 capability 요청 실패(현재 빈 응답 미지원만 있음)의 검증 근거도 없다.
- 실행: 실패 작업 fixture로 retry 요청/결과 및 구성 스냅샷 보존 확인. 같은 계열 모델 전환의 최종 입력·선택·적용 상태 보존 확인. capability 네트워크 실패 시 직접 생성 경로 유지 확인.
- 완료: 행별 예상/실제/증거. 기존 HTTP 422/413은 fetch 대체에 따른 UI 거절 처리 시험임을 명시하고 실제 서버 한도 검증과 분리. 재시도 버튼 활성만으로 실제 retry 성공을 주장하지 않음. 기존 58건을 새 실행 결과로 재사용하지 않음.

### U11 — 사용성 비교와 사용자 화면 확인 · 사용자 확인 대기

- 선행: VERIFY01/VERIFY02. 수정: 이 문서의 결과 인계 및 증거 자료.
- 기존 8개 선택 비교 계측은 [과거 UX_LAYOUT §7](archive/prompt-composer/2026-11-17/PROMPT_COMPOSER_UX_LAYOUT.md)에 보존했다. GAP01–GAP03 이후 현재 화면의 새 계측으로 취급하지 않는다.
- 실행: 현재 화면의 데스크톱/360/390px에서 탐색·장면 요약·원문 반영·미리보기·적용 흐름을 제시하고 사용자 의견 기록. 새 변경이 수치에 영향을 주면 동일 장면으로 다시 측정하고 기준 소스를 명시.
- 완료: 사용자의 화면 의견과 반영/보류 결정 기록. 무응답은 승인 아님. 문서 좌표 거리를 사용자 스크롤 왕복 감소로 환산하지 않음. 1열 구조는 기존 실측 채택안이며 2열 자체를 완료 조건으로 되살리지 않음.

### U12 — 정합성 회귀와 상위 종료 · 대기

- 선행: VERIFY01/VERIFY02 및 U11 완료. 기존 GAP01–GAP03을 다시 구현하지 않음.
- 실행: F·B·S·P·D, 저장 스냅샷·retry·직접 생성의 변경 영향 확인. 이번 대조에서 통과한 검사는 추가 변경이 없으면 재사용 가능하나 범위와 시점 명시.
- 완료: P6-UX-R2 필수 자식의 실패/미검증·사용자 의견을 정리하고 완료 기록을 archive로 이동. 이 문서에서는 완료 상세를 제거하고 다음 활성 작업을 명시. 운영 배포/GPU/보조기기 검증을 함께 완료로 표시하지 않음.

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

## 4. Scene v2·참조 이미지·LLM — 설계만

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| SCENE01 / 대기 | P7-S01, U12 | scene.ts 및 P5 설계를 읽고 actor/공통 환경/관계의 예시 JSON 문서 작성 | 단일/다인/귀속 불명 예시, v1은 자동으로 특정 actor에 귀속하지 않음 |
| SCENE02 / 검토 대기 | P7-S01, SCENE01 | v1 보존·명시 변환·구 클라이언트 읽기·복구 설계 | 저장 버전/마이그레이션 영향 보고. schema 구현 없음 |
| IMAGE01 / 대기 | P7-I01, U12 | upload/권한/보관·조건 전처리·엔진 입력의 요구사항 표 작성 | ControlNet/IP-Adapter/img2img 각각 현재 capability와 필요한 새 계약 분리 |
| IMAGE02 / 검토 대기 | P7-I01, IMAGE01·SCENE01 | 참조 자산 연결·실패 복구·GPU 메모리 평가 계획 | 실제 모델/엔진 검증 전 지원 약속 금지. 업로드 API 구현 없음 |
| LLM01 / 대기 | P8-L01, U12 | proposals.ts와 LLM_AUTOMATION을 대조해 요청/응답·원문/제안 diff·timeout/cancel 계약 문서 작성 | 누락/없는 ID/중복/불완전 응답 거절, 원문 보존 사례. 서버 호출 없음 |
| LLM02 / 검토 대기 | P8-L01, LLM01 | Client/gate 인증·admission/drain·제안 적용/거부·실패 fallback 설계 | GPU 기본 생성 경로와 분리. credentials/browser 직접 llama 접근 금지. 승인 전 endpoint 추가 없음 |

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
| AUDIT-A6 / 검토 대기 | LLM-A6, SCENE01·LLM01 | actor 귀속 제안과 불명확성 표시 예시 작성 | 사용자 수락 전 귀속 변경 없음. Scene v1을 임의 확장하지 않음 |

## 6. 접근성·플랫폼 잔여 검증

| ID / 상태 | 상위·선행 | 수정 대상 / 작업 | 검증·완료 산출물 |
| --- | --- | --- | --- |
| AT01 / 환경 대기 | P5-C03-AT, U09 | 실제 브라우저 200% 확대 및 360/390px와 소프트 키보드 확인 | viewport 축소와 실제 zoom을 구분. 가려진 입력·적용 버튼·focus clipping의 증거. 결함은 U09로 환류 |
| AT02 / 환경 대기 | P5-C03-AT, U09 | 실제 보조기기에서 이름·상태·오류·분류·선택 해제 낭독 검증 | OS/브라우저/스크린리더·실행 순서·관찰 기록. 자동 axe만으로 대체하지 않음 |
| PLATFORM01 / 대기 | TEST-PLATFORM01 | 기존 실패 보고에서 48개 실패의 파일/실패명/최초 예외/OS 기능 의존 목록 정리 | 문서의 기존 분류를 가설로 취급. 전체 실패를 자동으로 환경 탓으로 닫지 않음. 기존 실패를 숨기는 skip 추가 금지 |
| PLATFORM02 / 환경 대기 | TEST-PLATFORM01, PLATFORM01 | 격리 Linux/Fedora에서 같은 커밋·의존성·명령 실행 후 비교 | 0건 확인 또는 실제 결함별 후속 ID 생성. 운영 서비스/권한 변경 없이 실행 가능한 환경 필요 |

## 이번 대조의 검증 기록 (2026-11-17)

- F: **57/57 통과**, build·lint 통과.
- P: **14/14 통과**(prompt composition 및 coordination capability). 과거 `max_body_bytes` 실패와 관련된 capability 테스트를 포함한다.
- S/전체 pytest·운영/GPU·새 브라우저 실행은 하지 않음. 기존 결과 JSON의 58개 `pass=true`와 17개 참고 기록을 소스와 대조했으며 이를 새 실행으로 보고하지 않는다.
- 기존 소스 변경은 보존했고 이번 작업은 문서 통합/정정만 수행했다. 추가 미완료 범위는 VERIFY01/VERIFY02에 흡수했다.
