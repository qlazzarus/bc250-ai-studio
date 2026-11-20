# 2026-11-18 검증 기록 (LLM-R01–R07 및 플랫폼 가드)

> 2026-11-18 보관본. 활성 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다.

이 파일은 활성 문서의 "이번 대조의 검증 (2026-11-18)" 절 전체를 옮긴 것이다. 포함된 수치:

- RULE01·RULE02·METRIC01 반영 후 프론트 `F` 131/131, 브라우저 225/225, 평가 하네스 8/8.
- LLM 경로 리뷰 대조에서 실행한 명령과 결과(카탈로그 3형태 바이트, 요청 본문 한계 2,592자).
- LLM-R01–R07 구현 결과: `L` 106 passed, `F` 133 passed, 전체 `backend/tests` 337 passed / 96 skipped / 0 failed, `ruff check backend` 통과.
- 실측 payload와 8 KiB 잔여 여유(선택/잠금 조합별), R03의 요청 바이트 영향 0.

**이 수치는 로컬 실행 결과이며 실제 모델 품질이나 운영 성공을 입증하지 않는다.** 스킵 96건은 Linux 전용 model-switch 9개 모듈과 기존 `test_root_namespace.py`이고, `sys.platform` 가드로 처리했다. Linux에서 가드가 풀려 그대로 실행된다.

---

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
