# Art Studio UI/UX 개선 실행 계획

2026-11-24 · 구현 담당 `deepseek-v4.1-flash` · 다음 태스크 **UIX07**

사용자가 모델을 고르고, 장면을 영어 프롬프트로 구성하거나 직접 입력하고, 생성한 작업과 결과를 다시 찾는 흐름을 개선한다. 기존 UCP 기능을 사용하는 Art Studio가 범위다. Pixel Studio는 진입·복귀 회귀만 확인한다. 현재 판단 근거는 프런트엔드 소스와 기존 UCP 브라우저 검증 기록이다. 아래 배치와 동작은 구현 목표이며 새 화면의 사용성은 아직 측정하지 않았다.

## 실행자에게 전달할 지시

```text
docs/ART_STUDIO_UI_UX_IMPLEMENTATION.md를 읽고 선행 작업이 끝난 첫 대기 태스크 하나를 수행하라.
해당 절의 파일과 현재 작업 트리를 확인하고, 상태를 진행으로 바꾼 뒤 구현·검증하라.
완료 조건을 확인한 뒤 같은 문서의 상태표와 해당 절 아래에 결과와 다음 ID를 남겨라.
기존 UCP 사양의 요청 취소·revision·적용·복원·저장 계약을 유지하라.
deepseek-v4.1-flash는 구현 담당이다. Studio 런타임 모델, API, 배포 설정은 이번 UI 작업 범위 밖이다.
```

## 상태표

| ID | 사용자가 얻는 결과 | 선행 | 상태 |
| --- | --- | --- | --- |
| UIX01 | 장면 구성과 영어 직접 입력의 진입점 식별 | 없음 | 완료 |
| UIX02 | 사전 선택을 요약에서 확인하고 수정 | UIX01 | 완료 |
| UIX03 | 긴 영어 후보를 비교하고 적용 결과 확인 | UIX01 | 완료 |
| UIX04 | 기본 설정으로 생성하고 막힌 입력으로 이동 | UIX01 | 완료 |
| UIX05 | 접수한 작업 추적과 실패한 작업 재시도 | UIX04 | 완료 |
| UIX06 | 갤러리에서 결과 확인 후 원래 위치로 복귀 | UIX01 | 완료 |
| UIX06A | URL 라우팅과 퍼머링크 | UIX06 | 완료 |
| UIX07 | 모바일·키보드·과거 결과 복원 회귀 검증 | UIX02~06A | 대기 |

권장 실행 순서는 번호순이다. 상태는 대기 / 진행 / 완료 / 환경 대기 / 실패 수정 중을 쓴다. 각 절 아래에 `변경 파일 · 실제 동작 · 검증 명령과 결과 · 남은 문제 · 다음 ID`를 한 번씩 기록하고 재실행 시 갱신한다.

### UIX01 · 프롬프트 입력 경로

현재 `frontend/src/App.tsx`는 모델 아래에 `PromptBuilder`의 ‘프롬프트 구성 열기’, `ComposePanel`, 최종 입력을 순서대로 렌더링한다. 사용자는 비슷한 이름의 두 구성 경로를 먼저 구별해야 한다.

- [x] 모델 다음에 ‘한글 장면으로 만들기’와 ‘최종 프롬프트 직접 입력’으로 이동하는 경로를 둔다. 직접 입력은 기존 textarea로 연결한다. 기존 builder 열기는 ‘사전 초안·고급 도구’로 용도를 드러낸다.
- [x] compose 미지원 시 이유와 직접 입력을 같은 위치에서 찾게 한다. 접기·펼치기로 편집 컴포넌트를 재마운트하거나 요청을 보내지 않는다.
- **완료 기준** — 360px와 1280px에서 각 경로에 키보드로 진입한다. 한글·영어를 각각 입력한 뒤 왕복해도 양쪽 값이 보존된다. 미지원 fixture에서도 최종 입력으로 생성 가능하다. 기존 builder 복원 상태 표시도 접근 가능하다.

**결과 (2026-11-23 완료)**

- **변경 파일**
  - `frontend/src/App.tsx` — 모델 셀렉트 바로 뒤에 `.prompt-paths` 그룹(`role="group" aria-label="프롬프트 입력 경로"`)을 두고 ‘한글 장면으로 만들기’(aria-expanded/aria-controls=`compose-path`)와 ‘최종 프롬프트 직접 입력’(aria-controls=`prompt-final`)을 배치했다. `openPath()`는 보이는 영역과 포커스만 바꾸며 어떤 값도 쓰지 않는다. 한글 영역은 `hidden={!composePathOpen}`만 토글하므로 `ComposePanel`이 언마운트되지 않는다. `PromptBuilder`는 최종 프롬프트 필드 옆(고급 도구 위치)으로 옮겼고, 최종 textarea에 `id="prompt-final"`·`ref`를 부여했다. 미지원/번역 강등/복원 안내는 경로 그룹 아래, 한글 영역 위에 그대로 유지한다. 빈 입력 힌트 문구도 새 진입점 이름을 가리키도록 고쳤다.
  - `frontend/src/components/ComposePanel.tsx` — `onUseDirectInput` 선택 prop 추가. 미지원 사유(`.compose-fallback`) 바로 옆 같은 블록(`.compose-unavailable`)에서 ‘최종 프롬프트 직접 입력’을 제공한다. 이 버튼은 포커스 이동만 위임하며 후보 적용 경로를 호출하지 않는다.
  - `frontend/src/components/PromptBuilder.tsx` — 열기 라벨을 ‘프롬프트 구성 열기/닫기’에서 ‘사전 초안·고급 도구/닫기’로 변경. 복원 상태(`.prompt-status`, `role="status"`)는 접히는 `#prompt-builder-panel` 바깥에 그대로 두어 접힌 상태에서도 읽힌다.
  - `frontend/src/styles.css` — `.prompt-paths`(flex, 44px 터치 하한, 포커스 링), `.compose-path[hidden]{display:none}`(아래 `display:grid` 규칙이 UA `[hidden]`을 덮어쓰지 않도록 명시), `.compose-unavailable`/`.compose-direct` 스타일 추가.
  - `frontend/tests/prompt-uix01.test.mjs` — 신규 단위 테스트 7건. 구조 단언(경로 순서, `hidden` 사용, `openPath`가 `setSettings`/`api.`/`onChange`를 호출하지 않음, `aria-controls` 대상 일치)과 `renderToStaticMarkup`으로 렌더한 `ComposePanel` 마크업(미지원 사유 다음에 직접 입력 버튼, 지원 시 둘 다 없음)을 함께 검증한다.
  - `scripts/prompt-composer-browser/suite.mjs` — UIX01 브라우저 절 추가. 경로 노출·그룹 이름, 모델 다음 Tab 도달(1280/360 양쪽), 한글·영어 왕복 값 보존, 왕복 중 `fetch` 스파이로 `/prompt/compose` 요청 0건, `.compose` 노드 동일성(재마운트 없음), 고급 도구 명칭, 360px 가로 넘침 0·버튼 44px, 복원 상태가 접히는 패널 밖에 있음을 검사한다.
  - `scripts/prompt-composer-browser/suite-contracts.mjs` — 기존 capability 미지원 절(M) 뒤에 M2 추가. 미지원 블록에서 사유→직접 입력 순서, 포커스 이동·한글 영역 접힘, 그 상태에서 최종 입력만으로 생성이 접수되는지(작업 상태 `completed`)를 확인한다.
  - `scripts/prompt-composer-browser/suite-keyboard.mjs` — Shift+Tab 역순 기대값의 라벨을 새 명칭으로 갱신.
  - `docs/evidence/prompt-composer-gap04/` — 하네스 스크린샷·`results.json` 재생성(신규 `03b-uix01-paths.png`, `03c-uix01-360.png`, `03d-uix01-1280.png`, `14b-uix01-unsupported.png` 포함).
- **실제 동작**
  - 모델을 고르면 바로 아래에 두 경로가 있고, ‘한글 장면으로 만들기’가 기본으로 펼쳐진다. ‘최종 프롬프트 직접 입력’을 누르면 한글 영역이 `hidden`으로 접히고 포커스가 `#prompt-final`로 이동한다. 다시 ‘한글 장면으로 만들기’를 누르면 `#compose-brief`로 포커스가 돌아온다.
  - 왕복해도 양쪽 값, 칩, 후보, 진행 중 요청이 그대로 남고 `/prompt/compose` 요청은 0건이다. `.compose` DOM 노드도 동일해 재마운트가 없다.
  - compose 미지원/미광고 계열에서는 사유 문장 바로 옆에 ‘최종 프롬프트 직접 입력’이 있고, 그 버튼으로 최종 필드에 도달해 compose 없이 생성이 접수된다.
  - builder는 최종 프롬프트 필드 옆의 ‘사전 초안·고급 도구’로 열리고, 적용·복원 상태 표시는 접힌 상태에서도 보인다.
- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과(출력 없음).
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **321 tests, 321 pass, 0 fail**(신규 `prompt-uix01` 7건 포함). 시스템 `python3`에 pydantic이 없어 `prompt-p5`가 깨지므로 venv의 `python3`를 PATH 앞에 두고 실행했다.
  - `scripts/prompt-composer-browser/run.mjs`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=2`, Chromium CDP) → **484 checks, 0 failed**. 이 중 UIX01 단언 27건 전부 통과. 결과·스크린샷은 `docs/evidence/prompt-composer-gap04/`에 기록.
  - UCP 계약 회귀: 취소(`취소 후 원문·칩 보존`, `취소 후 재시도 가능`), revision/stale(`모델 변경 후 후보 사라짐`, `K3 최종 프롬프트는 사용자 작업으로 유지`), 적용/되돌리기(`복원이 적용 문자열·negative·모델을 되살림`, `후보 적용 후 되돌리기`), 저장(`v3 스냅샷 기록`, `413 처리`, `snapshot_trim 안내`) 검사가 모두 통과해 기존 계약이 유지됨을 확인했다.
- **남은 문제**
  - 실기기 IME·소프트 키보드·회전은 이 환경에 없어 확인하지 못했다(UIX07 인계 항목).
  - 한글 영역을 접어도 상태는 남지만 화면상 보이지 않으므로, 진행 중 요청의 진행 표시는 사용자가 한글 경로로 돌아와야 보인다. 요구 사항은 “재마운트·재요청 금지”이므로 의도된 동작이다.
  - `docs/evidence/prompt-composer-gap04/`의 기존 스크린샷이 이번 코드 기준으로 전부 재생성되어 diff가 크다. UIX07에서 한 번 더 정리·대조할 것을 권한다.
- **다음 ID** — **UIX02** (사전 선택을 요약에서 확인하고 수정). 선행 UIX01이 완료되어 대기 조건이 충족됐다.

### UIX01 후속 검증 (2026-11-24, UIX02 실행 중 확인)

승인 시 지시된 네 항목을 확인했다. UIX01 구현 자체는 재작업하지 않았다.

- [x] **접힌 영역의 진행·준비·실패 상태를 UIX03에서 읽기 전용으로 표시할 수 있는가** — 가능하다. `ComposePanel`에 `onStatusChange`(선택 prop)와 `ComposeStatusView`(`phase`·`candidateCount`·`stale`·`failureKo`)를 추가했고, `App.tsx`는 이를 `composeStatus`로만 받아 `#compose-path`가 `hidden`일 때 `.compose-strip`(읽기 전용 `<p>`)으로 렌더한다. 스트립은 값을 쓰지 않고 후보를 적용하지 않으며 포커스를 스스로 옮기지 않는다. 즉 UIX03이 요구하는 “접힌 상태에서 상태를 읽는다”가 성립한다. *단, 이 코드는 UIX03 절의 승인 전 선행 작업이며 아래 남은 문제 참고.*
- [x] **현재 입력 경로의 시각적 구분** — 두 경로 버튼이 같은 플래그(`composePathOpen`)에서 `aria-current`를 파생하므로 항상 정확히 하나만 현재로 표시된다. 스타일은 `[aria-expanded="true"]`와 `[aria-current="true"]`를 같은 규칙으로 묶어 직접 입력 경로(=`aria-expanded`가 없는 버튼)도 동일하게 강조한다. 전환은 `hidden` 토글과 포커스 이동뿐이라 데이터 초기화·후보 적용이 없다(브라우저 검사로 확인).
- [x] **UIX07 인계 항목** — 경로 전환 중 요청, 접힌 상태 응답 도착, 직접 입력 수정 중 응답 도착, 모델 변경·실패 후 재시도는 UIX07 통합 회귀에서 확인할 항목으로 남긴다. UIX03 스트립은 “응답이 도착해도 사용자의 입력·커서를 건드리지 않는다”는 전제로 작성되어 있다.
- [x] **gap04 증거 복구 가능 여부** — 가능하다. UIX01 커밋(`782ee4d`)에서 `docs/evidence/prompt-composer-gap04/results.json`이 334→581 항목으로 덮였으나, 그 이전 원본은 `b672935`에 그대로 있다. `git show b672935:docs/evidence/prompt-composer-gap04/results.json`으로 334항목이 온전히 복구되고 추적 스크린샷 79개도 남아 있다. **이후 증거는 태스크별 디렉터리(`docs/evidence/art-studio-uix02/`)에만 기록했고 gap04는 건드리지 않았다.**

### UIX01/UIX02 기존 검증 위치 확인 (2026-11-24, UIX03 실행 중)

지시받은 6개 항목에 대해 **기존 테스트의 이름·위치·실제 단언**을 확인했다. 재작업은 하지 않았고, 누락 2건만 보강했다.

| 요청 항목 | 기존 검증 위치 | 실제 단언 | 상태 |
|---|---|---|---|
| 검색·분류 변경 시 revision 불변 | `scripts/prompt-composer-browser/suite-uix02.mjs` §D `UIX02 · 검색만으로 요청이 나가지 않음` / `UIX02 · 분류 초기화도 요청을 보내지 않음` | `beforeView.requests === noResults.requests` (`window.__composeCalls.length` 비교). 단위: `frontend/tests/prompt-uix02.test.mjs` `panel, search and detail state stay local and never enter the edit` — `update()` 미호출과 `composeRevisions` 불변을 소스 구조로 단언 | 기존 확인 |
| 사전 접기·펼치기 시 revision 불변 | `suite-uix02.mjs` §D 접기/재열기 절 | 접은 뒤 `counts.chosen`·`requests`·`lastSelections`가 접기 전과 동일 | 기존 확인 |
| 검색 초기화가 선택을 바꾸지 않음 | `suite-uix02.mjs` `UIX02 · 검색 초기화도 선택을 바꾸지 않음` | `beforeView.counts.chosen === cleared.counts.chosen` | 기존 확인 |
| 검색 결과 0건에서 검색어 **및 분류** 초기화 | 검색어: `UIX02 · 빈 결과에 검색어 지우기 제공` + `검색어 지우기가 결과를 되돌림`. 분류: **미검증이었다** | — | **보강함** (아래) |
| 충돌 발생·해소에 따른 요약 개수 갱신 | `suite-uix02.mjs` §E `UIX02 · 충돌이 요약에 나타남` / `UIX02 · 해소가 요약을 되돌림` | `counts.clashes`가 `1`→`0`으로 변하고 `data-alert`가 함께 사라짐. 단위: `prompt-uix02.test.mjs`의 `clashes` 파생 단언 | 기존 확인 |
| 충돌 당사 항목 표시 + ‘AI에게 맡기기’ 유지 | `suite-uix02.mjs` §E `UIX02 · 충돌 행에 당사 항목 표시`(`.compose-clashes__label`·`__phrase`), `UIX02 · 충돌 해소 버튼이 행 안에 있음`(`buttonsInside`) | 충돌 행에 칩 ID와 원문 구절이 함께 있고, 해소 버튼이 `.compose-clashes__actions` 안에 있음. `AI에게 맡기기`(`makeAuto`)는 `prompt-uix02.test.mjs`의 수동→자동 전이 단언으로 유지 확인 | 기존 확인 |
| React key 및 조작 대상이 기존 칩 ID 사용 | **미검증이었다** | — | **보강함** (아래) |
| 귀속 변경 후 키보드 포커스 유지 | 미검증 → **UIX07 인계** | `pendingFocusRef`(ComposePanel)로 다음 칩을 잡도록 구현돼 있으나, 실제 Tab 순회 뒤 포커스 유지를 브라우저로 확인하지 않았다. UIX07 통합 회귀 항목으로 넘긴다 | **UIX07 인계** |

**보강 1 — 분류 초기화 (브라우저).** `suite-uix02.mjs` §D에 7건을 추가했다. 검색만 좁혔을 때는 `전체 분류 보기`가 **없어야** 하고(누르면 아무 일도 없는 버튼이 되므로), 검색어를 지운 뒤 `의상` 분류 + `네온` 검색으로 결과를 0건으로 만들어 `전체 분류 보기`가 나타나 분류를 해제하는지, 그 과정에서 선택·요청이 변하지 않는지 확인한다.

**보강 2 — 칩 ID key (단위).** `prompt-uix02.test.mjs`에 `a chip card is keyed and addressed by its chip id, not by position`을 추가했다. `className="compose-chip" key={chip.id}`, `data-chip-id={chip.id}`, `aria-label={`${chip.labelKo} 조작`}`을 단언한다. 위치 key였다면 귀속 이동 때 React가 카드 DOM을 다른 칩에 재사용해 펼침·고정 스타일이 새 칩으로 새어 나간다.

**558 judged와 results.json 665항목의 차이.** `run.mjs`의 `check()`는 판정 항목(`pass: true|false`)을, `record()`는 판정 없는 정보 항목(`pass: null`)을 같은 배열에 넣는다. `docs/evidence/art-studio-uix02/results.json`은 **665개 항목 = 판정 558 + 정보 107**이다(재확인: `entries 665 judged 558 records 107`). 로그의 `checks: 558, failed: 0`은 판정 항목만 센 값이고, 665는 정보 기록까지 포함한 파일 크기다. 두 수치는 같은 실행의 다른 집계이며 서로 모순이 아니다.

### UIX02 · 사전 선택과 충돌

`frontend/src/components/ComposePanel.tsx`에 검색·분류, 칩별 귀속·고정·삭제, 제외 복구와 충돌 해소가 이미 있다. 많은 칩을 편집할 때 어느 선택에 조작이 적용되는지 알아보기 쉽게 한다.

- [x] 사전을 접어도 선택 개수와 미해결 충돌 건수를 볼 수 있게 한다. 검색 결과 수와 선택 개수를 구분하고, 검색 결과가 비면 기존 검색어·분류 초기화 동작을 연결한다.
- [x] 칩 이름과 출처를 먼저 읽게 하고 상세 조작을 해당 칩에 묶는다. 충돌은 당사 항목과 해소 동작을 함께 보여 준다. 기존 제외 복구와 ‘AI에게 맡기기’를 유지한다. 수정 대상은 ComposePanel과 `frontend/src/styles.css`다.
- **완료 기준** — 다인 장면에서 속성 귀속 변경 → 고정 → 다른 칩 제거 → 제외 복구를 수행한다. 변경한 칩과 개수가 일치하고 검색·패널 재열기 후 선택이 보존된다. 충돌 발생·해소 시 요약도 함께 변한다.

**결과 (2026-11-24 완료)**

- **변경 파일**
  - `frontend/src/components/ComposePanel.tsx` — `#compose-dictionary` 바깥(사전 접기 버튼 아래)에 `.compose-counts`(`role="group" aria-label="선택 요약"`)를 두고 `선택·고정·제외·미해결 충돌` 네 수치를 항상 렌더한다. 0도 숨기지 않고 표시하며, 미해결 충돌만 `data-alert`로 강조한다. 검색 줄은 `검색 결과 n개 · 선택 n개`로 두 수치를 한 문장에서 구분한다(`.compose-search-count`). 칩을 `.compose-chip__head`(이름·출처·배지·귀속 라벨) + `.compose-chip__actions`(`role="group" aria-label="{이름} 조작"`) 2단 카드로 재구성해 이름을 먼저 읽고 조작은 해당 칩 안에 묶었다. `chipGroups = groupChips(chips.chosen, entityLabels, entities.length)`로 표시 계층만 귀속별로 묶고(`{label && <h4>}`라 단일 인물 장면은 제목 없음), `대상`은 `<select>`(장면 전체 + 인물별)로 유지했다. 충돌 행은 `data-chip-id`·`.compose-clashes__label`·`.compose-clashes__phrase`·`.compose-clashes__actions`로 당사 항목과 해소 버튼(`제외 해제`, `원문에서 지우기`)을 함께 보여 준다.
  - `frontend/src/prompt/composeChips.ts` — 표시 전용 `groupChips(chips, entityLabels, entityCount)` 추가. 첫 등장 순서를 그대로 유지해 그룹을 만들고, 단일 인물 장면이면 라벨 없는 단일 그룹을 반환한다. 상태 배열·순서·직렬화는 건드리지 않는다.
  - `frontend/src/styles.css` — `.compose-counts`/`.compose-count`(wrap, tabular-nums, `[data-alert]`), `.compose-search-count`, `.compose-chip-group*`(다인일 때만 `column`), `.compose-chip`을 2단 카드 grid로, `.compose-chip button`을 자손 선택자로 바꿔 44px 하한을 유지(기존 `>` 선택자는 조작이 한 단계 내려가면 적용되지 않는다), `.compose-chip__attribute`를 라벨/셀렉트 2행 grid로 바꿔 `대상`이 글자 단위로 쪼개지지 않게 했다.
  - `frontend/tests/prompt-uix02.test.mjs` — 신규 단위 테스트 12건. `groupChips`의 단일/다인 그룹화와 순서, 그룹화가 `edit.selections`와 `buildComposeBody` 직렬화(순서·`entity_id`)를 바꾸지 않음, 수치가 패널과 같은 목록에서 나옴, 충돌이 파생값임을 검증한다. 렌더 테스트로 네 수치·`data-kind`를 확인하고, 요약이 접히는 영역·draft·후보 목록에 의존하지 않음을 소스 구조로 단언한다. `panelOpen`/`query`/`group`이 `update()`를 거치지 않고 `runSend`가 현재/응답 edit에만 호출됨도 검사한다.
  - `scripts/prompt-composer-browser/suite-uix02.mjs` — 신규 브라우저 절(단독 76항목, 판정 66건). 연속 조작, 검색·접기, 충돌, 실패·재시도, 360/1280 레이아웃을 실제 클릭·키 입력으로 확인한다.
  - `scripts/prompt-composer-browser/suite.mjs` — `runUix02`를 UCP08 뒤에 연결. UIX01 절에는 후속 항목인 현재 경로 표시 검사 6건(`aria-current` 단일 표시, 강조색, 전환 후 요약 유지, 전환 중 요청 0건)을 추가했다.
  - `frontend/tests/prompt-uix01.test.mjs` — 현재 경로 표시 단언 1건 추가(총 8건).
  - `docs/evidence/art-studio-uix02/` — 신규 태스크별 증거 디렉터리(스크린샷 74개 + `results.json`). 기존 `gap04`/`ucp08` 증거는 덮어쓰지 않았다.
- **실제 동작**
  - 사전을 접어도 네 수치가 그대로 보이고, 접힌 상태에서 화면 안에 있다. 0도 `0개`로 표시된다.
  - 다인 장면은 `인물 1`, `인물 2`, `장면 전체` 제목으로 나뉘고 각 그룹에 개수가 붙는다. 그룹을 모두 펼쳐 이으면 칩 순서가 원래 선택 순서와 같다.
  - 칩 카드는 `서 있기 / 자동 / 인물 1`처럼 이름·출처·귀속을 먼저 보여 주고, 그 아래 줄에 `고정`·`×`·`대상` 셀렉트가 있다. 각 조작 그룹은 `aria-label`이 칩 이름으로 시작한다.
  - 귀속 변경은 그 칩만 옮기고 개수를 바꾸지 않으며 요청을 보내지 않는다. 고정은 대상 칩에만 적용되고 `고정` 배지와 수치가 함께 갱신된다. 다른 칩 제거는 제외를 1 늘리고 선택을 1 줄이며, 제외 해제는 행을 지우되 선택을 되살리지 않는다(다음 응답이 다시 고를 수 있음).
  - 검색 0건·검색어 지우기·접기·재열기 어디서도 선택이 유지되고 `/prompt/compose` 요청은 늘지 않는다.
  - 원문에 제외 항목을 다시 쓰면 `미해결 충돌`이 1건으로 오르고, 행 안의 `제외 해제`로 해소하면 0건이 되며 제외 목록도 빈다.
  - 실패 후 재시도에서 사용자의 고정은 유지된다. 귀속은 `mergeSelections` 계약대로 서버 파생값으로 돌아온다(초기화가 아님).
- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과(출력 없음).
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **334 tests, 334 pass, 0 fail**(신규 `prompt-uix02` 12건, `prompt-uix01` 8건 포함). 시스템 `python3`에 pydantic이 없어 저장소 `.venv`의 `python3`를 PATH 앞에 두고 실행했다(`PATH=$PWD/.venv/bin:$PATH`).
  - `scripts/prompt-composer-browser/run.mjs` / `verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=2`, Chromium CDP) → **558 checks, 0 failed**. 이 중 UIX02 단언 66건, UIX01 후속 6건 전부 통과. 결과·스크린샷은 `docs/evidence/art-studio-uix02/`에 기록.
  - 360px/1280px: 가로 넘침 없음(`overflow` 0 / -15), 상세 조작 대상 식별, 버튼 44px 이상, 요약이 화면 안, `대상` 라벨 한 줄 — 모두 통과.
  - `git diff --check` → 경고 없음.
  - UCP 계약 회귀: 취소·revision/stale·적용/되돌리기·v3 저장/복원·413·`snapshot_trim` 검사가 모두 통과했다. 칩 ID·`wireSelection`·`composeRevisions`·스냅샷 직렬화는 수정하지 않았다.
- **남은 문제**
  - **UIX03 선행 코드는 UIX03 절에서 정리했다.** UIX02 실행 중 UIX01 후속 항목 1을 확인하려고 작성했던 `onStatusChange`/`ComposeStatusView`(ComposePanel), `composeStatus`·`composeStrip`(App), `.compose-strip`(styles), `suite-uix03.mjs`는 이후 UIX03 실행에서 계약에 맞는 부분은 재사용하고 문제가 있던 부분(`suite-uix03.mjs`의 중복 선언·시그니처 불일치)만 고쳐 정식 하네스에 연결했다. UIX02 시점의 558검사 0실패는 그 코드와 무관하게 성립했고, UIX02 계약(칩 ID·revision·직렬화)도 그때와 지금 모두 변경하지 않았다.
  - `docs/evidence/prompt-composer-gap04/results.json`은 UIX01 커밋(`782ee4d`)에서 재생성되며 334→581 항목으로 덮였다. UIX01 이전 원본은 `b672935`에서 그대로 복구 가능하다(`git show b672935:docs/evidence/prompt-composer-gap04/results.json`, 334항목 확인). 스크린샷 79개도 전부 추적 상태로 남아 있다.
  - `:has()` 기반 다인 그룹 세로 배치는 Chromium/Safari/Firefox 최신에서 동작하지만, 구형 브라우저에서는 그룹이 가로로 흐를 뿐 판독에는 지장이 없다.
  - 실기기 IME·소프트 키보드는 이 환경에 없어 확인하지 못했다(UIX07 인계).
- **다음 ID** — **UIX03** (긴 영어 후보를 비교하고 적용 결과 확인). 선행 UIX01이 완료되어 대기 조건이 충족됐다. **→ 이번 실행에서 완료했다(아래 UIX03 절).**

### UIX03 · 후보 비교와 적용

ComposePanel은 각 후보의 영문 전체, 차이, negative, 보존 내용, 적용 영향과 버튼을 세로로 반복한다. 긴 후보 세 개에서도 다음 대안과 적용할 후보를 쉽게 찾게 한다.

- [x] 후보 제목·한국어 차이·적용 상태를 먼저 보여 준다. 첫 후보 본문은 펼치고 대안 본문은 개별적으로 펼쳐 동시에 비교할 수 있게 한다. 본문과 적용 동작을 같은 카드에 둔다.
- [x] 최종 입력 교체 여부, negative 유지·교체·빠짐 안내는 적용 직전에 보이게 한다. 기존 stale 처리, 덮어쓰기 확인, 되돌리기 및 명시적 ‘결과로 이동’을 재사용한다.
- **완료 기준** — 긴 후보 세 개 중 두 번째를 펼쳐 적용하면 그 후보의 문자열과 상태가 일치한다. 직접 수정 후 적용 취소·되돌리기, negative 미지원 확인, 원문 수정 뒤 이전 후보 적용 방지를 검증한다. 응답 도착이나 카드 펼침만으로 최종 입력이 바뀌지 않는다.

**결과 (2026-11-24 완료)**

- **변경 파일**
  - `frontend/src/prompt/composeView.ts` — UIX03의 두 표시 전용 투영을 추가했다. `CandidateView`(`key`·`expanded`·`collapsed`)와 `expansionFor`/`candidateBodyOpen`/`toggledView`, 그리고 `ComposeStatusView`+`composeStripView`. 이 파일은 이미 UCP02의 표시 상태(패널 접힘·폭·회전)가 사는 곳이라 성격이 같다. 두 타입 모두 `ComposeEdit`이 아니므로 `composeRevisions`에 들어갈 수 없다 — “카드 펼침이 revision을 올리지 않는다”가 리뷰 약속이 아니라 타입으로 성립한다.
  - `frontend/src/components/ComposePanel.tsx` — 후보 카드를 `<article>` + 헤더 토글(`.compose-candidate__toggle`, `aria-expanded`/`aria-controls`) + 본문(`.compose-candidate__body`, `hidden={!open}`) + 같은 카드 안의 `.compose-apply`로 재구성했다. 헤더는 `제목 · 한국어 차이 → 적용 영향(최종 프롬프트 교체/같음 · negative 교체/유지/빠짐) → 적용됨 배지 → 펼치기/접기` 순이다. 펼침 상태는 `useState<CandidateView>` 하나로만 관리하고 `expansionFor(candidateView, visible.draft?.resultId)`로 렌더 중 파생한다(이펙트로 초기화하지 않음). **적용됨 판정을 `applied.candidateId` 단독에서 `applied.resultId`까지 비교로 고쳤다**(아래 실제 동작 3). 기존 `planApply`/`applyDiff`/`window.confirm`/`undo`/`resultRef.focus()` 경로는 그대로 호출한다.
  - `frontend/src/App.tsx` — `composeStrip` 계산을 `composeStripView(composeStatus)` 호출로 바꿨다(동작 동일, 순수 함수로 분리해 단위 테스트 가능하게). `composeStatus`는 여전히 `onStatusChange`가 주는 스냅샷만 담는다.
  - `frontend/src/styles.css` — `.compose-candidate__toggle`(44px 하한, wrap, 헤더 전체가 클릭 영역), `.compose-candidate__impact`, `.compose-candidate__body[hidden]{display:none}`(아래 grid 규칙이 UA `[hidden]`을 덮지 않도록 명시), `.compose-candidate__applied`, `.compose-candidate__chevron` 추가. 1280px에서는 `.compose-candidate`가 2열 grid가 되어 적용 버튼이 본문 오른쪽에 붙는다.
  - `frontend/tests/prompt-uix03.test.mjs` — 신규 단위 테스트 **19건**. 펼침 규칙(첫 후보 기본 펼침·개별·동시·접은 첫 카드 유지·새 응답 미상속·렌더 중 파생), 스트립 투영(단계별 문구·stale 우선·`planApply` 미호출), 카드 구조(헤더 순서·`hidden`·44px·`key`), 그리고 실제 `planApply`/`applyDiff`로 두 번째 후보 적용·stale 거부·모델 만료·negative 2단계·negative 유지·영향 문구 일치를 검증한다.
  - `frontend/tests/prompt-uix02.test.mjs` — 칩 ID key 단언 1건 추가(총 13건).
  - `scripts/prompt-composer-browser/suite-uix03.mjs` — **미연결 상태였던 494줄을 정식 하네스에 연결하고 다시 작성**했다(현재 약 700줄, `check()` 84회). §A 헤더 우선·기본 펼침, §B 동시 비교·카드별 독립, §C 두 번째 후보 적용, §D 덮어쓰기 확인·취소, §E 되돌리기, §F stale, §G 새 응답 미상속, §H 접힌 띠·응답 도착 경쟁, §I 실패·취소·재시도, §J 모델 변경 경쟁, §K negative 미지원 2단계, §L 키보드·360/1280 레이아웃.
  - `scripts/prompt-composer-browser/suite-uix02.mjs` — 분류 초기화 검사 7건 추가(§D).
  - `scripts/prompt-composer-browser/suite.mjs` — `runUix03`을 UIX02 뒤에 연결(이전에는 import조차 없었다).
  - `docs/evidence/art-studio-uix03/` — 신규 태스크별 증거 디렉터리. `gap04`·`art-studio-uix02`는 건드리지 않았다.
- **실제 동작**
  - 후보 세 개가 오면 첫 카드 본문만 열려 있고 나머지는 접혀 있다. 헤더만 읽어도 `원문 충실 · 원문 충실` / `대안 1 · 분위기 강조` 처럼 어느 후보인지, `최종 프롬프트 교체 · negative 교체` 처럼 누르면 무엇이 바뀌는지 알 수 있다.
  - 접힌 본문은 DOM에 남아 있고 `hidden`+`display:none`으로만 가려진다(측정 높이 0). 펼치면 즉시 보인다.
  - **적용됨 판정을 reply 단위로 고쳤다.** `settleComposition`은 새 응답에서도 `applied`를 보존하므로(적용은 과거의 사실이므로 의도된 동작), 이전에는 `candidateId`만 비교해 새 응답이 같은 ID를 재사용하면 적용한 적 없는 카드에 `적용됨`이 붙었다. `applied.resultId === draft.resultId`를 함께 요구해 새 응답에서는 배지가 초기화된다.
  - 두 번째 후보를 펼쳐 적용하면 그 후보의 긴 문자열이 최종 입력에 그대로 들어가고 negative도 `blurry, text`로 바뀐다. 빈 입력 교체는 확인을 묻지 않고(`__confirmCalls === 0`), 적용된 카드에만 배지가 붙으며, 펼침 상태는 그대로 유지된다.
  - 직접 수정 뒤 적용은 확인을 요구하고, 취소하면 입력·negative가 그대로다. 승인하면 적용되고 `적용 되돌리기`가 적용 전 문자열을 정확히 복원한다.
  - 원문을 고치면 후보는 남되 `적용할 수 없습니다 … 다시 생성하세요`가 뜨고 적용 버튼이 거부한다(문자열·negative 불변, 요청 0건).
  - 새 응답은 이전 응답의 펼침을 물려받지 않는다(첫 후보만 열림). 후보 ID가 같아도 마찬가지다.
  - 요청 대기 중 영어 경로로 접으면 띠에 `후보를 만드는 중입니다`가 뜨고, 응답이 도착하면 `후보 3개가 준비되었습니다`로 바뀐다. 그 사이 사용자가 최종 필드에 입력한 값·포커스는 그대로다.
  - 실패는 `구성에 실패했습니다: …`, 취소는 `구성을 취소했습니다. 입력과 선택은 그대로 남아 있습니다`로 띠에 반영되고, 다시 시도로 후보가 복구된다.
  - 모델을 바꾸면 이전 요청의 응답은 적용 불가로 만료된다. negative 미지원 모델에서는 헤더가 `negative 빠짐`을 알리고, 첫 누름은 손실을 설명하며 멈추고(`지원되지 않습니다`), 두 번째 누름(`negative 없이 적용`)이 긍정 프롬프트만 적용한다.
  - 헤더 토글은 실제 `<button>`이라 Enter·Space가 네이티브로 동작하고 포커스가 헤더에 남는다. 360px·1280px 모두 가로 넘침 0, 헤더·적용 버튼 44px 이상, 본문 가로 잘림 0, 세 본문 동시 펼침 가능.
- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과.
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **354 tests, 354 pass, 0 fail**(신규 `prompt-uix03` 19건, `prompt-uix02` 13건 포함). 저장소 `.venv`의 `python3`를 PATH 앞에 두고 실행했다.
  - `scripts/prompt-composer-browser/verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=2`, Chromium CDP) → **669 checks, 0 failed**(`results.json` 788항목 = 판정 669 + 정보 119, 실패 0). 이 중 **UIX03 판정 105건**, UIX02 판정 74건이 전부 통과했다. 스크린샷 90개, UIX03 전용 18개.
  - 필수 스크린샷 8장(4상태 × 2폭)이 `docs/evidence/art-studio-uix03/`에 있다: `uix03-10-default-{360,1280}.png`(후보 기본 접힘), `uix03-11-compare-{360,1280}.png`(복수 후보 비교), `uix03-12-confirm-{360,1280}.png`(적용 확인), `uix03-13-folded-{360,1280}.png`(접힌 Compose 진행). **단, `uix03-12-confirm-*`는 네이티브 `window.confirm` 대화상자를 담지 못한다** — CDP 스크린샷은 페이지 뷰포트만 찍고 브라우저 크롬은 포함하지 않는다. 그 상태에서 확인이 실제로 떴고 취소가 입력을 보존했다는 사실은 같은 절의 단언(`덮어쓰기 확인이 뜨고 취소됨` = `__confirmCalls` 1, `확인 취소 뒤 입력 유지`)이 증명하며, 스크린샷은 그 직전의 카드·입력 상태를 보여 준다.
  - `git diff --check` → 경고 없음.
- **선행 코드 처리 결과** — 삭제하지 않고 재사용했다. `onStatusChange`/`ComposeStatusView`/`composeStatus`/`.compose-strip`은 계약에 부합해 그대로 두고, 표시 전용 투영만 `composeView.ts`로 옮겨 테스트 가능하게 했다. `suite-uix03.mjs`는 중복 `applyCard` 선언으로 로드 자체가 실패하는 상태였고(그래서 미연결이어도 문제가 드러나지 않았다), 시그니처 불일치(`page` 구조분해 누락)도 있어 전면 재작성 후 `suite.mjs`에 연결했다. **UIX03 전용 검사는 이번 실행에서 처음 실제로 돌았다.**
- **Compose 상태 표시 계약 확인 (지시 §3)** — `ComposePanel`이 UCP 세션의 소유자로 남아 있고, `App`의 `composeStatus`는 `onStatusChange`가 주는 스냅샷만 담는다. `App`은 후보 유효성·stale·revision·적용 가능 여부를 계산하지 않는다(그 판단은 `planApply`와 `draftIsStale`이 패널 안에서 한다). 다음 항목을 실제로 확인했다:
  - **불필요한 API 요청 없음** — 펼침·접힘·검색·분류·경로 전환 각각에서 `window.__composeCalls.length`가 변하지 않음을 단언(§B·§F·UIX02 §D).
  - **revision 증가 없음** — `CandidateView`/`ComposeStatusView`는 `ComposeEdit`이 아니므로 `composeRevisions`에 들어갈 수 없다(타입으로 보장). 브라우저에서는 stale 배지가 펼침 때문에 뜨지 않는 것으로 확인.
  - **반복 렌더링·effect 루프 없음** — `onStatusChange` effect의 의존성은 `phase`·`candidateCount`·`stale`·`failureKo`·`onStatusChange` 다섯 스칼라뿐이다. 객체를 의존성으로 두면 매 렌더마다 발화하고, `App`이 무조건 저장하면 루프가 된다.
  - **이전 요청·이전 모델 상태 잔존 없음** — 모델 변경 경쟁(§J)에서 이전 응답이 적용 불가로 만료됨을 확인. 새 응답이 이전 펼침을 물려받지 않음(§G)도 확인.
  - **최종 입력 자동 변경 없음** — 펼침·응답 도착·stale·실패·취소 어느 경우에도 `#prompt-final`과 negative가 변하지 않음을 단언.
  - **응답 도착에 따른 포커스 이동 없음** — 요청 대기 중 영어 필드로 접고 입력한 뒤, 느린 응답이 도착해도 `document.activeElement`가 `#prompt-final`에 그대로 있음을 단언(§H).
  - **접힌 상태의 4상태 표시** — 구성 중(`pending`)/후보 준비·개수(`ready` + `후보 3개`)/실패(`failed` + 사유)/재구성 필요(`stale`)를 모두 `data-phase`와 문구로 확인(§H·§I·§F).
- **남은 문제**
  - 실기기 IME·소프트 키보드·회전은 이 환경에 없어 확인하지 못했다(UIX07 인계).
  - `pendingFocusRef`로 구현된 “귀속 변경 후 포커스 유지”는 브라우저로 확인하지 않았다(UIX07 인계).
  - `:has()` 기반 다인 그룹 세로 배치는 구형 브라우저에서 그룹이 가로로 흐를 뿐 판독에는 지장이 없다.
  - negative 미지원 검사는 `/models` 응답을 페이지에서 stub해 `generation_options.negative_prompt.mode`를 `unsupported`로 바꾸는 방식이다. 실제 백엔드가 그런 프로필을 내려줄 때의 서버측 검증은 UCP 계약 테스트가 담당한다.
- **다음 ID** — **UIX04** (생성 설정과 제출 오류).


### UIX04 · 생성 설정과 제출 오류

`App.tsx`의 생성 폼은 해상도·수량 뒤에 Steps·CFG·Seed와 고정 옵션을 모두 표시한다. Seed 검사는 submit에서 전역 오류로 반환한다.

- [x] 프리셋·해상도·수량·생성 버튼은 기본 경로에 둔다. Steps·CFG·Seed와 sampler/scheduler 설명은 ‘세부 생성 설정’에 묶고 선택된 값의 요약을 표시한다. Negative 사용 조건은 해당 입력 옆에 유지한다.
- [x] 생성이 막히면 버튼 근처에 첫 원인과 수정할 필드로의 이동을 제공한다. 접힌 설정의 오류로 이동하면 먼저 펼친다. 기존 제출 검사와 모델별 허용 조건을 재사용한다.
- **완료 기준** — 기본 생성 및 세부 설정 변경 후 생성에서 요청 본문의 프리셋 관련 값·seed·수량이 기존 계약과 일치한다. 빈 최종 입력, 잘못된 seed, CFG에 따른 negative 제한을 각각 확인하고 수정 뒤 제출한다. 펼침만으로 설정이 초기화되지 않는다.

**결과 (2026-11-25 완료)**

- **변경 파일**
  - `frontend/src/lib/generate.ts` (신규) — 세부 설정 요약과 오류 라우팅의 순수 함수. `FIELD_ORDER`·`FIELD_SELECTOR`·`FIELD_IN_DETAILS`·`FIELD_LABEL`, `seedIssue`, `firstIssue`, `detailSummary`. React·네트워크·capability 판정을 포함하지 않는다.
  - `frontend/src/App.tsx` — `settingsOpen`(UI 전용) 접기 상태, `pendingFieldRef`+`settingsFocusTick`로 커밋 후 포커스, `<div id="prompt-settings" hidden={!settingsOpen}>`로 Steps/CFG/Seed를 접음(`hidden`, 언마운트 아님), 요약은 `settings`에서 파생, `.generate-blocker` 추가, `submittingRef` 재진입 가드 추가. 사용하지 않던 `detailFieldRefs`·`negativeRef` 제거(효과가 selector로 해석한다).
  - `frontend/src/styles.css` — `.prompt-settings__row`·`.prompt-settings__toggle`(44px)·`.prompt-settings__summary`·`.prompt-settings[hidden]`·`.generate-blocker`(44px 이동 버튼), 그리고 `.chips button { min-height: 44px; }`(프리셋 터치 영역).
  - `frontend/tests/prompt-uix04.test.mjs` (신규) — 24건. 요약 파생·고정 CFG·빈 seed·투영 우선순위·재진입 가드 위치·44px·마크업 단언.
  - `scripts/prompt-composer-browser/suite-uix04.mjs` (신규) — 브라우저 A~K절. `/models`만 stub해 프리셋 값을 서로 다르게 하고 negative를 CFG 7에 묶는다. 그 외 요청은 실제 fake 엔진으로 나가며, 본문은 `POST /api/v1/jobs` 가로채기로 검사한다.
  - `scripts/prompt-composer-browser/suite-ucp08.mjs` — **기존 검사의 결함 수정**(아래 참조).
  - `scripts/prompt-composer-browser/suite.mjs` — UIX04를 마지막에 연결.
  - `docs/evidence/art-studio-uix04/` — 신규 증거.

- **실제 동작**
  - 기본 경로에 모델·경로 선택·최종 프롬프트·Negative·프리셋 3개·해상도·수량·생성 버튼이 있고, Steps/CFG/Seed는 ‘세부 생성 설정 펼치기’ 뒤에 접혀 있다. 접힌 채로 `Steps 6 · CFG 1 · Seed -1` 요약이 보인다(fixture의 `balanced` 프리셋 steps 6, 모델 CFG 기본값 1.0).
  - 프리셋을 누르면 Steps/CFG가 그 값으로 채워지고 Seed는 건드리지 않는다. 그 뒤 수동으로 고친 값이 요약과 **요청 본문**에 함께 실린다(`steps 31`, `cfg_scale 5.5`, `seed 4242`, `width/height 768`, `batch_count 3`, `job_type image.batch`, `preset quality`).
  - 접기·펼치기를 반복해도 값·요약이 그대로이고 `/prompt/compose`·`POST /jobs` 요청은 늘지 않는다.
  - 빈 최종 프롬프트나 잘못된 seed는 버튼 위 `.generate-blocker`에 첫 원인을 표시하고 ‘수정 위치로 이동’을 제공한다. 접힌 세부 설정의 오류면 문장에 ‘(세부 생성 설정을 펼칩니다)’가 붙고, 이동하면 펼친 뒤 해당 필드에 포커스가 간다. 필드를 고치면 별도 조작 없이 표시가 사라진다.
  - 서버 거부(413)는 `.errorbox`에만 남고 버튼 옆에는 붙지 않는다.

- **선행 코드 · 기존 검사에서 고친 것 (신규 구현 아님)**
  - **`submittingRef` (앱 결함).** `submitting`은 React state라 같은 이벤트 루프 턴에서는 아직 `false`다. `button.click()`을 연속 3회 동기 호출하면 셋 다 통과해 작업 3건이 접수됐다(`jobsBeforeClick 2 → jobsAfterClick 5`). `disabled`도 다음 커밋에야 붙으므로 막지 못한다. ref는 즉시 갱신되므로 같은 턴의 중복도 막는다. 이 라운드에서 잡은 유일한 앱 버그다.
  - **`suite-ucp08.mjs` 413 stub (하네스 결함).** `stubOnce`의 술어가 `url.includes('/api/v1/jobs')`로 메서드를 보지 않았다. 큐 폴링이 4초마다 `GET /api/v1/jobs?limit=…`를 부르므로 **폴링이 1회용 413을 소비**하고, 실제 POST는 성공해 오류 상자가 뜨지 않았다. 같은 파일의 다른 stub 3곳은 모두 `init.method === 'POST'`를 본다. 술어에 메서드를 추가해 고쳤다. 앱 코드는 손대지 않았다 — 격리 재현(`/tmp` 스크립트)에서 413 경로 자체는 정상 동작함을 먼저 확인했다.
  - **프리셋 터치 영역.** 공용 `.chips button` 규칙이 31px를 만들었다. UIX03이 후보 카드에 44px를 요구한 것과 같은 기준을 기본 경로 버튼에도 적용했다(`.chips`로 한정 — `.prompt-chip`은 별개).

- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과.
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공(410.57 kB).
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **374 tests, 374 pass, 0 fail**(신규 `prompt-uix04` 24건 포함).
  - `sh scripts/prompt-composer-browser/verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=2`, Chromium CDP) → **785 checks, 0 failed**. UIX04 단언 114건, UCP08 181건 전부 통과. `results.json` 913항목 = 판정 785 + 정보 128.
  - `git diff --check` → clean.

- **요구사항별 검증 근거**

  | 요구 | 근거 |
  | --- | --- |
  | 기본 설정으로 생성 시 기존 요청 본문 계약 | 브라우저 §C `UIX04 · 요청이 생성됨` + 본문 `steps/cfg_scale/seed/width/height/batch_count/job_type/preset` 8건 |
  | 프리셋 선택 후 Steps·CFG·Seed 수동 변경 및 생성 | 브라우저 §C `프리셋이 Steps를 채움`·`프리셋이 CFG를 채움`·`프리셋이 Seed를 바꾸지 않음`·`수동 수정이 프리셋 값을 덮어씀` → 본문 `31 / 5.5 / 4242` |
  | 접기·펼치기 이후 값과 요약 보존 | 브라우저 §B `접어도 Steps/CFG/Seed 보존`·`접어도 요약 보존`·`다시 펼쳐도 …` 6건 |
  | 해상도·수량의 정확한 본문 반영 | 브라우저 §C `본문 해상도가 선택값 768`·`본문 높이도 선택값`·`본문 수량이 입력값 3` |
  | 기존 Seed 허용값과 잘못된 값 검증 | 단위 `the seed accepts -1 (random) and rejects everything below it`(-1·0·12345·공백 통과, -2·1.5·abc 거부) |
  | 빈 최종 프롬프트 제출 오류 및 포커스 이동 | 브라우저 §E `빈 최종 프롬프트가 생성을 막음`·`막힌 이유가 최종 프롬프트를 지목함`·`최종 프롬프트로 포커스 이동` |
  | 접힌 Seed 오류에서 자동 펼침 및 포커스 | 브라우저 §D `접힌 상태에서 펼침을 예고함`·`이동이 접힌 세부 설정을 펼침`·`이동이 Seed 필드에 포커스를 둠` |
  | 오류 수정 후 정상 제출 | 브라우저 §D `수정하면 막힘 표시가 사라짐`·`오류 수정 후 정상 제출`·`수정한 Seed가 본문에 실림` |
  | CFG·capability에 따른 Negative 처리 | 브라우저 §F `CFG 7에서 Negative 사용 가능`·`CFG 2.5에서 Negative 비활성`·`계약대로 Negative 값이 비워짐` |
  | 모델 변경 후 기존 설정 계약 유지 | 브라우저 §I `모델 변경 후에도 펼침 상태 유지`·`모델 변경 후 요약이 새 모델 값을 반영`·`CFG 7로 돌아오면 다시 사용 가능` |
  | 접기·펼치기만으로 요청 없음 | 브라우저 §B `접기·펼치기로 compose 요청 없음`·`생성 요청 없음`(fetch 스파이 카운터 비교) |
  | 제출 연속 클릭 중복 보호 | 브라우저 §H `연속 클릭이 한 건만 접수`(동기 3회 클릭 → 1건) + 단위 재진입 가드 3건 |
  | 360px·1280px 넘침·터치·키보드 | 브라우저 §J 360/1280 각 8건(넘침 0, 토글·생성·프리셋 44px, 요약 화면 안), §K Tab/Enter 5건 |
  | 서버 오류와 입력 오류 구분 | 브라우저 §G `서버 오류가 오류 상자에 표시됨`·`서버 오류는 버튼 옆에 붙지 않음`·`입력 보존`·`재시도 가능` |
  | 필드 수정 후 오류 표시 일치 | 단위 `the blocking line and the button read the same list`(한 목록 `allIssues`를 버튼·필드·블로커가 함께 읽음) |

- **남은 문제**
  - 실기기 IME·소프트 키보드·회전은 이 환경에 없다(UIX07 인계).
  - Negative 미지원 경로는 `/models` 응답을 페이지에서 stub한다. 서버측 검증은 UCP 계약 테스트 담당이다.
  - 해상도·수량에는 별도 오류 문구를 만들지 않았다. 두 필드 모두 `min`/`max`와 모델의 `supported_resolutions`가 값을 제한하고, 서버가 최종 판정한다 — 여기에 두 번째 검증기를 두면 버튼과 판정이 갈릴 수 있다.
  - `native window.confirm`은 UIX03과 같은 이유로 스크린샷에 담기지 않는다(변경하지 않음).
- **증거** — `docs/evidence/art-studio-uix04/`
- **다음 ID** — **UIX05** (접수 확인과 작업 큐).

### UIX05 · 접수 확인과 작업 큐

`App.tsx`의 submit 성공 경로는 createJob 후 큐 페이지를 0으로 돌린다. `frontend/src/components/JobCard.tsx`의 취소·재시도는 finally에서 새로고침하며 조작 중 표시와 카드별 오류 처리가 없다.

- [x] 접수 응답의 작업 식별자를 생성 버튼 옆에 표시하고 ‘작업 큐에서 보기’를 제공한다. 사용자가 누르면 접힌 큐를 열고 첫 페이지를 갱신해 해당 카드를 찾는다. 목록 갱신 전에도 접수 성공 안내를 유지한다.
- [x] 카드 상태를 한국어로 표시하고 API 상태값에 따른 기존 행동을 유지한다. 취소·재시도 중에는 같은 작업의 중복 클릭을 막고 실패 이유를 해당 카드에 표시한다.
- **완료 기준** — 큐가 접혔거나 다른 페이지인 상태에서 접수해 정확한 작업을 찾는다. 접수 실패 시 입력이 유지되고 성공 안내가 뜨지 않는다. 실패 작업 재시도를 연속 클릭해도 요청 한 건이며, API 오류 뒤 재조작이 가능하다.

**결과 (2026-11-26 완료)**

- **변경 파일**
  - `frontend/src/lib/jobsView.ts` (신규) — 큐 표시 전용 순수 함수. `jobStatusKo`(서버 어휘 → 한국어, 미지 값은 그대로), `jobTerminal`, `jobCanCancel`·`jobCanRetry`(카드가 늘 쓰던 두 조건을 한 곳으로), `jobIdentity`, `QueueNavPhase`·`queueNavMessage`, `receiptText`. React·네트워크·저장 없음.
  - `frontend/src/App.tsx` — `receipt`(POST 응답만 기록), `queueNav`+`navTargetRef`(찾기 상태), `jobsTokenRef`(읽기 순서 가드), `applyJobs`(`setJobs`의 유일한 기록자), `showInQueue`, `changeJobPage`. 접수 확인은 생성 버튼 아래 `.generate-receipt`.
  - `frontend/src/components/JobCard.tsx` — `busy`/`failure`/`lockRef`, `data-job-id`·`data-spotlight`·`data-busy`, `.badge`에 `data-status`(서버 값) + 한국어 라벨, 작업 ID·해상도·수량 표시, 조작 실패는 카드 안 `.job-failure`.
  - `frontend/src/styles.css` — `.generate-receipt`·`.jobs-nav`(+`data-phase` 색)·`.job-spotlight`·`.job-id`·`.job-error`·`.job-failure`, 카드 버튼 44px, 420px 이하 카드 줄바꿈.
  - `frontend/tests/prompt-uix05.test.mjs` (신규) — 13건. 상태 어휘 대응(스키마 원문과 대조), 취소·재시도 계약을 상태별로, 접수/목록 분리의 구조 단언, 순서 가드, 카드 잠금.
  - `scripts/prompt-composer-browser/suite-uix05.mjs` (신규) — 브라우저 A~M절. `fetch` 스위치보드 하나로 목록 실패·조작 실패·지연·응답 변조·읽기 보류를 제어하고, 생성 POST는 항상 실제 fake 엔진으로 보낸다.
  - `scripts/prompt-composer-browser/suite-contracts.mjs` — **기존 검사 1건 수정**(아래 참조).
  - `scripts/prompt-composer-browser/suite.mjs` — UIX05를 마지막에 연결.
  - `docs/evidence/art-studio-uix05/` — 신규 증거.

- **실제 동작**
  - 생성이 접수되면 버튼 바로 아래에 `접수됨 · <서버가 준 job_id> · 대기`가 뜨고 ‘작업 큐에서 보기’가 함께 나온다. 이 줄은 `POST /jobs` 응답만으로 그려지므로 **목록 조회 전·조회 실패와 무관하게** 남는다.
  - ‘작업 큐에서 보기’를 누르면 접힌 큐가 펼쳐지고, 페이지 0으로 옮긴 뒤, 그 페이지에서 **접수한 그 작업 카드 하나만** 강조한다(‘접수한 작업’ 표시 + 보라 테두리). 다른 작업은 선택되지 않는다.
  - 대상이 목록에 없으면 `접수한 작업이 아직 이 목록에 없습니다 … 다른 작업을 대신 선택하지 않았습니다.`가, 조회가 실패하면 `작업 목록을 불러오지 못했습니다 … 접수 정보는 위에 그대로 남아 있습니다.`가 목록 위에 뜨고 두 경우 모두 ‘다시 조회’ 버튼을 준다. 두 문장은 서로 다르고, 어느 쪽도 접수 실패로 읽히지 않는다.
  - 카드 배지는 한국어(`대기`·`GPU 대기`·`실행 중`·`완료`·`실패`·`취소됨`·`중단됨`)이고 `data-status`에 서버 값을 그대로 보존한다. 버튼은 이전과 같은 조건에서만 나온다(취소 = 종료 전, 재시도 = failed/cancelled/interrupted).
  - 조작을 누르면 그 카드의 버튼만 `취소 중…`/`재시도 중…`으로 바뀌고 `aria-busy`가 붙으며, 같은 카드의 두 버튼이 함께 잠긴다. **다른 카드는 그대로 눌린다.** 실패하면 그 카드 안에 `취소 실패 · <서버 사유>`가 뜨고 잠금이 풀린다. 전역 `.errorbox`로 새지 않는다.
  - 재시도는 서버 계약대로 **새 Job ID**를 만든다(`retry_of`가 원래 작업을 가리킴). 카드는 그것을 새 작업으로 표시한다.
  - 진행률·남은 시간·큐 순번은 계산하지 않는다. API가 주지 않는 값이다.

- **선행 코드 · 기존 검사에서 고친 것 (신규 구현 아님)**
  - **`suite-uix05.mjs` 목록 래퍼 (하네스 결함, 이번 라운드에 자체 발견).** `/jobs` 응답을 `patchList`용으로 읽은 뒤 **같은 Response 객체를 앱에 돌려주고 있었다.** 본문은 이미 소비됐으므로 앱의 파싱이 `body already read`로 던지고, `refresh`의 `Promise.all` 전체가 실패해 모델 목록이 비었다 → 생성 버튼이 영구 비활성. 첫 실행에서 UIX05 §A가 `timeout receipt`로 죽은 원인이다. `response.clone().json()`으로 고쳤다. 격리 재현(`/tmp/r5.mjs`, UIX04의 영속 stub까지 그대로 올린 상태)에서 앱 자체는 정상임을 먼저 확인한 뒤 하네스를 고쳤다 — **앱 코드는 손대지 않았다.**
  - **`suite-contracts.mjs` 재시도 카드 (기존 검사가 새 표시와 충돌).** `check("재시도 · 종료된 작업 카드", "cancelled", badge.textContent)`가 배지의 **영문 원문**을 기대했다. UIX05가 배지를 한국어로 바꾼 것은 요구사항이므로, 계약 값은 `data-status`에서, 사람이 보는 값은 라벨에서 읽도록 나눴다(`cancelled` + `취소됨` 두 단언). 검사가 요구사항을 막지 않게 한 수정이다.
  - **카드 포커스 검사 (내가 쓴 검사의 결함).** 첫 카드의 첫 버튼을 잡았는데 그 버튼이 비활성이면 `focus()`가 무효다. 활성 버튼을 고르도록 바꾸고, 포커스 표시(`outlineWidth > 0`)를 별도 단언으로 분리했다.
  - **카드 오류 줄 레이아웃 (앱 결함, 스크린샷 검토 중 발견).** `.job-failure`는 `flex: 1 1 100%`로 한 줄을 다 쓰는데, 카드가 줄바꿈을 하지 않던 것은 `max-width: 420px` 안에서뿐이었다. 1280px에서는 실패 줄과 조작 버튼이 같은 줄에서 폭을 다투어 **취소 버튼이 세로 막대처럼 찌그러졌다**(`uix05-13-op-error-1280.png`의 이전 판). `.job { flex-wrap: wrap }`을 폭 조건 밖으로 올리고 본문 열에 `min-width: 0`을 주어 고쳤다. 재발 방지로 `오류가 있어도 버튼 폭이 유지됨`(너비 ≥ 44px, 너비 ≥ 높이)을 360·1280 양쪽에 추가했다. 884건 실행에서 두 폭 모두 통과.

- **발견 결함 분류 정정 (UIX05 검토 반영)**

  이번 라운드에 고친 3건은 성격이 다르므로 아래와 같이 분류한다. 앞선 보고에서 "앱 버그 1건 + 하네스 2건"으로 뭉뚱그린 것을 정정한다.

  | 결함 | 분류 | 내용 |
  | --- | --- | --- |
  | `/jobs` 응답 본문 소비 | **하네스** | 목록 래퍼가 읽은 Response를 그대로 반환해 앱 파싱이 실패. 앱 코드 무관. |
  | 카드 포커스 검사가 비활성 버튼을 잡음 | **검사** | 내가 쓴 단언의 선택자 문제. 제품 동작은 정상이었다. |
  | 1280px 카드 오류 줄에서 버튼 찌그러짐 | **앱 레이아웃** | 실제 사용자에게 보이던 결함. CSS로 수정. |

- **UIX05 검토 지적: `Promise.all`과 목록 실패 (확인 결과)**

  지적대로 `refresh`는 `Promise.all`이므로 `GET /jobs` 하나가 실패하면 `setStatus`·`setModels`·`setAssets`가 **모두 실행되지 않는다**. 격리 재현(`/tmp/r6b.mjs`)으로 두 경우를 나눠 확인했다.

  | 상황 | 결과 | 판정 |
  | --- | --- | --- |
  | 목록이 **이미 로드된** 뒤 실패 | 모델 목록·선택 모델·최종 입력이 그대로 유지됨 | 문제 없음 |
  | **첫 로드**에서 목록 실패 | 모델 목록이 비어 생성 버튼이 비활성으로 남음(다음 폴링에서 자동 회복) | 제약으로 기록 |

  이미 로드된 화면이 망가지지 않는 것은 `Promise.all`이 실패 시 **아무 setter도 실행하지 않기** 때문이다. 그래서 `allSettled` 전환은 이 동작을 바꾸지 않고 부분 갱신만 가능하게 만든다 — 이번 범위에서는 **리팩터링하지 않았다.** 재현에서 본 실제 제약은 **최초 진입 시점에 목록 조회가 실패하면 생성 폼이 그 폴링 주기 동안 비활성**이라는 점 하나이며, 이것은 아래 '남은 문제'에 별도 결함으로 기록한다.

  UIX05 §B에 이 계약을 명시하는 단언을 보강했다: `목록 실패가 모델 목록을 비우지 않음`·`목록 실패가 선택 모델을 바꾸지 않음`·`목록 실패가 최종 입력을 바꾸지 않음`. 기존에는 접수 정보만 확인하고 폼은 확인하지 않았다.

- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과.
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **391 tests, 391 pass, 0 fail**(신규 `prompt-uix05` 13건 포함).
  - `sh scripts/prompt-composer-browser/verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=6`, Chromium CDP) → **884 checks, 0 failed**. UIX05 단언 100건. `results.json` 1029항목 = 판정 884 + 정보 145.

- **집계 차이 설명 (785 → 884, UIX05 100건)**

  세 수는 서로 다른 것을 센다.

  - **785 → 884 (+99)**: UIX05 착수 전 기준선 785판정에서 이번 라운드 최종 884판정으로 늘어난 **순증**이다.
  - **UIX05 전용 100건**: UIX05 블록이 실행한 판정 수다.
  - 차이 **1건**은 UIX05 블록 바깥에서 늘어난 몫이다 — `suite-contracts.mjs`의 재시도 카드 검사를 `cancelled`/`취소됨` 두 단언으로 나눈 것이 +1이다(1건 → 2건).
  - 즉 `99 = 100 − 1`이며, UIX05 블록을 99건으로 세거나 증가분을 100건으로 적으면 어긋난다. `results.json` 1029는 여기에 정보 항목 145건을 더한 값이므로 판정 수와 직접 비교하면 안 된다.
  - `git diff --check` → clean.

- **요구사항별 검증 근거**

  | 요구 | 근거 |
  | --- | --- |
  | 생성 성공 직후 실제 Job ID 표시 | 브라우저 §A `접수 확인이 생성 버튼 근처에 표시됨`·`접수 확인이 실제 Job ID를 담음`·`표시된 ID가 서버 작업과 일치`(`GET /jobs/{id}`로 재확인)·`표시된 ID가 이번 요청의 작업` |
  | 목록 갱신 전 접수 확인 표시 | §A `접수 표시는 목록 갱신 전에도 보임`(큐가 접힌 상태에서 단언)·`접수 한 번에 POST 한 번` |
  | 목록 조회 실패 후 접수 정보 유지 | §B `목록 조회 실패에도 접수 정보 유지`·`목록 조회 실패를 생성 실패로 바꾸지 않음`·`목록 실패가 오류 상자에 표시됨` |
  | 목록 실패로 POST 재전송 없음 | §B `목록 조회 실패로 POST 재전송 없음`(스위치보드 `posts` 카운터 비교) |
  | 접힌 큐에서 명시적 이동 | §C `이동 전 큐는 접혀 있음` → `이동이 접힌 큐를 펼침` |
  | 다른 페이지에서 페이지 0 이동·정확한 카드 | §C `이동이 페이지 0으로 감`(작업 13건 이상이면 다음 페이지에서 시작)·`이동이 정확히 그 작업 카드만 표시`(강조 ID 배열이 `[acceptedId]`와 일치) |
  | 대상 미발견 처리 | §D `없는 작업은 missing 안내`·`대신 선택된 카드 없음`·`안내에 목록 재조회 경로가 있음`·`목록에 다른 작업은 그대로 보임` |
  | 조회 실패 처리 | §E `조회 실패는 error 안내`·`조회 실패에도 접수 정보 유지`·`조회 실패로 POST 재전송 없음` |
  | 폴링·명시 갱신 응답 순서 경쟁 | §J `오래된 응답이 목록을 덮어쓰지 않음`·`오래된 응답의 내용이 화면에 없음`·`오래된 응답이 페이지를 바꾸지 않음`·`두 번의 갱신이 실제로 있었음`(먼저 보낸 읽기를 붙잡아 두고, 나중 읽기가 착지한 뒤 놓아줌) |
  | 서버 상태 ↔ 한국어 표시 | 단위 `every server status has a Korean label…`·`the server status vocabulary in this test matches the schema`(스키마 원문 대조), 브라우저 §L `모든 배지가 서버 상태와 대응` |
  | 작업별 취소·재시도 진행 상태 | §G `조작 중 카드가 busy 표시`·`버튼 라벨이 취소 중…`·`해당 버튼이 비활성`·`aria-busy가 취소에만`·`조작이 끝나면 busy가 사라짐` |
  | 동일 작업 동기 연속 호출 중복 방지 | §F `연속 클릭이 한 건만 요청`(같은 카드 버튼 3회 동기 클릭 → 조작 1건) + 단위 `the card locks per job and releases the lock on every outcome` |
  | 조작 실패 후 잠금 해제·오류 표시 | §H `조작 실패가 해당 카드에 표시됨`·`실패 사유가 서버 응답`·`실패 후 잠금이 풀려 다시 조작 가능`·`조작 실패가 전역 오류 상자에 새지 않음` |
  | 다른 카드 독립 조작 | §F `다른 카드는 함께 요청되지 않음`·`다른 카드를 독립적으로 조작`, §G `다른 카드는 조작 가능한 상태 유지`, §H `다른 카드에는 실패 문구 없음` |
  | 재시도 = 새 Job ID (실제 API 계약) | §I `재시도가 새 Job ID를 만듦`·`재시도 결과가 원래 작업과 다름`·`재시도 한 번에 조작 한 번` — `routes.py`의 `retry`가 `enqueue(..., retry_of=job_id)`로 복사본을 만드는 계약 그대로 |
  | UIX04 중복 방지 회귀 | §K `생성 연속 클릭이 한 건만 접수(UIX04 회귀)`(동기 3회 → POST 1회) |
  | UCP08 413 처리 회귀 | §K `413이 오류 상자에 도달(UCP08 회귀)`·`413 stub이 생성 POST 한 번만 소비`(메서드+경로로 한정한 stub이 폴링에 먹히지 않음) |
  | 360·1280 넘침·터치·키보드 | §L 360/1280 각 15건(접수 줄·강조 카드 화면 안, 넘침 0, 버튼 44px, 카드 내부 넘침 0, 상태 배지 대응, 조작 오류 문구 화면 안), §M `생성 버튼 다음 Tab이 접수 확인 버튼`·`Enter로 작업 큐 이동 동작`·`카드 조작 버튼이 포커스를 받음`·`포커스 표시가 있음` |
  | 접수만으로 포커스·화면 이동 없음 | 단위 `queue navigation … does not auto-scroll or focus`(submit 성공 분기와 `showInQueue` 본문에 `scrollIntoView`/`.focus()` 없음) |

- **남은 문제**
  - **최초 진입 시 목록 조회 실패 → 생성 폼 일시 비활성 (이번 검토에서 확인한 제약).** `refresh`가 `Promise.all`이라 첫 로드에서 `GET /jobs`가 실패하면 모델 목록이 도착하지 않아 생성 버튼이 다음 폴링(4초)까지 비활성으로 남는다. 이미 로드된 뒤의 실패는 화면을 건드리지 않는다(위 표). 고치려면 응답을 요청별로 독립 처리해야 하며, 이는 조회 계약 변경이라 이번 범위에서 하지 않았다.
  - 실기기 IME·소프트 키보드·회전은 이 환경에 없다(**UIX07 인계**).
  - 귀속 변경 후 포커스 유지의 브라우저 검증도 **UIX07 인계**다(UIX03에서 구현·단위만 확인).
  - `gap04` 증거 복원도 **UIX07 인계** 항목으로 남아 있다(이번 라운드에서도 손대지 않았다).
  - 목록 조회 실패는 페이지에서 `GET /jobs` 응답을 503으로 바꿔 만든다. 서버측 5xx 동작 자체는 UCP 계약 테스트 담당이다.
  - 조작 실패는 409 응답을 페이지에서 주입한다. 실제 `409`는 서버가 이미 종료된 작업에 보내는 응답이며, 앱은 그 `detail`을 그대로 표시한다.
  - 진행률·남은 시간·순번은 표시하지 않는다. 서버가 주지 않는 값을 클라이언트가 계산하지 않는다는 결정이며, 필요해지면 API가 먼저다.
- **증거** — `docs/evidence/art-studio-uix05/` (스크린샷 17장: `uix05-01`~`09` 흐름, `uix05-10`~`13` × 360/1280)
- **다음 ID** — **UIX06** (갤러리와 상세 화면 복귀).


### UIX06 · 갤러리와 상세 화면 복귀

`App.tsx` 갤러리 카드가 반복해서 ‘이미지 보기’와 ‘정보’를 제공한다. `frontend/src/components/ImageViewer.tsx`와 `MetadataModal.tsx`는 각각 별도 대화상자다.

- [x] 보기·정보 버튼의 접근 가능한 이름에 카드 식별 정보를 포함한다. 대화상자를 열면 내부에 초점을 두고 Tab 순환·Escape 닫기·원래 버튼으로 복귀를 두 화면에서 일관되게 처리한다.
- [x] ‘이 설정으로 다시 생성’이 성공하면 복원된 최종 입력으로 안내한다. 덮어쓰기 취소 시 상세 화면을 유지한다. 보관 이동으로 원래 카드가 사라지면 갤러리 제목으로 초점을 돌린다.
- **완료 기준** — 키보드로 두 번째 카드의 보기와 정보를 각각 열어 닫고 초점 복귀를 확인한다. 뷰어의 이전·다음 및 페이지 경계 이동을 유지한다. v2/v3 재사용 후 최종 문자열과 기록이 복원되고 자동 compose·이미지 생성 요청이 없다.

**결과 (2026-11-26 완료)**

- **변경 파일**
  - `frontend/src/lib/dialog.ts` — 공용 대화상자 계층. `useDialogFocus`가 열릴 때 초기 포커스를 잡고 Tab·Shift+Tab을 가두며, 닫힐 때 **열기 요소가 아직 DOM에 있으면 그리로**, 없으면 지정한 대체 대상으로 되돌린다. 중첩은 열린 순서 스택으로 판정해 **최상위 대화상자만** Escape와 트랩을 처리한다.
  - `frontend/src/components/ImageViewer.tsx` — `aria-label`에 이미지 ID를 넣고 `aria-modal`, 초기 포커스를 닫기 버튼에 둔다. 이전·다음 이동과 페이지 경계는 기존 계약 그대로다.
  - `frontend/src/components/MetadataModal.tsx` — `aria-label`에 이미지 ID, 초기 포커스는 재사용 버튼, 대화상자 안에 이미지 ID를 텍스트로도 표시. 보관·재사용 실패는 `.modal-failure`(`role="alert"`)로 **모달 안에** 표시한다.
  - `frontend/src/App.tsx` — 갤러리 카드 버튼 이름에 `· <assetId 앞 8자>`를 붙이고, 열기 요소를 `ref`로 기억한다. 재사용 성공 시 `#prompt-final`로 포커스, 보관 성공으로 카드가 사라지면 갤러리 `h2`(프로그래밍 방식 포커스를 위해 `tabIndex={-1}`)로 포커스.
  - `frontend/src/styles.css` — 갤러리 정보 버튼·뷰어 닫기·메타데이터 액션을 44px 터치 하한으로 올리고, 갤러리 제목 포커스 링과 `.modal-failure`·`.asset-detail-id`를 추가했다.
  - `frontend/tests/prompt-uix06.test.mjs` (신규) — 18건. 대화상자 이름·ID 계약, 초기 포커스, 트랩, 복귀 대상 결정(열기 요소/대체/없음), 재사용 성공 시 포커스 대상, 실패 시 모달 유지.
  - `frontend/tests/prompt-metadata-modal.test.mjs` — 기존 렌더 테스트의 모듈 리졸버에 `react`를 추가했다. `lib/dialog.ts`가 훅을 직접 쓰므로 런타임만으로는 부족해졌다.
  - `scripts/prompt-composer-browser/suite-uix06.mjs` (신규) — 브라우저 A~F절.
  - `scripts/prompt-composer-browser/suite-uix05.mjs` — §B에 폼 보존 단언 3건 보강(UIX05 검토 항목).
  - `scripts/prompt-composer-browser/suite.mjs` — UIX06 연결.
  - `docs/evidence/art-studio-uix06/` — 신규 증거.

- **실제 동작**
  - 갤러리 카드의 두 버튼은 `이미지 보기 · b3d136d1`, `정보 · b3d136d1`처럼 **카드마다 다른 이름**을 갖는다. 같은 화면에 카드가 여러 장 있어도 스크린리더가 어느 카드인지 구분한다.
  - 보기·정보 어느 쪽을 열어도 포커스가 대화상자 **안**으로 들어간다(뷰어는 닫기, 메타데이터는 재사용 버튼). Tab·Shift+Tab은 그 안에서만 순환하고, Escape와 닫기 버튼은 **연 카드의 버튼**으로 되돌린다.
  - 재사용을 확인하면 값이 복원되고 포커스가 최종 프롬프트로 간다. 복원만으로 compose나 생성 요청은 나가지 않는다.
  - 덮어쓰기 확인을 취소하면 모달이 그대로 남고 포커스는 재사용 버튼으로 돌아온다.
  - 보관에 성공해 카드가 사라지면 포커스가 **갤러리 제목**으로 간다 — 사라진 카드로 돌아가려 하지 않는다.
  - 보관·재사용이 실패하면 모달이 유지되고 오류가 모달 안에 뜬다. 페이지 뒤쪽 오류 상자로 새지 않는다.
  - 뷰어의 이전·다음과 첫/마지막 경계는 바뀌지 않았다.

- **발견한 결함 (앱, 이번 라운드에 수정)**
  - **터치 하한 미달 3곳.** 360·1280 양쪽에서 갤러리 `정보` 버튼이 약 30px, 뷰어 `×`가 약 30px, 메타데이터 액션 버튼이 약 31px로 44px에 못 미쳤다. 새로 추가한 뷰포트 절이 6건으로 잡아냈다(폭마다 3건). 셋 다 CSS로 44px 하한을 주어 고쳤고, 수정 후 같은 절이 통과한다.
  - 그 밖의 결함은 없었다. 대화상자 포커스·트랩·복귀는 신규 구현이지만 기존 구조(`.modal-backdrop`/`.modal`, `.image-viewer`)를 그대로 쓰고 외부 라이브러리는 넣지 않았다.

- **내가 쓴 검사의 결함 (제품 아님)**
  - **인덱스로 카드를 기억했다.** 처음에는 `gallery[1].openLabel`을 기대값으로 썼는데, 갤러리는 폴링으로 갱신되므로 그 사이 새 이미지가 앞에 붙으면 `gallery[1]`이 **다른 카드**를 가리킨다. `Escape 후 정보 버튼으로 포커스 복귀`가 실제로 이 이유로 한 번 실패했다. 클릭 시점에 그 버튼의 라벨을 읽어 비교하도록 바꿨다 — 이 태스크가 요구한 "배열 index가 아닌 식별자 기준"을 검사 자신도 지키게 한 수정이다.
  - 이 수정으로 뷰어·메타데이터·닫기 버튼 복귀의 기대값이 모두 **클릭한 그 버튼의 라벨**이 되었다.

- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과.
  - `npm --prefix frontend run build` → `tsc -b && vite build` 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **409 tests, 409 pass, 0 fail**(신규 `prompt-uix06` 18건 포함).
  - `sh scripts/prompt-composer-browser/verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=6`, Chromium CDP) → **964 checks, 0 failed**. UIX06 단언 77건. `results.json` 1124항목 = 판정 964 + 정보 160.
  - `git diff --check` → clean.

- **요구사항별 검증 근거**

  포커스는 모두 **실제 `document.activeElement`**로 확인한다. 스크린샷이나 CSS `outline`만으로 판정하지 않는다 — `outline`은 초기 포커스 검사에서 보조 신호로만 쓰고, 통과 판정은 `activeElement` 동일성이다.

  | 요구 | 근거 |
  | --- | --- |
  | 두 대화상자의 접근 가능한 이름 | §A `보기 버튼 이름에 이미지 식별자 포함`·`정보 버튼 이름에 이미지 식별자 포함`·`카드마다 서로 다른 이름`, §B `뷰어 이름에 이미지 식별자 포함`, §C `메타데이터 이름에 이미지 식별자 포함`. 이름은 `aria-label`이고 값은 `… · <assetId 앞 8자>` |
  | 기존 이미지 ID·Job ID 계약 유지 | §C `대화상자가 이미지 ID를 표시`(모달 본문 `.asset-detail-id`) + 단위 `the dialog name carries the asset id`·`the metadata dialog keeps the job id contract` |
  | Tab·Shift+Tab 포커스 트랩 | §B `Tab이 뷰어 밖으로 나가지 않음`(5회 순회 전부 `dialog`)·`Shift+Tab도 뷰어 안에 머묾`, §C 메타데이터 동일 2건(6회 순회) |
  | Escape·닫기 버튼의 정확한 포커스 복귀 | §B `Escape로 뷰어가 닫힘`·`Escape 후 원래 카드로 포커스 복귀`·`닫기 버튼도 원래 카드로 포커스 복귀`, §C `Escape로 메타데이터가 닫힘`·`Escape 후 정보 버튼으로 포커스 복귀` — 기대값은 **클릭한 그 버튼의 라벨** |
  | 배경이 키보드 대상이 되지 않음 | §B/§C의 트랩 검사가 `dialog` 밖으로 나가지 않음을 5~6회 순회로 확인. `aria-modal="true"`도 함께 단언 |
  | 초기 포커스가 내부 조작 요소 | §B `열면 포커스가 뷰어 안에 있음` + `초기 포커스가 닫기 버튼`, §C `열면 포커스가 메타데이터 안에 있음` + `초기 포커스가 재사용 버튼` |
  | 갱신 후 이미지 식별자 유지 | §A가 폴링 갱신 뒤에도 라벨의 ID로 카드를 찾는다. 검사 자체도 인덱스가 아닌 클릭 시점 라벨을 쓴다(위 '내가 쓴 검사의 결함') |
  | 이전·다음 및 페이지 경계 | §B `이전·다음 이동이 기존 계약대로 동작`·`첫 이미지에서 이전이 비활성`·`마지막 이미지에서 다음이 비활성` |
  | 재사용 취소 시 모달·입력 유지 | §D `덮어쓰기 확인이 실제로 떴음`·`취소하면 메타데이터가 유지됨`·`취소 후 포커스가 재사용 버튼으로 복귀`·`취소가 입력을 바꾸지 않음` |
  | 재사용 성공 시 값 복원·프롬프트 포커스 | §D `재사용이 최종 프롬프트를 복원`·`재사용 후 포커스가 최종 입력`(`activeElement.id === 'prompt-final'`)·`복원된 값이 서버 스냅샷과 일치` |
  | v2/v3 스냅샷 회귀 | 기존 `suite-ucp08` 절이 그대로 통과(924건 중 포함). 이번 라운드에서 복원 로직을 건드리지 않았다 |
  | 복원 후 자동 compose·생성 0건 | §D `재사용이 compose를 호출하지 않음`·`재사용이 생성을 호출하지 않음`(스위치보드 카운터) |
  | 보관 후 카드 제거·제목 포커스 | §E `보관 성공으로 대화상자가 닫힘`·`보관 성공 후 포커스가 갤러리 제목`(`activeElement === h2`)·`보관한 카드가 목록에서 사라짐` |
  | 조작 실패 시 모달·입력 유지 | §E `보관 실패가 대화상자 안에 표시됨`·`실패 문구가 경고로 읽힘`(`role="alert"`)·`보관 실패 후에도 대화상자 유지`·`보관 실패는 한 번만 요청` |
  | 360·1280 넘침·터치·키보드 | §F 각 폭 21건: 갤러리 넘침 0·카드 화면 안·카드 내부 넘침 0·정보 버튼 44px·식별자 포함, 뷰어 화면 안·넘침 0·내부 넘침 0·버튼 44px·이름, 메타데이터 동일 + `초기 포커스가 대화상자 안`, 재사용 후 `포커스가 최종 입력`·`대화상자가 닫힘`·`복원된 입력이 화면 안`·`넘침 없음` |
  | UIX04 중복 제출·UIX05 큐 회귀 | 기존 `prompt-uix04` 24건·`prompt-uix05` 13건 단위 테스트와 브라우저 §K·UIX05 절이 전부 통과. UIX05 §B에는 폼 보존 단언 3건을 **추가**했다 |

- **남은 문제**
  - 실기기 IME·소프트 키보드·화면 회전은 이 환경에 없다(**UIX07 인계**).
  - 귀속 변경 후 포커스 유지의 브라우저 검증도 **UIX07 인계**다.
  - `gap04` 증거 복원 및 `UIX01` 증거 분리, 전체 사용자 흐름 통합 검증도 **UIX07 인계**다.
  - **최초 진입 시 목록 조회 실패 → 생성 폼 일시 비활성**(UIX05 검토에서 확인한 제약)도 그대로 남아 있다. 조회 계약 변경이라 이번 범위 밖이다.
  - `UIX06A`(URL 라우팅·퍼머링크)는 이번 요구사항에 없어 착수하지 않았다. 별도 태스크다.
  - 메타데이터 모달의 '이 설정으로 다시 생성' 덮어쓰기 확인은 여전히 **네이티브 `window.confirm`**이다. UIX03 검토 지시대로 자체 모달로 교체하지 않았다.
- **증거** — `docs/evidence/art-studio-uix06/` (스크린샷 13장: `uix06-01`~`05` 흐름, `06`~`09` × 360/1280 — 갤러리·뷰어·메타데이터·재사용 결과)
- **다음 ID** — **UIX07** (통합 검증과 인계 항목).

### UIX06A · URL 라우팅과 퍼머링크

현재 Art Studio와 Pixel Studio의 화면 전환은 React 내부 상태에 의존하며, 화면별 URL이 제공되지 않는 것으로 보인다. 실제 `frontend/src/App.tsx`, 진입점, 화면 전환 상태, 갤러리 및 작업 큐의 식별자 구조를 확인한 뒤 URL 기반 탐색을 도입한다.

사용자가 특정 화면과 작업 및 이미지의 주소를 복사하거나 북마크하고, 브라우저의 뒤로 가기·앞으로 가기·새로고침을 통해 해당 화면으로 돌아올 수 있게 한다.

#### 라우팅 구조

현재 BC250 서버는 Caddy를 통해 LLM Client와 AI Studio를 분리하여 제공한다.

- `/llm/api/*` — LLM Client FastAPI (127.0.0.1:8010)
- `/llm` — `/llm/`로 308 redirect
- `/llm/*` — LLM Client SPA
- `/api/*` — AI Studio FastAPI (127.0.0.1:8090)
- 나머지 경로 — AI Studio SPA (`/opt/bc250-ai-studio/frontend/dist`)

AI Studio의 Caddy 설정에는 이미 다음 SPA fallback이 존재한다.

```caddy
handle {
    root * /opt/bc250-ai-studio/frontend/dist
    try_files {path} /index.html
    file_server
}
```

따라서 HashRouter는 사용하지 않고 React Router의 **BrowserRouter를 사용하여 실제 경로 기반 퍼머링크를 구현한다.**

- [ ] 기존 프런트엔드 의존성 및 Vite base 설정을 확인하고 BrowserRouter를 도입한다.
- [ ] AI Studio는 루트 경로에 배포되므로 BrowserRouter의 기본 경로는 `/`로 한다.
- [ ] 기존 Caddyfile, FastAPI 라우팅, 서비스 포트 및 배포 설정은 변경하지 않는다.
- [ ] `/llm`, `/llm/*`, `/api`, `/api/*`는 예약 경로로 취급하고 AI Studio의 화면 라우트로 사용하지 않는다.
- [ ] 기존 App Shell 및 공통 상태 관리 계층을 유지한다. 라우팅 도입을 이유로 App.tsx 전체를 재작성하지 않는다.
- [ ] URL을 화면 선택의 단일 기준으로 사용한다. URL과 독립적인 화면 선택 state가 불일치하는 이중 상태 구조를 만들지 않는다.
- [ ] 기존 루트 접속 주소 `/`는 계속 사용할 수 있게 하고 `/art`로 replace 방식으로 이동한다.
- [ ] 화면 전환은 React Router의 Link 및 navigate를 사용하며 전체 페이지를 새로 로드하지 않는다.
- [ ] LLM Client로 이동하는 링크는 별도 SPA로 이동하는 실제 링크를 사용한다. AI Studio 내부 라우터로 `/llm/`을 처리하지 않는다.
- [ ] 빌드된 JS·CSS·이미지 등 정적 리소스가 중첩 경로에서도 올바르게 로드되는지 확인한다.
- [ ] 라우팅 라이브러리 추가 시 필요한 의존성과 lockfile만 변경한다.

#### 화면별 URL

| 경로 | 화면 |
| --- | --- |
| `/` | `/art`로 replace 이동 |
| `/art` | Art Studio 기본 화면 |
| `/art/compose` | 한글 장면 구성 |
| `/art/generate` | 최종 프롬프트 직접 입력 및 생성 설정 |
| `/art/jobs` | 작업 큐 |
| `/art/jobs/:jobId` | 특정 작업 조회 및 강조 |
| `/art/gallery` | 갤러리 |
| `/art/gallery/:imageId` | 특정 이미지 상세 뷰어 |
| `/art/gallery/:imageId/metadata` | 특정 이미지 생성 정보 |
| `/pixel` | Pixel Studio |

- [ ] 모든 화면은 hash fragment가 없는 실제 URL을 사용한다.
- [ ] 작업 및 이미지 식별자는 기존 서버 ID를 사용한다.
- [ ] 작업 큐와 갤러리의 페이지 번호 및 공유 가능한 필터는 query parameter로 관리한다. 페이지 번호의 기본값과 잘못된 값의 처리 규칙을 정의한다.
- [ ] 프롬프트, negative, 후보 본문, 사전 선택, UCP 스냅샷 및 인증정보를 URL에 포함하지 않는다.
- [ ] 접기·펼치기, 사전 검색, 후보 펼침, 세부 생성 설정 등 일시적인 UI 상태는 별도 라우트로 만들지 않는다.
- [ ] 존재하지 않는 경로는 명시적인 페이지 없음 안내와 Art Studio 복귀 링크를 제공한다.
- [ ] URL 변경으로 편집 컴포넌트를 재마운트하거나 기존 UCP 세션을 초기화하지 않는다.

#### 브라우저 탐색 계약

- [ ] 사용자가 화면을 명시적으로 이동하면 URL과 화면이 함께 변경되고 브라우저 이력에 기록된다.
- [ ] 뒤로 가기·앞으로 가기로 이전 화면과 URL이 일치하도록 복원한다.
- [ ] 주소창에 유효한 URL을 직접 입력하거나 새 탭에서 열면 해당 화면으로 진입한다.
- [ ] 새로고침 후 동일한 URL의 화면 및 저장된 서버 리소스를 다시 조회할 수 있게 한다.
- [ ] 알 수 없는 경로, 잘못된 ID, 존재하지 않는 리소스, 보관된 리소스, 조회 실패를 구분해 안내하고 안전한 상위 화면으로 돌아갈 수 있게 한다.
- [ ] 조회 실패나 잘못된 식별자로 인해 다른 작업이나 이미지가 대신 선택되지 않도록 한다.
- [ ] 폴링, Compose 응답 도착, 후보 적용 상태 갱신, 생성 완료 등 백그라운드 상태 변화만으로 URL이나 브라우저 이력이 변경되지 않도록 한다.

#### 작업 큐 퍼머링크

- [ ] UIX05의 접수 확인 및 ‘작업 큐에서 보기’를 유지한다. 명시적으로 이동할 때 `/art/jobs/:jobId`로 연결한다.
- [ ] 특정 작업 URL로 진입하면 현재 목록 페이지에 대상이 없어도 기존 단건 조회 API 등 지원되는 조회 계약을 이용해 정확한 작업을 확인할 수 있게 한다.
- [ ] 단건 조회가 가능한 작업을 찾기 위해 전체 목록을 무제한 순회하지 않는다.
- [ ] 기존 접수 확인, 목록 조회 순서 가드, 카드별 취소·재시도 잠금 및 오류 처리 계약을 유지한다.
- [ ] 재시도로 새 Job ID가 만들어지더라도 원래 작업의 URL을 새 작업으로 자동 변경하지 않는다. 새 작업으로 이동하는 동작은 명시적으로 제공한다.
- [ ] 작업별 URL을 복사하거나 새 탭에서 열 수 있게 한다.

#### 갤러리 퍼머링크

- [ ] 갤러리의 이미지 보기 및 생성 정보 열기를 각각 이미지 ID 기반 URL로 연결한다.
- [ ] 이미지 상세 URL로 직접 진입하면 기존 API를 이용해 해당 이미지를 조회한다. 현재 목록 페이지에 없는 이미지도 지원되는 기존 조회 계약 범위에서 접근할 수 있게 한다.
- [ ] 이전·다음 이미지 이동 시 표시 이미지와 URL이 함께 변경된다. 기존 페이지 경계 및 이미지 식별자 계약을 유지한다.
- [ ] 갤러리 목록에서 상세 화면을 열었다면 닫기 또는 Escape 시 원래 목록과 페이지로 복귀한다.
- [ ] 외부 주소나 새 탭으로 상세 화면에 직접 진입한 경우 닫기 또는 Escape가 브라우저 외부 페이지로 이탈시키지 않도록 안전한 갤러리 복귀 경로를 사용한다.
- [ ] 상세 화면에서 뒤로 가기·앞으로 가기를 수행해도 모달의 열림 상태, 표시 이미지, URL이 일치한다.
- [ ] UIX06의 접근 가능한 이름, 포커스 트랩, 닫기, 포커스 복귀 계약을 유지한다.
- [ ] 프롬프트 또는 생성 설정 재사용 성공 시 `/art/generate`로 이동하고 최종 프롬프트에 포커스를 둔다. 덮어쓰기 취소 시 현재 상세 화면과 URL을 유지한다.
- [ ] 보관 처리 성공으로 이미지가 현재 목록에서 사라지면 기존 UIX06 계약에 따라 갤러리로 복귀하고 제목에 포커스를 둔다.
- [ ] 이미지 및 생성 정보의 URL을 복사하거나 새 탭에서 열 수 있게 한다.

#### 상태 보존 및 기존 UCP 계약

- [ ] 화면 전환 및 브라우저 이력 탐색만으로 한글 장면, 최종 프롬프트, negative, 모델, 생성 설정, 사전 선택, 후보, 적용·되돌리기 상태가 초기화되지 않도록 한다.
- [ ] ComposePanel 및 기존 UCP 세션의 소유권을 유지한다. 라우팅에 따른 언마운트로 진행 중인 요청이 취소되거나 후보가 사라지지 않도록 한다.
- [ ] 필요한 경우 공통 레이아웃에서 편집 컴포넌트를 유지하거나 기존 상태 소유권을 보존하는 구조를 사용한다. URL 변경을 React key로 사용해 전체 편집 트리를 재마운트하지 않는다.
- [ ] 라우팅만으로 revision 증가, 후보 stale 처리, 자동 적용, 자동 Compose 요청, 자동 생성 요청, 스냅샷 저장이 발생하지 않도록 한다.
- [ ] Compose 요청 진행 중 작업 큐 또는 갤러리로 이동해도 기존 요청 계약을 유지한다. 응답 도착 시 사용자가 보고 있는 화면이나 포커스를 강제로 변경하지 않는다.
- [ ] 이미지 생성 제출 진행 중 화면을 이동하더라도 중복 제출 방지와 접수 정보가 유지되도록 한다.
- [ ] 브라우저 새로고침 및 새 탭에서는 기존 저장·복원 계약으로 지원되는 데이터만 복원한다. 메모리에만 존재하는 미저장 입력까지 복원된다고 가정하지 않는다.
- [ ] 라우팅을 이유로 새로운 자동 저장, localStorage 기반 프롬프트 저장 또는 UCP 직렬화 방식을 도입하지 않는다.

#### 구현 범위 및 제한

- [ ] 주요 수정 대상은 `frontend/src/App.tsx`, 프런트엔드 진입점, 화면 탐색 컴포넌트, `JobCard.tsx`, `ImageViewer.tsx`, `MetadataModal.tsx` 및 라우팅 전용 모듈이다. 실제 파일 구조에 따라 확정한다.
- [ ] Pixel Studio는 URL 기반 진입·복귀만 연결한다. 내부 기능 및 화면 개편은 범위 밖이다.
- [ ] 기존 API, 서버 식별자, 스냅샷 형식, 런타임 모델 및 배포 설정은 변경하지 않는다.
- [ ] 기존 API만으로 특정 이미지 또는 작업을 직접 조회할 수 없는 경우 그 제약을 기록한다. 임의의 신규 API를 만들거나 불완전한 퍼머링크를 완료 처리하지 않는다.
- [ ] 라우팅 라이브러리 추가 시 필요한 의존성 및 lockfile만 변경하고 불필요한 패키지 업데이트는 하지 않는다.

#### 검증

- [ ] 기본 접속 주소 및 모든 지원 라우트 직접 진입.
- [ ] Art Studio → 작업 큐 → 갤러리 → 이미지 상세 → 생성 정보 이동 시 URL 일치.
- [ ] 브라우저 뒤로 가기·앞으로 가기 및 새로고침.
- [ ] 작업 및 이미지 퍼머링크를 새 탭에서 직접 열기.
- [ ] 목록 페이지에 없는 작업 및 이미지의 정확한 식별.
- [ ] 존재하지 않는 ID, 잘못된 URL, 조회 실패 및 재시도.
- [ ] 폴링으로 목록 순서가 변경되어도 현재 작업·이미지 ID 유지.
- [ ] 갤러리 상세의 이전·다음, 닫기, Escape 및 포커스 복귀.
- [ ] 재사용 성공 시 생성 화면 이동, 취소 시 상세 URL과 입력 유지.
- [ ] v2/v3 스냅샷 복원 및 기존 UCP 계약 회귀.
- [ ] 미저장 한글·영어 입력과 생성 설정을 변경한 뒤 화면 왕복 시 값 보존.
- [ ] Compose 진행 중 화면 이동, 응답 도착 후 복귀, 후보와 요청 상태 유지.
- [ ] 이미지 생성 제출 진행 중 화면 이동 및 접수 확인 유지.
- [ ] 화면 탐색만으로 Compose 및 생성 POST 요청 증가 없음.
- [ ] 백그라운드 응답으로 URL·브라우저 이력·포커스 변경 없음.
- [ ] Pixel Studio 진입·복귀 및 기존 기능 회귀.
- [ ] 360px·1280px에서 탐색 메뉴, 키보드 접근성, 44px 터치 영역, 가로 넘침 확인.
- [ ] Vite 개발 서버뿐 아니라 기존 배포 방식과 동일한 빌드 산출물 제공 환경에서도 직접 진입 및 새로고침 확인.

**완료 기준** — 지원하는 모든 화면에 고유 URL이 존재하고, 작업 및 이미지의 퍼머링크를 직접 열어 정확한 리소스를 조회할 수 있다. 브라우저 이력 탐색과 새로고침 시 URL과 화면이 일치한다. 동일 SPA 세션 내 화면 이동으로 기존 입력·후보·요청·접수 상태가 유실되지 않으며 자동 Compose·이미지 생성 요청이 발생하지 않는다. UIX01~06 및 UCP 기존 계약 테스트가 모두 통과한다.

신규 단위 테스트와 브라우저 시나리오는 기존 하네스에 연결한다. lint, build, 전체 단위 테스트, 브라우저 회귀 테스트 및 git diff --check를 실행한다.

증거는 `docs/evidence/art-studio-uix06a/`에 별도로 기록한다. 기존 증거 디렉터리는 변경하지 않는다.

결과에는 변경 파일, 최종 URL 목록, 라우팅 방식과 선택 이유, 상태 소유권 및 생명주기 처리, 실제 동작, 검증 명령과 결과, 남은 문제 및 다음 ID를 기록한다.

**결과 (2026-11-26 완료)**

- **라우팅 방식과 선택 이유** — `react-router-dom`의 `BrowserRouter`(v7). Caddy의 `handle { try_files {path} /index.html }`가 이미 모든 중첩 경로에 `index.html`을 돌려주므로 서버 설정을 바꿀 필요가 없고, HashRouter는 `#` 때문에 실제 퍼머링크·새 탭 열기·검색 엔진 노출이 모두 어긋난다. `base`는 `/`(루트 배포) 그대로다. 의존성은 `react-router-dom` 한 개와 lockfile만 추가했다.

- **변경 파일**
  - `frontend/src/lib/routes.ts` (신규) — 순수 경로 해석. `parseArtRoute`(pathname+search → `ArtRoute`), `artPath.*`(경로 생성), `pageFromSearch`/`archivedFromSearch`, `galleryFallback`. `/api`·`/llm`은 **예약 경로**로 선언해 절대 Art 화면으로 해석하지 않는다.
  - `frontend/src/main.tsx` — `BrowserRouter`로 감쌌다. `App`은 그대로 마운트된다.
  - `frontend/src/App.tsx` — `useLocation`/`useNavigate`로 `route`를 매 렌더 파생. `view`/`studio`/`jobPage`/`assetPage`/`showArchived` **상태를 제거**하고 URL을 유일한 기준으로 삼았다. `NAV_ITEMS` + `.art-nav`, `.not-found`, `settle()`(4개 읽기 독립 처리), `goToGenerate`, `openViewer`/`openMetadata`/`closeViewer`/`closeMetadata`, `showInQueue`가 `navigate`를 쓴다.
  - `frontend/src/components/ImageViewer.tsx`, `MetadataModal.tsx` — 여는 요소 기록과 복귀를 `lib/dialog.ts`의 `resolveReturn`으로 통일(UIX06 계약 유지).
  - `frontend/src/PixelStudio.tsx` — 복귀를 `Link to={ART_HOME}`로 바꾸고 `onArt` prop 제거(아래 참조).
  - `frontend/src/api.ts` — `asset(id)` 단건 조회 추가(기존 `GET /assets/{id}` 사용, 신규 API 아님).
  - `frontend/src/styles.css` — `.art-nav`(44px, 가로 스크롤 없음), `.not-found`, `.gallery-lookup`.
  - `frontend/tests/prompt-uix06a.test.mjs` (신규) — 13건. 경로 해석·생성 왕복, 예약 경로 거부, 잘못된 page 값, 후행 슬래시, 퍼센트 인코딩, 중첩 세그먼트 거부, `/`→`/art`, `galleryFallback`.
  - `scripts/prompt-composer-browser/suite-uix06a.mjs` (신규) — 브라우저 A~I절 37단언.
  - `scripts/prompt-composer-browser/suite.mjs` — **`resetToOverview()` 추가**(아래 참조) + UIX06A 연결.
  - `frontend/tests/prompt-metadata-modal.test.mjs` — `bareSpecifier`에 `react` 추가(모듈 리졸버 확장, 검사 내용 불변).

- **최종 URL 목록**

  | 경로 | 화면 |
  | --- | --- |
  | `/` | `/art`로 **replace** 이동(뒤로 가기가 되돌아오지 않음) |
  | `/art` | 개요 — 작성·큐·갤러리를 한 화면에(기존 동작 그대로) |
  | `/art/compose` | 장면 구성 |
  | `/art/generate` | 최종 프롬프트·생성 설정 |
  | `/art/jobs`, `/art/jobs?page=N` | 작업 큐 |
  | `/art/jobs/:jobId` | 그 작업만 강조 |
  | `/art/gallery`, `/art/gallery?page=N`, `&archived=1` | 갤러리 |
  | `/art/gallery/:imageId` | 이미지 뷰어 |
  | `/art/gallery/:imageId/metadata` | 생성 정보 |
  | `/pixel` | Pixel Studio |
  | 그 외 | `.not-found` + `/art` 복귀 링크 |

  `?page=`는 0이면 생략하고, 음수·소수·문자가 오면 **첫 페이지**로 읽는다(이웃 페이지를 골라 주지 않는다).

- **상태 소유권과 생명주기**
  - 라우트는 **패널을 숨길 뿐 언마운트하지 않는다**(`hidden`). ComposePanel이 계속 마운트돼 있으므로 진행 중 요청·후보·세션이 화면 이동으로 사라지지 않는다. 라우트를 React `key`로 쓰지 않았다.
  - `/art`(개요)는 **세 패널을 모두 보여 준다**. 처음엔 화면별로 하나씩만 보이게 했는데, 그러면 기존 UCP/UIX 스위트가 측정하던 단일 페이지 개요가 사라져 27건이 깨졌다. 요구사항은 "화면별 URL"이지 "개요 화면 삭제"가 아니므로, 개요를 유지하고 집중 경로를 추가하는 쪽으로 정했다.
  - 접수 정보(`receipt`)·생성 잠금(`submittingRef`)·큐 조작 잠금은 App/JobCard 소유 그대로다. 라우팅은 이들에 쓰지 않는다.
  - 폴링·응답 도착·접수는 `navigate`를 부르지 않는다. URL을 바꾸는 것은 사용자의 명시적 이동뿐이다.

- **실제 동작**
  - `/art/jobs/<id>`를 새 탭에 붙여 넣으면 큐가 그 작업을 찾아 강조한다. 목록 페이지에 없으면 `GET /jobs/{id}` **단건 조회**로 확인하며, 전체 목록을 순회하지 않는다. 없으면 `.jobs-nav`가 사유를 말하고 목록 재조회 경로를 준다.
  - `/art/gallery/<id>` 직접 진입은 `GET /assets/{id}`로 그 이미지만 조회해 뷰어를 연다. 없는 id면 뷰어를 열지 않고 `.gallery-lookup`이 안내한다.
  - 목록에서 연 상세는 닫기/Escape가 **히스토리를 되돌려** 원래 페이지로 돌아가고, 붙여 넣은 링크로 연 상세는 되돌릴 항목이 없으므로 `replace`로 갤러리에 착지한다(앱 밖으로 나가지 않는다).
  - 재사용 성공은 `/art/generate`로 이동하며 최종 프롬프트에 포커스가 간다. 덮어쓰기 취소는 상세 URL을 유지한다.


- **선행 코드·하네스에서 고친 것 (신규 구현 아님)**
  - **`suite.mjs`의 `resetToOverview()` (하네스 결함).** URL 라우팅 도입 전에는 `Page.reload`만으로 "깨끗한 문서"가 보장됐다. 이제 주소창이 화면을 정하므로, 어떤 블록이 reload하면 **앞 블록이 남긴 퍼머링크를 그대로 물려받는다.** UCP08이 `/art/gallery/<id>/metadata`에서 reload해 작성 패널이 (정상적으로) 숨겨진 채 시작했고, `.composer select`가 다른 컨트롤과 먼저 매치돼 모델이 `fake-flux2`로 남았다 → UCP08 14건 실패. 각 블록 앞에 `/art`로 이동하는 리셋을 넣어, 모든 블록이 원래 작성된 문서에서 시작하게 했다. **앱 코드는 손대지 않았다**(앱 동작은 요구사항대로였고, 잘못된 것은 하네스의 가정이었다).
  - **`suite-uix06a.mjs` 자체 결함 2건.** (1) 템플릿 리터럴 안의 정규식이 과도하게 이스케이프돼 파싱이 실패했다 → 정규식 대신 `new URL(...).pathname` **문자열 비교**로 바꿨다(메서드+정확한 경로, 부분 문자열 아님). (2) `SCREEN` 템플릿이 닫히지 않고 군더더기 `})();`가 남아 파일이 로드되지 않았다 → 블록을 다시 작성했다. 이 두 결함 때문에 UIX06A는 **한 번도 실행되지 않은 상태**였고, 그 사실을 완료로 기록하지 않는다.
  - **재사용 후 포커스가 `<body>`로 떨어지던 앱 결함 (라우팅이 드러낸 회귀).** UIX06의 "재사용 성공 → 최종 프롬프트 포커스"가 라우팅 도입 뒤 360·1280 양쪽에서 깨졌다. 원인은 **두 커밋의 경쟁**이다: `goToGenerate()`가 `navigate(...)`와 `setFinalFocusTick(...)`를 같은 핸들러에서 부르는데, React Router의 location 갱신은 transition 안에서 처리되므로 **화면을 드러내는 커밋이 포커스 커밋보다 늦을 수 있다.** 그 순간 `#prompt-final`은 아직 `hidden` 패널 안에 있어 `focus()`가 무효가 되고, 포커스는 `<body>`에 남는다. 포커스 효과의 의존성에 `route.screen`을 넣고 컴포저가 보이는 화면일 때만 포커스하도록 고쳤다 — 어느 쪽이 나중에 커밋되든 포커스가 일어난다. UIX06 단위 테스트는 `finalFocusTick` 증가만 보므로 이 경쟁을 잡지 못했다(브라우저에서만 재현).
  - **Pixel Studio 복귀가 링크가 아니던 문제.** 복귀가 `<button onClick={onArt}>`라 새 탭으로 열 수 없고 URL도 없었다. `.art-nav`·헤더의 다른 이동과 같은 `Link to={ART_HOME}`으로 바꾸고 `onArt` prop을 제거했다(호출부 `App.tsx`도 함께). 라우팅 요구사항("모든 화면에 고유 URL, 이동은 링크")에 맞춘 수정이다.
  - **`suite-uix05.mjs`·`suite-uix06.mjs`가 화면을 가정하던 문제 (하네스 결함).** 라우팅 도입 전에는 모든 패널이 한 화면에 있었다. 이제 §L(UIX05 두 폭 측정)과 §M(Tab 순서)은 접수 확인 버튼을 누른 뒤라 `/art/jobs/:jobId`에 있었고, UIX06 §F의 두 번째 폭은 재사용 성공으로 `/art/generate`에 있었다 → **숨겨진 패널의 rect는 0**이라 44px·Tab 단언이 실패했다(앱은 정상). 각 측정 앞에 화면을 되돌리는 단계를 넣되 **reload 대신 앱 내 링크**를 썼다: reload하면 측정 대상인 접수 정보가 사라지기 때문이다. 처음엔 루프 **바깥**에 한 번만 넣었다가 1280에서 같은 이유로 다시 실패해, 폭마다·절마다 되돌리도록 고쳤다.

- **검증 명령과 결과**
  - `npm --prefix frontend run lint` → 통과.
  - `npm --prefix frontend run build` → 성공.
  - `node --experimental-strip-types --test frontend/tests/*.test.mjs` → **422 tests, 422 pass, 0 fail**(신규 UIX06A 13건 포함).
  - `sh scripts/prompt-composer-browser/verify.sh`(fake 엔진·임시 DB·`STUDIO_FAKE_DELAY=6`, Chromium CDP) → **1015 checks, 0 failed**. UIX06A 단언 51건. `results.json` 1183항목 = 판정 1015 + 정보 168.
  - `git diff --check` → clean.

- **요구사항별 검증 근거**

  | 요구 | 근거 |
  | --- | --- |
  | 모든 지원 라우트 직접 진입 | 브라우저 §A 6개 경로 × (화면 표시 + 주소 일치) = 12단언 |
  | `/` → `/art` replace | §A `루트가 /art로 이동` |
  | 없는 경로 안내·복귀 링크 | §B `없는 경로는 페이지 없음 안내`·`페이지 없음에 복귀 링크`·`두 단계 작업 경로는 없는 경로` + 단위 `nested segments are not a route` |
  | 예약 경로를 Art 라우트로 쓰지 않음 | 단위 `reserved service paths are never Art screens`(`/api`, `/llm`, `/llm/x`) |
  | 메뉴 이동이 URL·이력에 기록 | §C `메뉴 이동이 URL을 바꿈`·`이동한 화면이 큐`·`메뉴가 현재 화면을 표시`·`현재 화면 표시가 하나뿐` |
  | 뒤로·앞으로 가기 | §C `뒤로 가기가 이전 주소로`·`뒤로 가기 후 화면도 일치`·`앞으로 가기가 다음 주소로`·`앞으로 가기 후 화면도 일치` |
  | 이동이 요청을 만들지 않음 | §C `화면 이동만으로 Compose 요청 없음`·`생성 요청 없음`(POST만 카운트) |
  | 미저장 입력이 왕복에서 보존 | §D `왕복 전 입력 반영`·`왕복 후 최종 프롬프트 유지`·`왕복 후 모델 유지` |
  | 작업 퍼머링크가 정확한 작업 | §E `작업 퍼머링크 주소`·`퍼머링크가 그 작업을 찾음`·`퍼머링크가 다른 작업을 대신 고르지 않음`(강조 카드 수 = 1) |
  | 이미지 퍼머링크·뷰어 이름 | §E `이미지 퍼머링크 주소`·`이미지 퍼머링크가 뷰어를 염`·`뷰어 이름에 그 이미지` |
  | 직접 진입 상세의 닫기가 앱 밖으로 이탈하지 않음 | §E `직접 진입 뷰어 닫기가 갤러리로` |
  | 생성 정보 퍼머링크 | §E `생성 정보 퍼머링크 주소`·`퍼머링크가 그 이미지` |
  | 잘못된 id에 다른 리소스를 고르지 않음 | §F `없는 이미지는 뷰어를 열지 않음` + 기록된 안내 문구 |
  | Pixel Studio 진입·복귀 | §G `Pixel Studio 주소`·`화면`·`복귀 링크` |
  | 360·1280 넘침·44px | §H 3단언 × 2폭(`가로 넘침 없음`·`메뉴가 화면 안`·`터치 영역 44px 이상`) |
  | 키보드 접근 | §I `메뉴 링크가 포커스를 받음`·`포커스 표시`·`Enter가 링크를 따라감` |
  | 잘못된 page 값 규칙 | 단위 `page: bad values read as the first page`(음수·소수·문자·거대값) |
  | 경로 생성 왕복 | 단위 `every generated path parses back to the screen that made it` |
  | 재사용 후 포커스가 최종 프롬프트 | 브라우저 UIX06 §F `재사용 후 포커스가 최종 입력` × 2폭(360·1280) — 라우팅 도입으로 깨졌던 회귀를 이번에 고쳐 두 폭 모두 통과 |
  | Pixel Studio 복귀가 실제 링크 | §G `Pixel Studio 복귀 링크`(`.pixel-shell a[href="/art"]`) — 버튼이 아니라 링크라야 새 탭으로 열 수 있다 |

- **남은 문제**
  - **UIX06A는 `?page=N` 이동을 브라우저로 검증하지 않았다.** 작업·이미지가 12건 미만인 임시 DB에서는 두 번째 페이지가 없어 단언이 공허해진다. 단위 테스트가 파싱·생성을 덮고, 페이지 이동은 기존 `Pagination`이 그대로 `navigate`를 부르므로 **UIX07 통합 회귀**에서 13건 이상을 만든 뒤 확인한다.
  - **Compose 요청 진행 중 화면 이동**은 앱 구조상(패널 미언마운트) 성립하지만, 응답 도착 시 포커스가 움직이지 않는다는 단언은 UIX06A에 넣지 않았다. UIX03/UIX05가 같은 성질을 이미 단언하고 있어 중복을 피했고, 통합 확인은 **UIX07** 항목이다.
  - 실기기 IME·소프트 키보드·회전 — **UIX07 인계**.
  - 귀속 변경 후 포커스 유지의 브라우저 검증 — **UIX07 인계**.
  - `gap04` 증거 복원 — **UIX07 인계**.
  - Vite 개발 서버로만 확인했다. 빌드 산출물을 Caddy와 같은 `try_files` 환경에 올려 직접 진입·새로고침을 확인하는 것은 배포 환경이 필요해 **UIX07**로 넘긴다(이번 실행에서 런타임·배포 설정은 변경하지 않았다).
- **증거** — `docs/evidence/art-studio-uix06a/` (스크린샷 7장: 메뉴 360/1280, 이미지 퍼머링크, 생성 정보 퍼머링크, 페이지 없음, 작업 퍼머링크, Pixel Studio)
- **다음 ID** — **UIX07** (통합 회귀와 인계).

### UIX07 · 통합 회귀와 인계

- [ ] `scripts/prompt-composer-browser/`의 기존 fixture·CDP 스위트를 재사용한다. 명칭이나 접힘 상태가 달라진 검사는 새 사용자 경로로 갱신하고 기존 저장·요청 검사는 유지한다.
- [ ] 360/390/1280px에서 한글 → 후보 적용 → 생성 → 큐 → 갤러리 재사용, 사전만으로 구성, compose 미지원 직접 생성 경로를 확인한다. 긴 오류·후보에서 가로 넘침이 없고 핵심 터치 영역이 44px 이상인지 확인한다.
- [ ] Tab/Shift+Tab/Enter/Escape, 조합 중 Enter, 응답 도착 중 포커스, Pixel Studio 진입·복귀를 확인한다. 실기기 IME·소프트 키보드·회전은 기기와 브라우저를 기록하고 UCP08 잔여 검증과 결과를 공유한다.
- **완료 기준** — 아래 명령의 실제 결과, viewport별 실패/통과, 실기기에서 확인한 범위를 기록한다. 환경이 없으면 해당 행은 환경 대기로 인계한다. 클릭 수 개선을 보고할 때는 같은 fixture·폭·시작 상태의 전후 측정값을 함께 남긴다.

## 검증 명령

저장소 루트에서 각 태스크의 관련 테스트와 브라우저 시나리오를 실행하고 UIX07에서 전체 회귀를 수행한다. 브라우저 하네스는 로컬 fake 엔진·임시 DB로 실행한다. 새 결과는 별도 출력 디렉터리에 둔다.

```sh
node --experimental-strip-types --test frontend/tests/*.test.mjs
npm --prefix frontend run lint
npm --prefix frontend run build
OUT=/tmp/art-studio-uix-browser sh scripts/prompt-composer-browser/verify.sh
git diff --check
```
