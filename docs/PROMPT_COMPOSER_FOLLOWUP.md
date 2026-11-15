# Prompt Composer 남은 작업과 회귀 추적

갱신일: 2026-11-15 · 기준: `e85d8dc` + TEST-D01 의존성 변경. P5-R02·P5-C01/C02/C03·P6-UX·TEST-D01 로컬 완료.
현재 상태를 이 문서에서 추적한다. 설계와 수동 절차는 [P5 상세](PROMPT_COMPOSER_P5.md), 실제 동작은 [현재 구현](PROMPT_COMPOSER_CURRENT.md), P0–P4 이력은 [작업 계획](PROMPT_COMPOSER_TASKS.md)을 따른다.

상태는 `미착수`, `진행`, `환경 대기`, `설계만`, `로컬 검증 완료`로 구분한다. 로컬 테스트 통과를 브라우저·운영·GPU 완료로 바꾸지 않는다. 항목을 완료 처리할 때 실행 명령, 대상 커밋/환경, 결과와 증거를 추가한다.

## 추적 목록

| ID | 우선순위 / 상태 | 남은 작업과 다음 행동 | 완료 기준 |
| --- | --- | --- | --- |
| P5-R01 | 높음 / 로컬 검증 완료 | max_body_bytes 없는 최소 설정에서 capability 전체가 실패하는 회귀 수정. optional 한도는 없으면 생략 | 기존 coordination 조건 3종을 한도 없음/1024/131072에서 검증. 관련 94건 통과, 아래 기록 |
| P5-R02 | 높음 / 로컬 검증 완료 | 사용자가 실패를 관찰한 실행 환경에서 수정 커밋으로 원래 회귀 명령 재실행 | 원래 129건 범위(`scripts/test-studio.sh`)를 수정 전 커밋에서 `1 failed, 128 passed`로 재현 → 현재 `131 passed`. 아래 기록 |
| P5-C01 | 높음 / 로컬 검증 완료 | 브라우저에서 검색·분류·필터 밖 선택·칩 해제·전체 비우기·자동 미리보기·덮어쓰기 취소·원문 반복·직접 수정 검증 | 실제 Chromium에서 5개 시나리오(C01a–e)+원문/직접 수정(B01·B02) 통과, 아래 기록 |
| P5-C02 | 높음 / 로컬 검증 완료 | 로컬 Fake/fixture로 다른·같은 계열 전환, capability 실패/미지원, 한도 미광고, 과거 재사용, retry, 422/413 확인 | 실제 화면·API에서 13개 시나리오 통과, 아래 기록 |
| P5-C03 | 중간 / 로컬 검증 완료 | 키보드·포커스·오류 연결, 360/390px 및 200% 확대 점검 | 자동 측정·스크린샷 통과, 아래 기록. 실제 보조기기/스크린리더 검증은 미수행 |
| DEPLOY-OPT01 | 중간 / 설계만 | [변경 영역별 Actions 최적화](ACTIONS_DEPLOY_OPTIMIZATION.md): 마지막 성공 배포 기준·실서버 상태 확인·부분 아티팩트/설치 경로 검토 | 미배포 변경 누락·실패 복구·호환성 테스트 및 시간 측정. 현재 전체 배포 유지 |
| P5-L01 | 높음 / 미착수 | P5-C·원래 회귀·화면 검증 통과 후 운영 배포·롤백 검증 준비. 구 서버 capability 누락, 새/구 이력 읽기, 실제 HTTP 한도와 프록시 한도 점검 | 대상 릴리스·백업·배포/복구 절차 및 실행 결과 기록. 현재 미배포 |
| P5-D01 | 중간 / 설계만 | 자유 입력 반영 방식·적용 당시 문자열/fingerprint·renderer/provenance 영속화 계약 검토 | 구 데이터 unknown 처리·구 클라이언트 호환·마이그레이션 대안 제시. 저장 계약 변경 전 승인 |
| P6-UX | 중간 / 로컬 검증 완료 | 카테고리 탐색·그룹별 선택·자동 미리보기·항목별 표현 표시. P5-C03과 별도 | P5-C01/C03에서 카테고리 버튼·필터 밖 선택 유지·그룹 헤더·계열별 칩 표현·키보드 조작을 실제 브라우저로 확인 |
| P6-Q01 | 중간 / 설계만 | 기존 compiler 재사용 및 체크포인트별 renderer profile 설계 구체화 | 기본/미지원 처리와 구 snapshot 보존 테스트 계획. 전면 전환은 별도 구현 |
| P6-Q02 | 중간 / 미착수 | 12개 대표 장면 × seed 17/42/123의 기존/후보 비교. 지원 모델과 설정을 먼저 확정 | 체크포인트/엔진/설정/실제 seed·이미지·실패·사용자 평가 기록. GPU 실행 전 품질 우위 주장 금지 |
| P6-T01 | 중간 / 설계만 | 원문을 포함한 전체 최종 prompt의 모델별 토큰 검사와 길이 경고 개선 | 실제 토크나이저·엔진 잘림/분할 규칙 확인 후 검증. 현재 SD 1.5 단어 수 근사치의 한계를 유지 표시 |
| P7-S01 | 후속 / 설계만 | Scene v2 actor별 속성·관계·공통 배경·v1 unassigned 보존 설계 | 스키마 변경 이유·영향·변환/복구 계획 승인 후 구현 |
| P7-I01 | 후속 / 설계만 | 참조 이미지·ControlNet/IP-Adapter/img2img의 자산·권한·엔진 계약 검토 | 업로드/전처리/모델 지원/GPU 메모리 검증. 프롬프트 문자열만으로 지원 완료 처리하지 않음 |
| P8-L01 | 후속 / 설계만 | 명시적 LLM 번역/보강 제안과 적용/거부, Client/gate 연결 설계 | 실패 시 원문·사전/직접 생성 보존, 응답 검증 및 GPU 전환 검증 |
| TEST-D01 | 낮음 / 로컬 검증 완료 | Starlette TestClient의 httpx 사용 중단 예정 경고 검토 | `httpx2>=2,<3` dev 의존성 추가·lock 갱신으로 경고 제거. Studio 131건·전체 ruff 통과, 아래 기록 |

다음 실행 순서: P5-L01(운영 배포·롤백 검증) → P6-Q02(GPU 품질) → P6-Q01/P5-D01 설계 승인. P6–P8 설계는 병행 검토할 수 있으나 운영·GPU 검증을 완료로 표시하지 않는다. 기존 승인 범위 밖의 스키마 변경은 별도로 보고한다.

## P5-R01 원인과 수정 기록

사용자 보고: `test_studio_advertises_coordination_only_for_complete_configuration`에서 `AttributeError: SimpleNamespace ... max_body_bytes`, **1 failed, 128 passed, 1 warning**. 원래 실행 명령과 환경은 보고에 포함되지 않았다.

로컬에서 `backend/tests/test_coordination_capability.py` 실행으로 **1 failed, 6 passed**를 재현했다. P5에서 추가한 `s.settings.max_body_bytes` 직접 접근이 최소 설정 객체에도 새 속성을 강제한 것이 원인이다. 앞선 P5 관련 40건 검증에는 이 coordination 파일이 포함되지 않아 놓쳤다.

수정:

- `backend/app/api/routes.py`: 설정에서 HTTP 한도를 읽을 수 없으면 `request_limits`를 생략한다. 임의의 64 KiB 기본값을 광고하지 않는다. 실제 Settings가 제공하는 한도는 그대로 반환한다. BodyLimit의 서버 강제 검증은 변경하지 않는다.
- `backend/tests/test_coordination_capability.py`: 기존 조율 활성/잠금 경로/owned-hold 조건 검사를 유지하고, 한도 없음·1024·131072 세 경우를 매개변수화한다. 한도 누락이 구성 capability와 coordination을 깨지 않고 설정된 값을 그대로 광고하는지 검사한다.

2026-11-15 로컬 macOS 검증:

```sh
.venv/bin/python -m pytest \
  backend/tests/test_coordination_capability.py \
  backend/tests/test_prompt_composition.py \
  backend/tests/test_api.py \
  backend/tests/test_gate_admin.py \
  backend/tests/test_gpu.py \
  backend/tests/test_gpu_owned_holds.py \
  backend/tests/test_model_switch_recovery_endpoint.py \
  backend/tests/test_studio_independence.py -q

.venv/bin/ruff check backend/app/api/routes.py backend/tests/test_coordination_capability.py
git diff --check
```

결과: **94 passed, 1 warning, 5.75초**, ruff 및 diff 검사 통과. 프런트 코드 변경 없음. 이번에는 브라우저 연결 재시도·운영 배포·GPU 생성·전체 저장소 회귀를 수행하지 않았다. 앞선 프런트 29건/백엔드 40건 결과는 당시 기록이며 이번 94건과 합산하지 않는다. (브라우저·원래 범위 재실행은 같은 날 후속 턴에서 아래와 같이 완료했다.)

## P5-R02 원래 범위 재현·수정 후 재실행 (2026-11-15)

사용자 보고는 원래 실행 명령/환경을 포함하지 않았다. 저장소 기준으로 그 범위는 `.github/workflows/deploy.yml`과 `scripts/test-studio.sh`가 실행하는 Studio suite이며, 수정 전 커밋 `b98ad81`에서 정확히 **129건**을 수집한다.

| 단계 | 명령 | 결과 |
| --- | --- | --- |
| 수정 전 재현 | `git worktree add /tmp/bc250-prefix b98ad81` 후 `PYTHONPATH=/tmp/bc250-prefix/backend .venv/bin/python -m pytest -q <13개 Studio 파일>` | **1 failed, 128 passed, 1 warning** — 사용자 보고와 일치 |
| 실패 상세 | `test_coordination_capability.py::test_studio_advertises_coordination_only_for_complete_configuration` | `AttributeError: 'types.SimpleNamespace' object has no attribute 'max_body_bytes'` (`b98ad81` routes.py:173) |
| 수정 후 | `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh` (현재 커밋) | **131 passed** — 파라미터화로 +2건, 실패 0 |

로컬 macOS·Python 3.13 환경이다. 이 재현은 사용자 머신이 아닌 로컬 재구성이므로, 사용자 실행 환경 자체가 달랐다면 별도 확인이 필요하다. 이번 결과는 원래 129건 범위의 회귀가 사라졌다는 증거이지 전체 저장소 회귀 통과가 아니다.

## P5-C01/C02/C03·P6-UX 브라우저 검증 (2026-11-15)

이전 세션의 `The browser access host is unavailable` 차단은 해소됐다. 로컬에 캐시된 Playwright Chromium(`chromium-1228`, `Google Chrome for Testing`)을 `playwright-core`로 직접 실행했다. 운영 GPU 대신 문서의 Fake 환경을 사용했다.

환경 구성:

- 백엔드: `STUDIO_ENGINE=fake`, `STUDIO_POLICY=image_priority`, 임시 `data_dir`, 테스트 전용 키, `127.0.0.1:18090`.
- 프런트: `vite --port 5174`(5173은 다른 프로젝트가 점유) + `VITE_STUDIO_TARGET=http://127.0.0.1:18090`.
- fixture registry: `fake`(family `fake`), `fake-sd15`/`fake-sd15-alt`, `fake-flux2`, `fake-unknown`(family `unknown-family`). 모두 `engine: fake`라 파일 없이 실행 가능.
- DevTools 수준 요청 재정의는 `page.route()`로 해당 로컬 페이지만 대상. 테스트 후 프로세스 종료로 해제.

| ID | 시나리오 | 관찰 결과 |
| --- | --- | --- |
| P5-C01a | 검색·분류 후 필터 밖 선택 유지 | 조명 분류+`네온` 검색 시 인물 칩 유지, 힌트 "다른 분류의 선택도 유지됩니다" |
| P5-C01b | 칩 × 해제 | 인물 칩만 제거, 네온 조명 유지 |
| P5-C01c | 전체 비우기 취소/확인 | 취소 시 2개 유지, 확인 시 0개. 추가 설명·최종 입력 그대로 |
| P5-C01d | 선택 변경 후 미리보기 | 초안 `a person` → `a person, full body` 자동 갱신, stale 경고 0건, 적용 버튼 활성 |
| P5-C01e | 덮어쓰기 취소/확인 | 취소 시 손으로 쓴 prompt 보존, 확인 시 초안으로 교체. 확인 대화상자 1회 |
| P5-B01 | 원문 반영 3회 생성/적용 | 초안 3회 동일, 최종 입력에 원문 1회만 포함 |
| P5-B02 | 적용 후 직접 수정 | "적용 후 최종 프롬프트를 직접 수정했습니다" 표시, 생성 버튼 활성 |
| P5-C02a | 같은 계열(sd15) 모델 전환 | 확인 없음, applied·선택 유지, "마지막 적용 문자열과…" 표시 |
| P5-C02b | 다른 계열(flux2) 전환 | 확인 1회, 칩이 flux2 표현으로 재결속, applied 초기화, 최종 입력 유지 |
| P5-C02c | 미지원 계열 | 칩 `미변환` 표시 3개, 초안 비움, 미지원 경고 |
| P5-C02d | capability 요청 실패 | "구성 이력 저장을 지원하지 않거나…" 표시, 직접 생성 가능 |
| P5-C02e | `prompt_composition` 미지원 응답 | 동일 안내, 생성 가능 |
| P5-C02f | `request_limits` 없음 | "서버 요청 크기 한도를 확인할 수 없어…" 표시, 생성 가능 |
| P5-C02g | prompt 8001/8000자 | 8001자 차단·`aria-invalid=true`, 8000자 허용 |
| P5-C02h | 추가 설명 4001/4000자 | 4001자 오류 표시, 4000자 정상 |
| P5-C02i | 선택 100개 + 자유 입력 4000자 | `composition: 40585/32768바이트` 오류, 제출 차단 |
| P5-C02j | 강제 422/413 | 기존 `.errorbox`에 서버 메시지 표시, 최종 입력·선택 보존 |
| P5-C02k | 실제 접수 | job에 최종 prompt(직접 수정본)와 마지막 applied 구성(`compiler_version 1.3.0`, 선택 2개) 저장 |
| P5-C02l | 취소 → UI 재시도 | 새 `job_id`, `retry_of` 연결, 구성·원문 포함 원 spec 유지 |
| P5-C02m | 과거 구성 재사용 | 최종 입력·칩 복원, `미변환` 유지, 경고 미생성, "과거 방식은 기록 없음" 라벨·재생성 버튼 표시 |
| P5-C03-keyboard | 키보드 조작 | Enter로 패널 열기, Space로 체크박스 선택, 칩 버튼 `outline 2px solid` |
| P5-C03-aria | 오류 연결 | `aria-describedby=prompt-errors`, `aria-invalid=true`, `role=status` 영역 존재 |
| P5-C03-360px | 360×780 | `scrollWidth 360 = clientWidth`, 넘치는 요소 0, 카테고리 줄바꿈, 생성 버튼 노출 |
| P5-C03-390px | 390×844 | 동일 통과 |
| P5-C03-zoom200 | 640×450(200% 상당) | 가로 넘침 0 |

스크린샷(로컬 임시 경로, 저장소에 커밋하지 않음): `c01-category-search`, `c01-applied`, `c01-edited`, `c02-unsupported-family`, `c02-capability-failure`, `c02-limit-free-text`, `c02-composition-size`, `c02-forced-413`, `c02-submitted`, `c02-retry`, `c02-reuse-past`, `c03-360px`, `c03-390px`, `c03-keyboard`, `c03-zoom200`.

관찰된 동작 변화와 한계:

- P6-UX 자동 미리보기 도입으로 "선택 변경 → 재생성 전 적용 불가" 상태는 **UI에서 도달하지 않는다.** 선택을 바꾸면 초안이 즉시 갱신되고 적용 버튼은 계속 활성이다. `isDraftStale` 가드는 남아 있으나 이 경로에서는 발동하지 않는다. [P5 상세](PROMPT_COMPOSER_P5.md)의 stale 행은 자동 미리보기 기준으로 읽어야 한다.
- 콘솔 오류로 보이는 404 1건은 저장소에 `favicon.ico`가 없어서 발생하는 **기존** 현상이며 이번 변경과 무관하다.
- `errorbox`의 422/413 메시지는 서버 `detail` 원문을 그대로 표시한다(사용자용 문구 아님).
- 200% 확대는 뷰포트 축소로 근사했다. 실제 브라우저 확대 UI와 스크린리더 낭독은 검증하지 않았다.
- Fake 엔진이라 GPU 품질·실모델 프롬프트 반영은 검증 대상이 아니다.

## TEST-D01 httpx2 전환 (2026-11-15)

원인: Starlette 1.9.0 `testclient`가 `httpx2`를 우선 import하고, 없으면 `httpx`로 폴백하며 `StarletteDeprecationWarning`을 낸다. 고정 버전은 fastapi 0.162.0 / starlette 1.9.0 / httpx 0.28.1이다.

수정:

- `pyproject.toml`: dev 의존성에 `httpx2>=2,<3` 추가. 런타임 `httpx` 의존성은 그대로 둔다(게이트·LLM 어댑터가 계속 사용).
- `uv.lock`: `uv lock`으로 `httpx2 2.16.0`, `httpcore2 2.16.0`, `httpx2-jsfetch 1.0.0`, `truststore 0.10.5` 추가. 기존 패키지 버전 변경 없음(순수 추가).

검증:

```sh
uv sync --locked --extra dev
STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh
.venv/bin/ruff check backend
```

결과: Studio **131 passed**, 출력에 Starlette 경고 없음. ruff 전체 통과. `backend/tests`의 24개 파일·49개 위치가 `TestClient`를 계속 사용하므로 경고 숨김이 아니라 실제 실행 경로가 `httpx2`로 바뀌었다. 별도 격리 venv(`/tmp/httpx2-venv`)에서도 동일 버전 조합으로 131건 통과를 재확인했다.

## P6-UX 구현 및 검증 (2026-11-15)

기존 문제: 단일 긴 체크박스 목록, 혼합 선택 칩, 수동 초안 생성으로 탐색과 결과 예측이 어려웠다. 변경 계획은 표시용 카테고리 버튼·그룹별 칩·선택 스냅샷의 계열별 표현·편집 시 결정론적 미리보기다. `PromptBuilder.tsx`와 `styles.css`에 국한하며 Scene/API/컴파일러 출력 및 App 구조는 변경하지 않는다. 선택/원문/반영 방식 변경만 미리보기를 갱신하고 최종 prompt 및 마지막 applied는 사용자가 적용하기 전 유지한다. 과거 복원은 저장 초안과 미기록 출처 상태를 유지하며 편집 또는 명시적 재생성 시 현재 컴파일러를 사용한다. 검색은 선택한 카테고리 내에서 수행하며 필터 밖 선택을 유지한다. 선택 칩의 영어는 선택 당시 mapping이며 최종 출력에 중복 제거·미지원 처리될 수 있음을 안내한다.

로컬 결과: 프런트 기존 단위 테스트 29건, 백엔드 구성·coordination 14건 통과, frontend build/lint 통과. **추가로 2026-11-15에 실제 Chromium에서 카테고리 버튼 전환, 필터 밖 선택 유지, 그룹별 칩 표현(계열·미변환), 자동 미리보기 갱신, 칩 제거, 비우기 취소/확인, 덮어쓰기 취소/확인, 키보드 조작을 확인했다**(위 P5-C01/C03 표). 스크린리더 낭독과 대량 항목 가상화는 검증하지 않았다. 대량 항목 가상화/페이지 나누기는 실제 데이터 규모와 접근성 검증 후 검토한다. P5-C03 및 기존 회귀 항목은 별개로 유지한다.
