# 2026-11-18 사전 프롬프트 완료 범위와 기록

현재 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)에서만 관리한다. 기준 HEAD `16f3a34`. 이 폴더의 완료 문장은 당시 주장이며 아래 제한을 우선한다.

이번 정리에서 **완료된 태스크의 상세 명세·계약·인계를 활성 문서에서 이 폴더로 옮겼다.** 활성 문서는 "앞으로 실행할 태스크"만 담고, 완료분은 ID·날짜·보관 위치만 가리키는 완료 원장을 둔다.

- [LLM 경로 리뷰와 LLM-R01–R07](LLM_PATH_REVIEW_AND_R01_R07.md): §0 리뷰 판정, 확인된 파이프라인, 유지할 강점, 결함↔태스크 매핑, R01–R07 명세와 구현 인계. **LLM 경로 계약 서술의 정본.**
- [RULE01·RULE02·METRIC01](RULE01_RULE02_METRIC01.md): 규칙 제안 오탐·범위 보존·지표 분모 정정의 명세와 인계.
- [2026-11-18 검증 기록](VERIFICATION_2026-11-18_R01_R07.md): 실행한 명령·수치, 실측 payload, 8 KiB 잔여 여유, 플랫폼 스킵 처리.
- [기존 실행 명세와 계약·인계](PROMPT_COMPOSER_EXECUTION_TASKS.md): UX01–05, VERIFY01/02, LLM-C01/C02, LLM-I01–I06, VAR01/02의 구현과 로컬 검증 기록. C01/C02/VAR01 계약 본문도 이 파일에 보존했다.
- [규칙/fixture 평가 기준선](PROMPT_COMPOSER_EVAL_UX01.md): EVAL-UX01의 실행된 부분만 보관. 실제 LLM·사용자 시간·사용자 의견은 미완료이며 EVAL-UX02/U11로 승계했다. precision 미분류 처리 문제는 METRIC01, 평가 실패 사례는 RULE01–03 및 VAR03/LIVE 태스크로 추적한다.
- [구현 설명 이전 버전](PROMPT_COMPOSER_CURRENT.md).
- 기존 `docs/evidence/` 원자료와 재현 스크립트는 원래 위치에 유지한다. 이번 정리에서 새 브라우저/LLM/GPU 실행은 하지 않았다.

**인용 주의**: 위 파일들의 완료 표시는 당시 로컬 검증 범위다. 예를 들어 LLM-R01–R07의 `L` 106건·`F` 133건·전체 `backend/tests` 337 passed/96 skipped는 로컬 실행 결과이며 실제 모델 품질이나 운영 성공을 뜻하지 않는다. archive는 과거 증거이므로 현재 성공을 만들기 위해 수정하지 않는다.
