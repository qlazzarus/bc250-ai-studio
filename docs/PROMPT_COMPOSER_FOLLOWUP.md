# Prompt Composer 남은 작업 추적

갱신일: 2026-11-16 · 소스 기준 `730e077`. 완료된 로컬 구현·검증 기록은 [archive](archive/prompt-composer/2026-11-16/README.md)로 이동했다. 기존 ID는 유지하며 완료 기록을 삭제하지 않는다. 현재 동작은 [구현 현황](PROMPT_COMPOSER_CURRENT.md), 후속 설계는 [P5/P6–P8 계약](PROMPT_COMPOSER_P5.md)과 [LLM 자동화](PROMPT_COMPOSER_LLM_AUTOMATION.md)를 따른다.

이번 갱신은 활성 항목을 코드·테스트·workflow와 대조한 보고를 추가한 것이다. 실행 범위는 프런트 단위 테스트·Studio suite·전체 pytest이며, 브라우저·운영 서버·GPU는 실행하지 않았다. 항목 상태는 TEST-PLATFORM01의 근거 보강 외에는 바꾸지 않았다.

> **이후 진행 (2026-11-16):** 이 문단은 위 대조 시점의 기록이다. 그 뒤 P6-UX-R2 U01–U10 구현과 실제 Chromium 검증(U10), 비교 계측(U11)을 수행했다. 현재 상태는 아래 "활성 항목" 표를 따른다.

## 실행 태스크

Terra medium / DeepSeek 4.1 Flash에 한 번에 하나씩 넘길 작업은 [세부 실행 명세](PROMPT_COMPOSER_EXECUTION_TASKS.md)에 정리했다. **U01–U12 중 U01–U10은 완료, U11은 계측 완료·사용자 의견 대기, U12는 대기다.** 부모 ID는 이 목록, 자식 상태·선행 조건·허용 파일·검증·인계는 실행 명세에서 관리한다. 문서 분해 자체를 기능 완료로 처리하지 않는다.

## 활성 항목

| ID | 우선순위 / 상태 | 남은 작업과 다음 행동 | 완료 기준 |
| --- | --- | --- | --- |
| P6-UX-R2 | **최우선 / U01–U10 완료·U11 계측 완료(사용자 의견 대기)·U12 대기** | [사전 구성 사용성 재검토](PROMPT_COMPOSER_UX_REVIEW.md) → [배치안·실측](PROMPT_COMPOSER_UX_LAYOUT.md) → [실행 명세](PROMPT_COMPOSER_EXECUTION_TASKS.md). 남은 일은 U11 사용자 의견 기록과 U12 정합성 회귀뿐이다 | 단위 50건·빌드·lint·실제 Chromium 38개 검사 통과. U11 비교 계측은 UX_LAYOUT §7. **사용자 화면 확인 없이는 종료하지 않는다** |
| DEPLOY-OPT01 | 중간 / 설계만 | [변경 영역별 Actions 최적화](ACTIONS_DEPLOY_OPTIMIZATION.md): 마지막 성공 배포 기준·실서버 상태 확인·부분 아티팩트/설치 경로 검토 | 미배포 변경 누락·실패 복구·호환성 테스트 및 시간 측정. 현재 전체 배포 유지 |
| P5-L01 | 높음 / 미착수 | P5-C·원래 회귀·화면 검증 통과 후 운영 배포·롤백 검증 준비. 구 서버 capability 누락, 새/구 이력 읽기, 실제 HTTP 한도와 프록시 한도 점검 | 대상 릴리스·백업·배포/복구 절차 및 실행 결과 기록. 현재 미배포 |
| P5-D01 | 중간 / 설계만 | 자유 입력 반영 방식·적용 당시 문자열/fingerprint·renderer/provenance 영속화 계약 검토 | 구 데이터 unknown 처리·구 클라이언트 호환·마이그레이션 대안 제시. 저장 계약 변경 전 승인 |
| P6-Q01 | 중간 / 설계만 | 기존 compiler 재사용 및 체크포인트별 renderer profile 설계 구체화 | 기본/미지원 처리와 구 snapshot 보존 테스트 계획. 전면 전환은 별도 구현 |
| P6-Q02 | 중간 / 미착수 | 12개 대표 장면 × seed 17/42/123의 기존/후보 비교. 지원 모델과 설정을 먼저 확정 | 체크포인트/엔진/설정/실제 seed·이미지·실패·사용자 평가 기록. GPU 실행 전 품질 우위 주장 금지 |
| P6-T01 | 중간 / 설계만 | 원문을 포함한 전체 최종 prompt의 모델별 토큰 검사와 길이 경고 개선 | 실제 토크나이저·엔진 잘림/분할 규칙 확인 후 검증. 현재 SD 1.5 단어 수 근사치의 한계를 유지 표시 |
| P7-S01 | 후속 / 설계만 | Scene v2 actor별 속성·관계·공통 배경·v1 unassigned 보존 설계 | 스키마 변경 이유·영향·변환/복구 계획 승인 후 구현 |
| P7-I01 | 후속 / 설계만 | 참조 이미지·ControlNet/IP-Adapter/img2img의 자산·권한·엔진 계약 검토 | 업로드/전처리/모델 지원/GPU 메모리 검증. 프롬프트 문자열만으로 지원 완료 처리하지 않음 |
| P8-L01 | 후속 / 설계만 | 명시적 LLM 번역/보강 제안과 적용/거부, Client/gate 연결 설계 | 실패 시 원문·사전/직접 생성 보존, 응답 검증 및 GPU 전환 검증. 세부 자동화 후보는 [LLM 자동화 제안](PROMPT_COMPOSER_LLM_AUTOMATION.md) |
| LLM-A1..A4·A6·A8 | 후속 / 설계만 | 사전 커버리지 갭·충돌쌍·alias·family 표현 감사(오프라인 A1–A4), 속성 귀속 제안(A6), 평가 채점 보조(A8) | [LLM 자동화 제안](PROMPT_COMPOSER_LLM_AUTOMATION.md)의 지표 기준선 수집과 계약 승인. 권장 순서 A2·A3 → A1 → A4 → A8 → A6 |
| P5-C03-AT | 중간 / 미검증 | 실제 스크린리더와 브라우저 200% 확대 UI 검증 | 낭독·포커스·오류 안내·확대 결과 기록. 기존 viewport 축소 시험과 구분 |
| LLM-EVAL01 | 중간 / 미착수 | A5/A7 규칙 제안의 수락률·오매칭률 기준선 수집 | 대표 원문/예상 ID/오탐 사례와 지표 기록. confidence는 확률이 아닌 규칙 점수 |
| TEST-PLATFORM01 | 중간 / 근거 보강·Linux 재확인 대기 | 기존 전체 pytest 실패의 플랫폼 의존성 재확인. 2026-11-16 macOS 로컬에서 48 failed / 273 passed / 6 skipped 재현, 실패 9개 파일은 모두 model-switch/control 계열이며 `os.listxattr`·`SO_PEERCRED`·BSD `chmod`·systemd 의존 | Linux/Fedora 및 로컬 실패 목록 대조. Studio suite 통과로 전체 회귀를 대체하지 않음 |

다음 순서: **U11 사용자 화면 의견 → U12 정합성 회귀·종료 → P5-L01 배포·롤백 준비 → P6-Q02 실제 품질 평가**. 설계 검토는 병행할 수 있지만 운영 성공·GPU 품질로 표시하지 않는다. Actions 최적화는 설계만이며 현재 workflow는 여전히 전체 릴리스를 실행한다.

기존 P6-UX는 1차 기능 구현/로컬 시나리오 완료다. 사용자의 실제 사용 피드백을 반영해 후속 P6-UX-R2를 최우선으로 열었으며, archive의 완료 기록 자체는 변경하지 않는다.

## 활성 항목 보고 (2026-11-16)

기준 소스 `730e077` + 작업 트리 문서 변경. 아래 명령을 실제로 실행했고, 브라우저·운영 서버·GPU·Fedora 환경은 실행하지 않았다.

```sh
node --experimental-strip-types --test frontend/tests/*.test.mjs     # 38 passed
STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh     # 131 passed, 6.87s, 경고 0
.venv/bin/python -m pytest -q                                       # 48 failed, 273 passed, 6 skipped
```

| ID | 코드·설정에서 확인한 현재 상태 | 이번에 확인한 것 / 확인하지 못한 것 |
| --- | --- | --- |
| P6-UX-R2 | ~~`styles.css` `.workspace`는 … 제안 후보는 `신뢰도 n%`(`aria-label`도 “신뢰도”)로 표시된다~~ **→ 2026-11-16 갱신: U01–U10 구현 완료.** `prompt-stage`/`prompt-explore`/`prompt-scene` 구획, `선택 n`, 0건 복구, 접이식 영어 상세, 자동 미리보기, `prompt-inclusion`, `일치` 표기, 오류 시점 가드가 모두 코드에 있다. `presentation.ts` 신규 | 당시 문제 8건은 소스에서 재확인됐으나 **이후 모두 수정됨**. 실제 Chromium 38개 검사 0 실패, U11 비교 계측 완료. 남은 것은 사용자 의견과 U12 |
| DEPLOY-OPT01 | `.github/workflows/deploy.yml`은 `push: branches:[main]`에서 항상 backend 테스트·Studio suite·static deploy 테스트·ruff·frontend lint/build·전체 패키징을 실행하고 `paths`/변경 영역 필터가 없다. 릴리스 아카이브는 `git archive` + `frontend/dist` 복사 + `package-release.py` 고정 해시 | 설계 문서와 workflow가 일치(현재 전체 배포 유지). 마지막 성공 배포 기준·실서버 상태·부분 아티팩트 경로는 이번에 확인하지 않음 |
| P5-L01 | `deploy/deploy-release.sh` 해시 검증 후 scp/설치 단계가 workflow에 있으나 실행 기록은 없다. 구 서버 capability 누락 fallback은 프런트 `compositionSupported` 경로로만 존재 | 운영 배포·롤백, 구/신 이력 읽기, 실제 HTTP·프록시 한도는 미검증. 코드 변경 없음 |
| P5-D01 | `prompt_composition`(v1)에 `free_text_ko`·`draft_prompt`·`unresolved`는 저장하지만 반영 방식(`separate`/`verbatim`), 적용 당시 문자열, fingerprint, renderer/provenance 필드는 스키마에 없다. `builderState.ts`는 이 값을 메모리(`appliedPrompt`, `appliedScene`)로만 비교하고 복원 시 “기록 없음”으로 처리 | 스키마 변경 없음이 확인됨(설계만 유지). 마이그레이션 대안·구 클라이언트 호환 문서화는 미착수 |
| P6-Q01 | `compiler.ts`는 `naturalLanguageFamilies`(`z-image`,`flux2`,`moss-image`)와 `sd15`만 구분하고 구분자로 `;`/`,`를 고른다. `frontend/src` 어디에도 `renderer`/`profile` 모듈은 없다. registry의 모델 profile은 `model_snapshot`으로 job에 동결되지만 renderer 선택에는 쓰이지 않는다 | renderer/profile 미구현 확인. profile→renderer 선택 규칙·구 snapshot 보존 테스트 계획은 미작성 |
| P6-Q02 | 12개 대표 장면 fixture·비교 스크립트·결과 기록이 저장소에 없다(`backend/tests`에 prompt 관련은 `test_prompt_composition.py`뿐). GPU 실행 흔적 없음 | 미착수 유지. 지원 모델·설정·seed 확정과 실제 이미지 비교는 미수행 |
| P6-T01 | 서버에는 토큰 검사가 없다(`backend/app`에 77-token/토크나이저 검증 없음). 프런트 `estimateTokens`는 `draft`만 `\s,;` 분리 후 `×1.3` 올림해 77과 비교하며 원문 포함 최종 prompt는 검사하지 않는다. `sdcpp.py`는 실행 시 `--tokenizer` 경로를 넘기지만 요청 단계 검증은 아니다 | 현재 근사치 한계가 코드와 일치. 실제 토크나이저·엔진 잘림/분할 규칙 확인은 미수행 |
| P7-S01 | `scene.ts`는 v1(`SelectionSnapshot` 배열 + 단일 `freeTextKo`)만 있고 actor/관계/공통 배경 구조가 없다. `changeSceneFamily`는 계열 변경 시 재결속만 한다 | Scene v2·스키마·마이그레이션 미구현 확인. 속성 귀속·v1 unassigned 보존 설계 미착수 |
| P7-I01 | `backend/app`·`frontend/src`에 `controlnet`/`ip_adapter`/`img2img`/`init_image`·참조 이미지 업로드/권한 코드가 없다. `JobRequest`도 텍스트 파라미터만 받는다 | 참조 이미지 계열 전부 미구현 확인. 자산·권한·엔진·GPU 메모리 계약 검토 미착수 |
| P8-L01 | 서버에 proposals/suggest 엔드포인트가 없고(`backend/app` grep 0건) LLM 호출 경로가 없다. `proposals.ts`는 결정론 규칙만 수행하며 타입(`ProposalRequest`/`SelectionHint`)이 LLM 교체 경계 역할을 한다 | LLM 번역/보강 제안·적용/거부·Client/gate 연결 미구현 확인. 계약 승인 전 구현 금지 유지 |
| LLM-A1..A4·A6·A8 | 사전 감사·충돌쌍·alias·family 표현·속성 귀속·채점 보조 산출물이 저장소에 없다. 기준선 지표 문서도 없고 `LLM-EVAL01`이 그 자리를 대신한다 | 설계만 유지. A2·A3부터의 기준선 수집 미착수 |
| P5-C03-AT | `frontend/package.json`에 Playwright/axe 등 접근성 하네스가 없고(과거 검증은 로컬 캐시 Chromium 수동) 자동 접근성 검사가 CI에 없다. 200% 확대는 P5-C03에서 viewport 근사(640×450)로만 확인 | 실제 스크린리더·브라우저 200% 확대 미검증 유지 |
| LLM-EVAL01 | A5/A7 규칙의 대표 원문/예상 ID/오탐 사례·수락률·오매칭률 기록이 없다. `prompt-proposals.test.mjs`는 규칙 동작만 검증하고 지표는 측정하지 않는다 | 기준선 수집 미착수 확인 |
| TEST-PLATFORM01 | 이번 전체 pytest는 **48 failed / 273 passed / 6 skipped(31.86s)**. 실패 9개 파일은 모두 model-switch/control 계열이며 원인은 `AttributeError: module 'os' has no attribute 'listxattr'`(macOS), `socket.SO_PEERCRED` 부재 → `service_unavailable`, BSD `chmod` 사용 실패(`Could not write active model`), systemd worker 응답(`Invalid worker response`)이다. Studio suite 131건은 같은 머신에서 통과 | 실패가 Prompt Composer·Studio 릴리스 범위 밖 플랫폼 의존임을 파일별로 분류. Linux/Fedora에서 실패 0인지 대조는 미수행 |

보고 요약:

- 코드로 확인 가능한 활성 항목 중 실제 구현이 진행된 것은 없고, P6-UX-R2의 문제 8건은 소스에서 그대로 재확인됐다. 문서에 적힌 “분석 완료·재설계 대기”가 현재 코드와 일치한다.

  → **갱신 (2026-11-16, 이후 작업):** 위 문단은 당시(문서 대조 시점) 기록이다. 그 뒤 U01–U10을 구현하고 실제 Chromium으로 실측했으며 U11 계측까지 마쳤다. 위 "활성 항목" 표의 P6-UX-R2 행이 현재 상태의 기준이다.
- `P5-D01`·`P6-T01`·`P8-L01`·`LLM-A1..A4·A6·A8`은 “설계만”이 소스와 일치한다. 저장 계약·토크나이저·LLM·감사 산출물이 추가되지 않았다.
- 미완료로 남은 것은 대부분 실행 환경이 필요한 항목(P5-L01 운영 배포·롤백, P6-Q02 GPU 품질, P5-C03-AT 실제 보조기기)과 사용자 화면 확인이 필요한 U11이다. 이번 턴에서 이들은 완료로 바꾸지 않았다.
- 다음 실행 순서는 **U11 사용자 의견 → U12 → P5-L01 → P6-Q02**이며, TEST-PLATFORM01은 Linux/Fedora에서 같은 48건 목록을 대조해야 닫을 수 있다.

## 완료 항목 안내

P0–P4 구현, Seed S0–S3 및 1.2.0 데이터, P5-A/B, P5-R01/R02, P5-C01/C02의 로컬 시나리오, P5-C03의 측정된 범위, P6-UX, TEST-D01, LLM-A5/A7 결정론 구현은 archive에서 관리한다. P5 전체 릴리스나 S4의 GPU 품질까지 완료됐다는 뜻은 아니다.

브라우저 관찰은 2026-11-15 문서 기록을 보존한 것이며 이번 문서 정리에서 새로 실행하지 않았다. 임시 스크린샷은 저장소에 없으므로 장기 증거가 필요한 배포 검증에서 다시 수집한다. P5-R02는 원래 129건 범위의 로컬 재구성 통과이며 사용자 원래 머신의 실행을 증명하지 않는다.
