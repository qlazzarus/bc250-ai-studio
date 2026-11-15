# 사전 프롬프트 현재 구현과 개선 기준

현재 남은 작업과 회귀 수정 상태는 [후속 작업 추적](PROMPT_COMPOSER_FOLLOWUP.md)에서 관리한다. capability 설정 누락 회귀(P5-R01)와 원래 129건 범위 재실행(P5-R02)은 통과했고, P5-C01/C02/C03 브라우저 검증·P6-UX 화면 검증·TEST-D01(httpx2)도 로컬에서 완료했다. 운영 배포·롤백과 GPU 품질 검증은 별도 미완료다.

검토일: 2026-11-15 · 기준: `12ee5ea` 및 P5 로컬 변경. [P5 상세 설계·검증 절차](PROMPT_COMPOSER_P5.md). 이번 검토는 구현과 문서의 대조이며 운영 서버 재점검이나 GPU 품질 평가가 아니다. 작업 순서는 **현재 구현 확인 → 문서 동기화 → 기능 개선**이다. 이 문서는 현재 동작의 기준이고, [작업 계획](PROMPT_COMPOSER_TASKS.md)의 P0–P4 설명과 배포 기록은 단계별 이력이다.

P6-UX에서는 카테고리 버튼·그룹별 선택/표현과 편집 시 자동 미리보기를 도입했다. 저장된 과거 초안은 복원 시 유지하며 편집 또는 재생성 시 현재 규칙을 적용한다. 브라우저 검증 상태는 [후속 추적](PROMPT_COMPOSER_FOLLOWUP.md)을 따른다.

## 구성과 데이터 흐름

| 계층 | 구현 파일 | 현재 책임 |
| --- | --- | --- |
| 정적 사전 | `frontend/src/prompt/dictionary.ts` | 버전 1.2.0, 활성 항목 100개, 안정 ID·분류·한국어 이름·별칭·계열별 표현. 한국어 이름/별칭/ID 부분 문자열 검색 |
| 선택 스냅샷 | `frontend/src/prompt/scene.ts` | Scene v1에 대상 계열, 선택 당시 이름·분류·사전 버전·매핑, 자유 입력 보관. 계열 변경 시 현재 사전으로 명시적 재결속 |
| 컴파일러 | `frontend/src/prompt/compiler.ts` | 버전 1.3.0. 스냅샷을 분류·ID 순으로 정렬해 초안·출처·미변환 항목·경고 반환. 네트워크/LLM 호출 없음 |
| 화면 상태 | `frontend/src/prompt/builderState.ts` | 편집 중 scene, 생성 결과 result, 생성 당시 scene 문자열 generatedFrom, 마지막 적용 이력 applied 분리 |
| 구성 UI | `frontend/src/components/PromptBuilder.tsx` | 검색·10개 표시 분류·다중 선택·선택 칩·선택 비우기·추가 설명·초안 생성/적용 |
| 제출과 재사용 | `frontend/src/App.tsx` | capability 확인, 최종 prompt 제출, 적용 이력 첨부, 모델 변경 확인, 결과 재사용 |
| 서버 계약 | `backend/app/models/schemas.py`, `backend/app/services/registry.py` | 구성 v1 구조·크기·매핑 상태·중복 ID·모델 계열 일치 검증. 실제 실행 기준은 최상위 prompt |
| 결과 표시 | `frontend/src/components/MetadataModal.tsx` | 선택 이름·원문·초안·미변환/누락·컴파일러 버전 표시 |

사용 순서는 모델 선택 → 사전 선택/추가 설명 → 초안 만들기 → 초안을 최종 프롬프트에 적용 → 최종 입력 직접 수정 → 생성이다. 생성된 초안 칸은 읽기 전용이며 편집은 적용 후 최종 프롬프트 칸에서 한다. P5는 추가 설명의 원문 반영/별도 보관을 명시적으로 선택하게 한다. 사전을 사용하지 않고 직접 입력할 수도 있다.

## 사전과 모델별 출력

기존 12개와 추가 88개로 구성한다. 화면 분류는 대상·외형·의상·표정·포즈·배경·카메라·조명·스타일·분위기다. 저장된 기존 `action`, `location`, `composition`은 그대로 유지하고 화면/정렬에서 각각 `pose`, `setting`, `camera`로 묶는다.

| 계열 | 매핑 | 초안 형식 |
| --- | --- | --- |
| `sd15` | 100/100 | 쉼표로 구절 연결: `a person, standing, soft lighting` |
| `z-image`, `flux2`, `moss-image` | 각각 100/100 | 세미콜론으로 구절 연결: `a person; standing; soft lighting` |
| `fake`, 알 수 없는 계열 | 0/100 | 초안에 넣지 않고 미변환으로 반환 |

자연어 계열 세 가지는 같은 사전 문구를 재사용한다. 체크포인트별 문장 생성이나 품질 최적화는 구현되지 않았다. `mapped`는 표현 문자열이 있다는 뜻이며 모델 실행 가능 여부나 이미지 품질 보장이 아니다.

자유 입력은 언어를 판별하지 않는다. 기본 별도 보관 방식에서는 `unresolved`에 남고 사전 초안에는 들어가지 않는다. 원문 반영을 선택하면 사전 초안 뒤에 개행과 원문을 그대로 붙이며, 사전 초안이 없으면 원문만 사용한다. `unresolved`는 미번역 상태를 유지하므로 최종 입력 누락을 뜻하지 않는다. 별도 보관에서 자유 입력만 있으면 유효한 최종 프롬프트를 직접 작성한 뒤 설명만 이력에 적용할 수 있다. 반영 방식은 화면 상태이고 저장 계약에는 별도 필드가 없다. 자동 번역·LLM 다듬기·사용자 사전 편집·가중치·대상별 속성 연결은 없다.

중복 ID는 한 번 처리하고, 다른 ID의 같은 표현은 앞뒤 공백 제거 및 영문 소문자 비교로 한 번 출력한다. 출처에는 서로 다른 ID가 남는다. 충돌은 12개 고정 쌍과 머리색 그룹으로 검사하며 경고만 한다. 다인 장면의 어느 인물에게 속한 속성인지 구분하지 않는다.

## 편집·적용·복원 의미

- 선택/추가 설명을 바꾸면 기존 초안은 오래된 상태가 되어 다시 생성하기 전 적용할 수 없다. 최종 프롬프트와 마지막 적용 이력은 유지한다.
- 초안 재생성 자체는 최종 입력을 바꾸지 않는다. 다른 내용의 최종 입력에 초안을 적용할 때 덮어쓰기 확인을 한다.
- 같은 계열에서는 마지막 `applied`를 전송한다. 적용 후 선택을 바꾸고 재적용하지 않으면 현재 선택이 아니라 **마지막 적용 당시 구성**이 저장된다. 최종 텍스트를 직접 수정해도 구성 이력은 유지되므로 둘의 의미 일치를 보장하지 않는다. 현재 선택과 마지막 적용 선택의 차이, 적용 후 문자열 수정 여부를 UI에 표시한다. 적용 문자열은 해시 대신 메모리에서 직접 비교한다.
- 계열 변경 시 선택이 있으면 확인한다. 현재 사전의 새 계열 표현으로 재결속하고 result/generatedFrom/applied는 비운다. 최종 프롬프트는 유지한다. 같은 계열의 모델 변경은 재결속하지 않는다.
- 결과 재사용은 저장된 선택 표현과 초안·최종 문자열을 복원한다. P5의 `restoreComposition()`은 저장된 미변환 목록도 그대로 복원하고 당시 경고·출처는 기록 없음으로 표시한다. 현재 규칙으로 다시 만들기를 눌러야 재계산하며, 재생성만으로 원래 applied를 교체하지 않는다. 당시 반영 방식/적용 문자열은 별도 기록이 없으므로 추정하지 않는다.
- 구성 상태는 App 메모리에만 있다. Pixel Studio 화면 전환 중 유지되며 새로고침/이탈 전 경고를 요청하지만 영속 초안 저장은 없다.

## 저장과 제한

`GET /system/capabilities`가 구성 스키마 1 지원을 알릴 때, 같은 모델 계열의 applied가 있으면 `POST /jobs`에 `prompt_composition`을 보낸다. capability 요청 실패 또는 미지원이면 이를 제외하고 기존 prompt를 제출하며 화면에 구성 이력 미저장 안내를 표시한다.

서버는 구성을 재컴파일하거나 현재 사전과 대조하지 않는다. 구조 검증된 설명용 스냅샷을 `jobs.spec`에 저장하고 SSE·asset metadata·JSON sidecar로 전달한다. retry는 원 spec을 깊은 복사하며, 구성 필드가 없는 과거 데이터는 null로 읽는다. 경고와 sources 배열, 반영 방식 자체는 API에 저장되지 않는다. 메타데이터에서 초안/최종 문자열 차이와 미기록 항목을 표시한다. 사전 버전은 선택 항목마다 저장한다.

| 서버 제한 | 값 | 현재 프런트 처리 |
| --- | --- | --- |
| 선택 수 | 100개 | 구성 저장 지원 시 적용·제출 차단, 자동 삭제 없음 |
| 초안 / 최종 prompt | 각각 8,000자 | 코드포인트로 각각 검사, 적용·제출 차단 |
| 자유 입력 / 미변환 항목 text | 각각 4,000자 | 필드 오류 표시, 구성 저장 지원 시 적용·제출 차단 |
| 미변환 항목 | 101개 | 클라이언트 구성 검사 및 서버 검증 |
| 선택 표현 rendered | 300자 | 클라이언트 구성 검사 및 서버 검증 |
| 구성 객체 JSON | UTF-8 32 KiB | 클라이언트·서버 모두 기본값 포함 직렬화 크기 검사 |
| HTTP 요청 전체 | 설정 `max_body_bytes`, 소스 기본값 65,536바이트 | capability의 request_limits.max_body_bytes로 전체 wire JSON 검사; 서버 BodyLimit도 유지. 구 서버에서 한도 미확인 시 서버 검사 |

서버는 추가 필드, 지원하지 않는 스키마, 중복 선택 ID, NUL, mapped인데 빈 표현, unavailable인데 표현이 있는 경우도 거절한다. 모델 계열 불일치도 거절한다. SD 1.5 토큰 경고는 구분자로 나눈 단어 수 × 1.3을 올림해 77과 비교하는 근사치다. 정확한 토크나이저나 엔진의 잘림/분할 동작을 검증하는 기능은 아니다. 토큰 경고는 적용을 막지 않는다. 문자/구성 크기 오류와 구별한다. 원문까지 포함한 정확한 토큰 검사는 후속이다.

## 문서 대조 결과

| 기존 표현/누락 | 정리 |
| --- | --- |
| 상위 설계에서 사전 전체를 미구현 제안으로 설명 | 기본 사전·컴파일러·UI·저장은 구현, LLM·포즈 등은 제안으로 구분 |
| 작업 계획 머리말의 P0–P4 완료와 P3 화면 검증 대기 혼재 | 코드 구현과 수동 UI/품질 검증 완료를 분리 |
| S0/S1 단계 설명의 사전 미구현·코드 미반영 | 당시 단계 이력임을 표시하고 S2/1.2.0 반영 상태 연결 |
| 초안 편집, 자유 입력 처리, 과거 복원 세부 의미 부족 | 읽기 전용 초안과 P5 원문 반영/별도 보관, 저장 사실만 복원하는 동작 명시 |
| 배포 기록의 HTTP 32 KiB와 구성 객체 32 KiB 혼동 가능 | 과거 서버 관찰과 소스 기본 HTTP 64 KiB를 구분 |

## P5 진행과 다음 순서

P5-A 제출 전 검증·적용 상태, P5-B 자유 입력·과거 사실 복원은 로컬 구현했다. P5-C 브라우저 검증은 2026-11-15 로컬 Chromium에서 검색·분류·칩·비우기·덮어쓰기·자유 입력 반복·직접 수정·계열 전환·capability 실패·한도·retry·과거 재사용·키보드·360/390px·200% 근사를 확인해 완료했다. 상세 문제·파일·계약·호환성·완료 조건·잔여 위험·수동 절차는 [P5 문서](PROMPT_COMPOSER_P5.md)에, 실행 결과는 [후속 추적](PROMPT_COMPOSER_FOLLOWUP.md)에 기록한다. 남은 것은 운영 배포·롤백(P5-L01)과 GPU 품질 검증이다.

그다음은 P6 모델별 renderer/복수 시드 평가, P7 Scene v2·캐릭터 귀속, P8 선택적 LLM이다. 이번에는 설계만 수행했으며 새 저장 스키마·Scene v2·GPU 최적화는 구현하지 않았다.

## 이번 검증

2026-11-15 P5 변경 후 검증:

- `node --experimental-strip-types --test frontend/tests/*.test.mjs`: 29건 통과. 실제 Python/Pydantic과 JSON UTF-8 크기 대조 포함. 이 교차 검증은 `.venv/bin/python` 또는 `PYTHON`으로 지정한 backend 의존성이 설치된 Python을 사용한다.
- `.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_api.py -q`: 40건 통과. Starlette/httpx 사용 중단 예정 경고 1건 → TEST-D01로 해소.
- `cd frontend && npm run build && npm run lint`: 통과.
- `.venv/bin/ruff check backend/app/api/routes.py backend/tests/test_prompt_composition.py`: 통과.
- `git diff --check`: 통과.

2026-11-15 후속 완료 검증(이번 턴):

- `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh`: **131 passed**, 경고 0건. 같은 suite를 `b98ad81`에서 재현하면 `1 failed, 128 passed`.
- `.venv/bin/python -m pytest -q` (P5 관련 8개 파일): 94건 통과.
- `.venv/bin/ruff check backend`: 통과. `git diff --check`: 통과.
- `node --experimental-strip-types --test frontend/tests/*.test.mjs`: 29건 통과. `npm run lint && npm run build`: 통과.
- 실제 Chromium(Playwright, 로컬 캐시)으로 P5-C01/C02/C03 + P6-UX 시나리오 25항목 통과. 상세 표는 [후속 추적](PROMPT_COMPOSER_FOLLOWUP.md).
- `uv sync --locked --extra dev`로 httpx2 도입 후에도 Studio suite·ruff 통과.

이전 세션 기준 기록: 브라우저 도구는 `The browser access host is unavailable`로 연결하지 못했다. 2026-11-15 후속 턴에서 로컬 캐시 Chromium으로 실제 클릭·키보드·좁은 화면 검증을 수행했고, 운영 배포/롤백, GPU 생성·품질, 전체 저장소 회귀는 여전히 미검증이다. 전체 저장소 pytest는 macOS에서 GNU chmod/소켓 의존 테스트가 실패하는 기존 문제가 있어 48 failed / 273 passed / 6 skipped이며, [TERRA_STUDIO_CLOSEOUT_PLAN](TERRA_STUDIO_CLOSEOUT_PLAN.md)에 기록된 플랫폼 한계와 같다. 최초 구현 대조 단계에서는 프런트 20건/백엔드 38건을 확인했으며, P5 추가 검증과 구분한다. 과거 테스트 수와 배포 관찰은 [작업 계획의 기록](PROMPT_COMPOSER_TASKS.md)에 남긴다.
