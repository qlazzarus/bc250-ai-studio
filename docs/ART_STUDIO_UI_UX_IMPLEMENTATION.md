# Art Studio UI/UX 개선 실행 계획

2026-11-24 · 구현 담당 `deepseek-v4.1-flash` · 다음 태스크 **UIX03**

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
| UIX03 | 긴 영어 후보를 비교하고 적용 결과 확인 | UIX01 | 대기 |
| UIX04 | 기본 설정으로 생성하고 막힌 입력으로 이동 | UIX01 | 대기 |
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
  - **작업 트리에 UIX03 선행 코드가 일부 들어와 있다.** 이번 실행 지시는 “UIX02만 수행”이지만, UIX01 후속 항목 1(“접힌 Compose 영역의 상태를 UIX03에서 읽기 전용으로 표시”)을 확인하려고 `onStatusChange`/`ComposeStatusView`(ComposePanel), `composeStatus`·`composeStrip`(App), `.compose-strip`(styles)을 작성했다. `suite-uix03.mjs`(494줄)는 어디에서도 import되지 않는 미연결 상태이며 UIX03 절은 아직 `[ ]`다. 즉 UIX03은 **완료가 아니라 착수 전 상태**이고, UIX02의 검증·기록은 이 코드와 무관하게 558검사 0실패로 통과했다. 다음 실행에서 UIX03을 진행할 때 이 코드를 이어 쓰거나, 지시대로 UIX02만 남기려면 해당 부분을 되돌리면 된다. 어느 쪽이든 UIX02 계약(칩 ID·revision·직렬화)은 건드리지 않았다.
  - `docs/evidence/prompt-composer-gap04/results.json`은 UIX01 커밋(`782ee4d`)에서 재생성되며 334→581 항목으로 덮였다. UIX01 이전 원본은 `b672935`에서 그대로 복구 가능하다(`git show b672935:docs/evidence/prompt-composer-gap04/results.json`, 334항목 확인). 스크린샷 79개도 전부 추적 상태로 남아 있다.
  - `:has()` 기반 다인 그룹 세로 배치는 Chromium/Safari/Firefox 최신에서 동작하지만, 구형 브라우저에서는 그룹이 가로로 흐를 뿐 판독에는 지장이 없다.
  - 실기기 IME·소프트 키보드는 이 환경에 없어 확인하지 못했다(UIX07 인계).
- **다음 ID** — **UIX03** (긴 영어 후보를 비교하고 적용 결과 확인). 선행 UIX01이 완료되어 대기 조건이 충족됐다.

### UIX03 · 후보 비교와 적용

ComposePanel은 각 후보의 영문 전체, 차이, negative, 보존 내용, 적용 영향과 버튼을 세로로 반복한다. 긴 후보 세 개에서도 다음 대안과 적용할 후보를 쉽게 찾게 한다.

- [ ] 후보 제목·한국어 차이·적용 상태를 먼저 보여 준다. 첫 후보 본문은 펼치고 대안 본문은 개별적으로 펼쳐 동시에 비교할 수 있게 한다. 본문과 적용 동작을 같은 카드에 둔다.
- [ ] 최종 입력 교체 여부, negative 유지·교체·빠짐 안내는 적용 직전에 보이게 한다. 기존 stale 처리, 덮어쓰기 확인, 되돌리기 및 명시적 ‘결과로 이동’을 재사용한다.
- **완료 기준** — 긴 후보 세 개 중 두 번째를 펼쳐 적용하면 그 후보의 문자열과 상태가 일치한다. 직접 수정 후 적용 취소·되돌리기, negative 미지원 확인, 원문 수정 뒤 이전 후보 적용 방지를 검증한다. 응답 도착이나 카드 펼침만으로 최종 입력이 바뀌지 않는다.

### UIX04 · 생성 설정과 제출 오류

`App.tsx`의 생성 폼은 해상도·수량 뒤에 Steps·CFG·Seed와 고정 옵션을 모두 표시한다. Seed 검사는 submit에서 전역 오류로 반환한다.

- [ ] 프리셋·해상도·수량·생성 버튼은 기본 경로에 둔다. Steps·CFG·Seed와 sampler/scheduler 설명은 ‘세부 생성 설정’에 묶고 선택된 값의 요약을 표시한다. Negative 사용 조건은 해당 입력 옆에 유지한다.
- [ ] 생성이 막히면 버튼 근처에 첫 원인과 수정할 필드로의 이동을 제공한다. 접힌 설정의 오류로 이동하면 먼저 펼친다. 기존 제출 검사와 모델별 허용 조건을 재사용한다.
- **완료 기준** — 기본 생성 및 세부 설정 변경 후 생성에서 요청 본문의 프리셋 관련 값·seed·수량이 기존 계약과 일치한다. 빈 최종 입력, 잘못된 seed, CFG에 따른 negative 제한을 각각 확인하고 수정 뒤 제출한다. 펼침만으로 설정이 초기화되지 않는다.

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
