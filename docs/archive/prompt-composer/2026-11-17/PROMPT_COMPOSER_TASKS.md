> 역사 보관본: 2026-11-17 통합 직전 기록. 당시 완료 주장은 현재 판정이 아니며, 현재 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다.

# Prompt Composer 작업 안내

갱신일: 2026-11-16 · 소스 기준 `730e077`.

현재 기능은 [구현 현황](../../../PROMPT_COMPOSER_CURRENT.md), 미완료 항목과 완료 기준은 [후속 추적](PROMPT_COMPOSER_FOLLOWUP.md)에서 관리한다. 상세 설계는 [P5/P6–P8 문서](../../../PROMPT_COMPOSER_P5.md)와 [LLM 자동화 제안](../../../PROMPT_COMPOSER_LLM_AUTOMATION.md)을 따른다.

최우선은 [P6-UX-R2 사전 구성 사용성 재설계](PROMPT_COMPOSER_UX_REVIEW.md)다. 기존 P6-UX 기능 완료와 별개로 실제 장면 구성의 사용성을 개선한다. **2026-11-16 기준 U01–U10 완료, U11 계측 완료·사용자 의견 대기, U12 대기**다([실행 명세](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)).

실행자에게 전달할 [태스크별 명세와 공통 지시문](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)에 정리했다. UI 우선 12개 태스크 이후 운영·계약·품질·LLM·접근성·플랫폼 항목을 순서대로 진행한다.

## 현재 단계

| 범위 | 상태 |
| --- | --- |
| 사전 1.2.0·컴파일러 1.3.0·Scene/API v1 | 구현됨. 네 실제 계열 100개 매핑, 품질 보장과 별개 |
| P5-A/B·R01/R02 | 로컬 구현·관련 회귀 검증 완료 |
| P5-C01/C02·P6-UX | 2026-11-15 로컬 Chromium 관찰 기록 있음 |
| P5-C03 | 키보드·360/390px·확대 상당 viewport 검증 기록 있음. 실제 스크린리더/브라우저 확대는 후속 |
| TEST-D01 | dev httpx2 도입 및 Studio suite 경고 제거 |
| A5/A7 | 로컬 결정론 후보/경고 제안 구현. 실제 LLM 호출·서버 제안 API 없음 |
| P5 릴리스·S4/P6 GPU 품질 | 미완료 |
| renderer·Scene v2·LLM·부분 배포 | 설계/후속 범위 |

## Archive

완료된 작업의 상세 계획·단계별 테스트 수·배포 당시 관찰은 [2026-11-16 archive](../2026-11-16/README.md)로 보관했다. 과거 계획 문장의 미구현/대기 상태는 당시 시점의 기록이며 현재 상태로 읽지 않는다. API 계약과 후속 설계는 현재 문서에 유지한다.
