# Art Studio UI/UX 개선 실행 계획

2026-11-24 · 구현 담당 `deepseek-v4.1-flash` · 다음 태스크 **UIX05**

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
| UIX05 | 접수한 작업 추적과 실패한 작업 재시도 | UIX04 | 대기 |
| UIX06 | 갤러리에서 결과 확인 후 원래 위치로 복귀 | UIX01 | 대기 |
| UIX07 | 모바일·키보드·과거 결과 복원 회귀 검증 | UIX02~06 | 대기 |

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

- [ ] 접수 응답의 작업 식별자를 생성 버튼 옆에 표시하고 ‘작업 큐에서 보기’를 제공한다. 사용자가 누르면 접힌 큐를 열고 첫 페이지를 갱신해 해당 카드를 찾는다. 목록 갱신 전에도 접수 성공 안내를 유지한다.
- [ ] 카드 상태를 한국어로 표시하고 API 상태값에 따른 기존 행동을 유지한다. 취소·재시도 중에는 같은 작업의 중복 클릭을 막고 실패 이유를 해당 카드에 표시한다.
- **완료 기준** — 큐가 접혔거나 다른 페이지인 상태에서 접수해 정확한 작업을 찾는다. 접수 실패 시 입력이 유지되고 성공 안내가 뜨지 않는다. 실패 작업 재시도를 연속 클릭해도 요청 한 건이며, API 오류 뒤 재조작이 가능하다.

### UIX06 · 갤러리와 상세 화면 복귀

`App.tsx` 갤러리 카드가 반복해서 ‘이미지 보기’와 ‘정보’를 제공한다. `frontend/src/components/ImageViewer.tsx`와 `MetadataModal.tsx`는 각각 별도 대화상자다.

- [ ] 보기·정보 버튼의 접근 가능한 이름에 카드 식별 정보를 포함한다. 대화상자를 열면 내부에 초점을 두고 Tab 순환·Escape 닫기·원래 버튼으로 복귀를 두 화면에서 일관되게 처리한다.
- [ ] ‘이 설정으로 다시 생성’이 성공하면 복원된 최종 입력으로 안내한다. 덮어쓰기 취소 시 상세 화면을 유지한다. 보관 이동으로 원래 카드가 사라지면 갤러리 제목으로 초점을 돌린다.
- **완료 기준** — 키보드로 두 번째 카드의 보기와 정보를 각각 열어 닫고 초점 복귀를 확인한다. 뷰어의 이전·다음 및 페이지 경계 이동을 유지한다. v2/v3 재사용 후 최종 문자열과 기록이 복원되고 자동 compose·이미지 생성 요청이 없다.

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
