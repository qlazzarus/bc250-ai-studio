# RULE01·RULE02·METRIC01 구현 인계

> 2026-11-18 보관본. 활성 상태는 [단일 실행 태스크](../../../PROMPT_COMPOSER_EXECUTION_TASKS.md)를 따른다. 완료 표시는 당시 로컬 검증 범위에 한정하며 실제 LLM·GPU 품질 검증을 뜻하지 않는다.

이 파일은 활성 문서의 RULE01, RULE02, METRIC01 절을 **내용 변경 없이** 옮긴 것이다. 세 태스크 모두 "구현 완료(로컬 검증)"였고 남은 관찰 항목은 각 절의 미완료·위험 블록에 그대로 있다.

- RULE01: 부정·복수 판정으로 단수 인물 오탐 3건을 0건으로 만들었다. 남은 갭(활용형·별칭 누락)은 RULE03이다.
- RULE02: 규칙 제안 경로도 `target_groups` 범위를 지키게 했다. 남은 갭(사전 밖 상황의 부분 반영 안내)은 VAR03이다.
- METRIC01: precision의 분모에서 미분류를 뺐다. 100%(29/29)는 판정 가능한 항목에서만 성립한다.

---

### RULE01 — 부정·다인 표현의 규칙 오탐 보완 · 구현 완료

- 근거: `frontend/src/prompt/proposals.ts`의 `text.includes`는 `사람은 없다`와 `사람들`에도 단수 인물을 제안한다. [기준선 보고](PROMPT_COMPOSER_EVAL_UX01.md) 사례 1–3.
- 수정: proposals 및 대응 테스트, 필요시 순수 매칭 helper. 사전/컴파일러/Scene 저장 계약 변경 없음.
- 실행: 부정·복수 경계를 판정하는 최소 규칙과 모호할 때 제안 보류를 설계. 같은 문장에 긍정·부정이 섞이면 문장 전체 일괄 삭제 금지. 예: `사람은 없고 고양이는 있다`, `안경 없이 웃는 사람`, `사람 둘이 걷는다`.
- 완료: 기대 ID/금지 ID를 먼저 정의하고 양성·부정·다인 및 혼합 문장 테스트. 원문은 그대로, 불명확한 인물 귀속을 추정하지 않음. F·B, 기존 평가를 다시 계산해 변화와 남은 실패 기록.

```text
ID / 상태 / 날짜 / 기준 HEAD: RULE01 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  신규 frontend/src/prompt/matching.ts, frontend/src/prompt/proposals.ts,
  frontend/tests/prompt-proposals.test.mjs, frontend/tests/prompt-eval-ux01.test.mjs,
  scripts/eval-ux01/evaluate.mjs + docs/evidence/prompt-composer-eval-ux01/*.
  사용자 동작: `사람은 없다`·`사람들`·`두 사람` 문장에서 단수 인물이 더 이상 제안되지 않고,
  문장에 긍정 절이 남아 있으면 그 항목은 그대로 제안된다. 목록 수는 사례 1–3에서 줄어든다.
보존한 계약: 사전 ID/버전(1.2.0)·컴파일러 출력·Scene v1 저장 의미·원문 보존. 새 저장 필드 없음.
  불명확한 인물 귀속은 추정하지 않고, 사전이 제공하는 `subject.two_people`/`subject.group`만 지목한다.
실행한 명령과 결과:
  node --experimental-strip-types --test frontend/tests/*.test.mjs → 131/131 통과
  npm --prefix frontend run build → 통과 · npm --prefix frontend run lint → 통과(경고 0)
  node --experimental-strip-types scripts/eval-ux01/evaluate.mjs → 38 기대 / 29 적중(recall 76.3%) /
  원치 않은 추가 3→0 / 미분류 1
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  HeadlessChrome(chromium-1228), 1280×900. 12장면 브라우저 팔 재실행에서 제안 목록·칩·초안이
  Node 팔과 일치(8/8 검사 통과, 클릭 43). 캡처: docs/evidence/prompt-composer-eval-ux01/.
미완료·위험·다음 태스크가 알아야 할 사실:
  RULE01은 부분일치 오탐만 다룬다. `앉은`/`서 있다`/`흰 배경` 같은 활용형·별칭 누락은 RULE03이다.
  부정 판정은 절 단위 어휘 휴리스틱이며 문장 의미 이해가 아니다(예: `글자 없이`는 여전히 미표현).
  남은 미분류 1건은 `portrait-front-closeup`의 `subject.person`으로, 사람이 판정할 항목이라
  precision 분모에서 제외한다(테스트 통과를 위해 정답으로 바꾸지 않음).
  후속 보완: 복수/수 항목이 이미 선택된 상태에서도 단수가 되살아나지 않도록 판정 대상은
  '추가 가능한 항목'이 아니라 '활성 사전 전체'로 두고, 대상이 선택돼 있으면 제안을 생략한다
  (테스트 1건 추가, 총 131건).
```

### RULE02 — 규칙 제안에서도 부분 변경 범위 보존 · 구현 완료

- 선행: RULE01. 근거: 규칙 suggestSelections 요청에는 target_groups가 없어 `조명만` 경로에서 카페가 추가되는 기준선 사례 8. AI partial_change의 범위 검증과 다름.
- 수정: proposals/PromptBuilder의 규칙 요청·수락 연결과 테스트. 현재 부분 변경 UI 상태를 재사용하고 새 저장 필드 금지.
- 실행: 부분 변경 모드의 선택 그룹·잠금값을 규칙 후보와 수락 시점에 적용. 전체 장면 모드에서는 기존 탐색 범위를 유지. 모드가 다르면 문구로 알림.
- 완료: lighting만 허용 시 카페 추가 불가, 대상/의상 보존, 모드 전환·오래된 후보 방어. 기존 AI 경로 동일성, F·B 및 텍스트 상태 관찰표.

```text
ID / 상태 / 날짜 / 기준 HEAD: RULE02 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  frontend/src/prompt/proposals.ts(SuggestionReport, ProposalRequest.targetGroups),
  frontend/src/components/PromptBuilder.tsx(범위 메모·보류 안내), frontend/src/styles.css
  (.prompt-proposal-list__scope), frontend/tests/prompt-proposals.test.mjs,
  scripts/eval-ux01/evaluate.mjs, scripts/prompt-composer-browser/suite-contracts.mjs.
  사용자 동작: 부분 변경 범위를 고른 상태에서 `원문에서 사전 항목 찾기`를 열면 목록이 그 범위만
  제안하고, 보류한 항목의 개수·이름을 한 줄로 알린다. 범위 때문에 비었을 때도 그 사실을 말한다.
보존한 계약: Scene v1·저장 필드·AI partial_change 요청/검증 경로·locked_ids 의미.
  규칙 수락은 기존 `selectEntry` 경로 그대로이고, 범위는 UI 상태에서만 파생한다(새 저장 없음).
실행한 명령과 결과:
  frontend/tests 전체 131/131 · node --experimental-strip-types --test frontend/tests/prompt-proposals.test.mjs 14/14
  sh scripts/prompt-composer-browser/verify.sh → 225/225 통과(신규 RULE02 7건: 데스크톱 4 + 360px 3 포함)
  evaluate.mjs 부분 변경 팔: 범위 안 제안 1개(lighting.low_key) · 범위 밖 보류 1개(setting.cafe)
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  배경만 변경 상태에서 목록 캡션 `“배경만 변경” 범위라 1개 제안(네온 조명)을 목록에서 뺐습니다.`
  와 빈 목록 문구를 DOM으로 확인(캡처 25b-rule-scope-notice.png). 360×740에서도 같은 줄이
  288px 폭 안에서 36px 높이로 줄바꿈되고 문서 가로 넘침이 없음을 rect로 측정
  (25c-rule-scope-360.png). 390px은 미측정.
미완료·위험·다음 태스크가 알아야 할 사실:
  범위 판정은 그룹 단위다. 같은 그룹 안에서 잠긴 개별 항목은 "이미 선택됨"으로 빠질 뿐 별도
  사유를 말하지 않는다. 평가 하네스는 여전히 `카페`를 카드 계층으로도 흘려 defensive
  `out_of_scope` 차단을 계속 측정한다 — 규칙 경로 누출 증거가 아니다.
```

### METRIC01 — 평가 지표의 명칭·분모 정정 · 구현 완료

- 근거: `scripts/eval-ux01/evaluate.mjs:242`는 `(proposed-unwanted)/proposed`를 precision으로 부르며 미분류 2개도 정답 취급한다. 31/34는 확인된 정밀도가 아님. 기존 80클릭은 계산 모델이고 43클릭은 누락 보정 없는 자동 UI 경로다.
- 수정: evaluate/scenes 평가 판정 및 대응 테스트·현재 결과 자료. 과거 archive 수치는 그대로 보존.
- 실행: 미분류를 추가 판정하거나 판정 가능 항목의 정밀도와 미분류 비율을 분리. 미분류 포함 수치는 상한 또는 비금지 제안 비율로 명명. 모델 클릭 비용·실제 UI 클릭·사람 소요 시간 분리.
- 완료: 분자/분모 예시와 계산 테스트, 12장면 재계산. 테스트 통과용으로 오탐을 정답으로 바꾸지 않음. 아직 측정하지 않은 사용자 효율을 성공으로 표시하지 않음.

```text
ID / 상태 / 날짜 / 기준 HEAD: METRIC01 / 구현 완료(로컬 검증) / 2026-11-18 / 03a2fa5 이후 작업 트리
변경 파일과 사용자에게 달라지는 동작:
  scripts/eval-ux01/evaluate.mjs, frontend/tests/prompt-eval-ux01.test.mjs,
  docs/evidence/prompt-composer-eval-ux01/{results.json,summary.txt,browser.json,browser-results.json}.
  화면 동작은 바뀌지 않는다. 바뀌는 것은 보고 이름과 분모다.
보존한 계약: 제품 코드·사전·컴파일러·Scene 계약·fixture 기대값. archive 수치는 수정하지 않았다.
  계산 테스트는 기대값을 결과에 맞춰 고치지 않고, 판정 불가 항목을 분모에서 빼는 방식만 검증한다.
실행한 명령과 결과:
  지표 이름: precision(분자 적중, 분모 판정 가능 제안 = 제안 − 미분류), nonForbiddenShare(상한),
  unclassifiedRate. 제거: precisionDecided.
  현재 값: precision 100.0%(29/29) · 비금지 제안 비율 100.0%(30개 중 1개 미분류) ·
  미분류 3.3% · 원치 않은 추가 0 · recall 76.3%. 부분 변경 팔의 보류/제안 개수도 함께 집계한다.
  node --experimental-strip-types --test frontend/tests/prompt-eval-ux01.test.mjs → 통과
  sh scripts/eval-ux01/browser.sh → 8/8 통과, 클릭 43(자동 UI 경로)
텍스트 화면 묘사·브라우저 환경·DOM/포커스 관찰:
  요약 출력 문장 2줄(`규칙 경로 precision …`, `미분류 … 상한은 비금지 제안 비율 …`)을
  summary.txt로 확인. 브라우저 팔은 12장면 DOM에서 제안·칩·초안을 다시 읽어 Node 팔과 대조했다.
미완료·위험·다음 태스크가 알아야 할 사실:
  precision 100%는 "판정 가능한 29개"에서만 성립한다. 미분류 1건은 사람 판정 대기이고,
  recall 76.3%는 그대로이므로 이 수치를 품질 개선으로 읽으면 안 된다.
  사람의 소요 시간·실제 LLM 품질은 여전히 미측정(EVAL-UX02/U11).
```
