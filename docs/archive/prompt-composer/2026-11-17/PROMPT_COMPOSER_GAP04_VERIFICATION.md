> 역사 보관본: 2026-11-17 통합 직전 기록. 당시 완료 주장은 현재 판정이 아니며, 현재 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다.

# GAP04 브라우저 회귀 검증 기록 (2026-11-17)

기준 소스: 작업 트리(GAP01–GAP03 구현 포함). 실행 환경: macOS, Chromium **149.0.7827.55**(Playwright 번들, headless=new), CDP 하네스. 백엔드는 `STUDIO_ENGINE=fake` + 임시 `STUDIO_DATA_DIR` + 4개 fake 모델 fixture. 운영 서버·GPU·실데이터는 사용하지 않았다.

## 1. 재현 절차

```sh
# 백엔드(fake fixture + 임시 data_dir) + Vite + Chromium을 한 번에 실행하고 정리한다.
BACKEND_PORT=4208 WEB_PORT=4209 sh scripts/prompt-composer-browser/verify.sh
```

- 기본 포트: 백엔드 4201, 프런트 4206. `BACKEND_PORT`/`WEB_PORT`로 바꾼다.
- 새 `mktemp -d` 데이터 디렉터리, `scripts/prompt-composer-browser/models.fixture.yaml`(fake-sd15/fake-sd15-alt/fake-flux2/fake-unknown), 고정 테스트 키, 일회용 브라우저 프로필만 사용한다. 종료 시 데이터 디렉터리·프로필을 지운다.
- `make_fixture_registry.py`로 fixture를 재생성할 수 있다. `/tmp` 경로 의존은 없다.
- 결과: `docs/evidence/prompt-composer-gap04/results.json`, 스크린샷 15장. 실패가 있으면 종료 코드가 1이다.
- **이번 실행 결과: 검사 58건, 실패 0건.** (참고 기록 17건은 `pass: null`로 판정에서 제외)

## 2. 시나리오별 입력·예상·실제

| # | 시나리오 | 입력 | 예상 | 실제 | 증거 |
| --- | --- | --- | --- | --- | --- |
| 1 | 초기 진입(GAP03) | fake-sd15 선택, 사전 구성 열기 | 분류는 `전체`, 빈 장면에 `대상부터 고르기` 노출 | 통과 | `01-open.png`, `02-subject-entry.png` |
| 2 | 대상 우선 진입 | `대상부터 고르기` 클릭 | `대상`으로 좁힘 + 검색 입력 포커스 | 통과(activeElement=INPUT) | `02-subject-entry.png` |
| 3 | 칩 그룹 순서 | 대상/조명/분위기 각 1개 선택 | 그룹 순서 `대상 → 조명 → 분위기` 고정 | 통과 | `03-focus-after-removal.png` |
| 4 | 중간 칩 제거(GAP01) | 2번째 칩 제거 버튼에 포커스 후 **Enter** | 다음 칩 제거 버튼으로 포커스 | 통과(제거 `부드러운 조명` → 포커스 `차분한 분위기`) | `03-focus-after-removal.png` |
| 5 | 그룹/전체 마지막 제거 | 마지막 칩 포커스 후 Enter | 이전 칩으로 포커스 | 통과(`인물 선택 해제`로 복귀) | `03-focus-after-removal.png` |
| 6 | 전체 마지막 칩 제거 | 남은 칩 1개에서 Enter | 남은 칩이 없으면 탐색 입력으로 포커스 | 통과 | `03-focus-after-removal.png` |
| 7 | 선택 비우기 취소/확인 | `선택 비우기` → 확인창 취소 후 확인 | 취소 시 2개 유지, 확인 시 0개 + 탐색 입력 포커스 | 통과(확인창 1회) | — |
| 8 | 별도 보관 안내(GAP02) | 원문 입력, separate 유지 | `prompt-inclusion`이 `별도 보관`을 미리보기 기준으로 안내, 같은 내용을 주의로 중복 표시하지 않음 | 통과(주의 목록 0건) | `04-separate.png` |
| 9 | 원문 포함 안내 | 반영 방식을 `verbatim`으로 변경 | `원문 포함` 안내 + 미리보기에 원문 1회 | 통과 | `05-verbatim.png` |
| 10 | 미변환 선택 주의(GAP02) | fake-unknown + 초안 만들기 | 미변환 선택은 **주의(caution)**, 오류 0건, 접힌 상세 밖 | 통과(오류 0, caution 2건) | `06-unknown-family.png` |
| 11 | 차단 오류(GAP02) | 최종 프롬프트 8001자 | `prompt-error`로 표시, 접힌 상세 밖, 생성 차단 | 통과(`8001/8000자`, `details` 밖) | `07-blocking-error.png` |
| 12 | 키보드 순회(U09) | 사전 구성 버튼에서 Tab 6회 / Shift+Tab 3회 | 검색 입력·분류 버튼 도달, 역순 복귀 | 통과 | `08-keyboard.png` |
| 13 | 키보드 조작 | 분류 버튼 Space, 칩 상세 Enter 2회 | 분류 전환, 상세 열기/닫기, 선택 불변 | 통과 | `08-keyboard.png` |
| 14 | 터치 크기 | 칩 제거 버튼 측정 | ≥26px | 통과(26×26) | — |
| 15 | 390px | 390×844 | 1열 적층, 가로 넘침 없음, 적용 버튼 노출 | 통과(314×36) | `09-390.png` |
| 16 | 360px | 360×740 | 1열 적층, 가로 넘침 없음, 적용 버튼 노출 | 통과(284×36) | `09-360.png` |
| 17 | 적용/덮어쓰기 취소 | 적용 → 최종 직접 수정 → 적용 취소 | 최종 문자열 일치 유지, 확인창 1회, 상태 `적용 후 수정됨` | 통과 | `10-applied.png` |
| 18 | 직접 생성 | 최종 프롬프트 입력 후 생성 | 작업 표시, 완료 상태 | 통과(`completed`) | `11-job.png` |
| 19 | 과거 복원 | 결과 정보 → `이 설정으로 다시 생성` | 반영 방식은 `기록 없음`으로 표시(추정 금지) | 통과(`data-unknown=true`) | `12-restored.png` |
| 20 | HTTP 422 | POST `/jobs`를 422로 대체 | 오류 표시 + 입력 보존 + 재시도 가능 | 통과 | — |
| 21 | HTTP 413 | POST `/jobs`를 413로 대체 | 오류 표시 + 입력 보존 + 재시도 가능 | 통과 | — |
| 22 | 계열 전환 | fake-sd15 → fake-flux2 | 최종 프롬프트 유지, 이전 초안 미적용, 재생성 경로 제공 | 통과(초안 비움 + `초안 만들기`) | `13-family-switch.png` |
| 23 | capability 미지원 | `/system/capabilities`를 빈 응답으로 대체 후 새로고침 | 구성 이력 미지원 안내, 화면 유지, 직접 입력 가능 | 통과 | `14-capability-off.png` |

## 3. 이번 검증에서 고친 결함

| 결함 | 원인 | 수정 |
| --- | --- | --- |
| 최종 프롬프트 오류가 주의 색으로 표시 | `App.tsx`의 `#prompt-errors`/`#negative-errors`/구성 오류가 `prompt-warning` 사용 | `prompt-error`로 통일(GAP02 3등급 규칙 적용) |
| 원문 4000자 초과가 두 번 표시 | `freeIssues`와 `validateComposition`이 같은 한도를 각각 보고 | 구성 지원 시 `#draft-errors`만 사용, 미지원 시에만 원문 영역에서 표시 |

하네스 자체 결함도 2건 고쳤다. ① CDP에서 `keyDown`+`char`를 함께 보내면 Enter가 두 번 활성화되어 모든 칩이 삭제됐다. ② `data-tone` 없는 메시지를 전부 정보로 분류해 판정이 어긋났다. 둘 다 스위트 판정 문제이며 제품 결함이 아니다.

## 4. 재사용 범위와 미검증

- **재사용**: `/tmp/pc-cdp`의 driver 구조(U11, 38건)와 시나리오 발상은 가져왔지만, 이번 스위트는 **저장소 안에서 재작성**했고 실제 키보드 이벤트(Tab/Shift+Tab/Space/Enter)를 쓴다. U10의 `.focus()` 후 `activeElement` 비교만으로는 키보드 도달성을 입증할 수 없다는 지적을 이번에 실제 순회로 대체했다.
- **미검증으로 남김**: 실제 보조기기(스크린리더·확대)·실기기 터치·운영 서버·GPU 품질. `AT01/AT02`·`P5-L01`·`P6-Q02` 범위이며 이 문서는 그 항목을 닫지 않는다.
- 스크린샷에는 fake 모델 이름과 테스트 프롬프트만 있으며 키·개인 결과는 없다.
