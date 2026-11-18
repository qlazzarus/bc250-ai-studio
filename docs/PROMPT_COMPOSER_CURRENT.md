# 사전 프롬프트 현재 구현

갱신일: 2026-11-17 · `eb5664c` + 현재 미커밋 구현 기준. 이 문서는 코드와 데이터 계약 설명이다. **작업 상태·순서·완료 기준은 [단일 실행 태스크](PROMPT_COMPOSER_EXECUTION_TASKS.md)에서만 관리한다.** 과거 진행표와 검증 기록은 [archive](archive/prompt-composer/2026-11-17/README.md)에 보존했다.

현재 UI에는 분류·검색 복구, 그룹별 선택 칩과 영어 상세, 자동 미리보기·명시적 적용, 칩 제거 후 포커스 복귀, 정보/주의/오류 구분이 있다. 전체 목록으로 진입하며 빈 장면의 `대상부터 고르기`로 대상 분류와 검색 포커스를 선택한다. 이는 저장 Scene 순서와 API 계약을 변경하지 않는다. 최근 브라우저 증거의 남은 범위는 VERIFY01/VERIFY02를 따른다.

## 구성과 데이터 흐름

| 계층 | 구현 파일 | 현재 책임 |
| --- | --- | --- |
| 정적 사전 | `frontend/src/prompt/dictionary.ts` | 버전 1.2.0, 활성 항목 100개, 안정 ID·분류·한국어 이름·별칭·계열별 표현. 한국어 이름/별칭/ID 부분 문자열 검색 |
| 선택 스냅샷 | `frontend/src/prompt/scene.ts` | Scene v1에 대상 계열, 선택 당시 이름·분류·사전 버전·매핑, 자유 입력 보관. 계열 변경 시 현재 사전으로 명시적 재결속 |
| 컴파일러 | `frontend/src/prompt/compiler.ts` | 버전 1.3.0. 스냅샷을 분류·ID 순으로 정렬해 초안·출처·미변환 항목·경고 반환. 네트워크/LLM 호출 없음 |
| 화면 상태 | `frontend/src/prompt/builderState.ts` | 편집 중 scene, 생성 결과 result, 생성 당시 scene 문자열 generatedFrom, 마지막 적용 이력 applied 분리 |
| 구성 UI | `frontend/src/components/PromptBuilder.tsx` | `prompt-stage`(탐색 1열 + 장면/미리보기 1열) · 검색·10개 표시 분류·``선택 n``·0건 복구·다중 선택·한국어 칩+접이식 영어 상세·선택 비우기·추가 설명·자동 미리보기/명시적 적용·포함 여부 안내 |
| 제안·경고 해설 | `frontend/src/prompt/proposals.ts` | `suggestSelections()` 규칙 기반 후보(사전 ID만 반환, 원문 불변), `explainWarning()` 한국어 경고 문장 + 안전할 때만 중복 해제 ID |
| 표시 계산 | `frontend/src/prompt/presentation.ts` | 검색 필터·0건 복구 선택지·미리보기 버튼 노출 조건·포함/보관 안내 문구·적용 상태 라벨. 순수 함수만 두고 부수효과 없음 |
| 제출과 재사용 | `frontend/src/App.tsx` | capability 확인, 최종 prompt 제출, 적용 이력 첨부, 모델 변경 확인, 결과 재사용 |
| 서버 계약 | `backend/app/models/schemas.py`, `backend/app/services/registry.py` | 구성 v1 구조·크기·매핑 상태·중복 ID·모델 계열 일치 검증. 실제 실행 기준은 최상위 prompt |
| 결과 표시 | `frontend/src/components/MetadataModal.tsx` | 선택 이름·원문·초안·미변환/누락·컴파일러 버전 표시 |

사용 순서는 모델 선택 → 사전 선택/추가 설명 → (자동 미리보기 확인) → 초안을 최종 프롬프트에 적용 → 최종 입력 직접 수정 → 생성이다. 정상 편집에서는 `초안 만들기` 버튼이 나오지 않고, 과거 복원·계열 변경처럼 재생성이 필요한 상태에서만 나타난다. 생성된 초안 칸은 읽기 전용이며 편집은 적용 후 최종 프롬프트 칸에서 한다. P5는 추가 설명의 원문 반영/별도 보관을 명시적으로 선택하게 한다. 사전을 사용하지 않고 직접 입력할 수도 있다.

빈 최종 입력은 진입 즉시 오류가 아니라 시작 안내다. 오류는 blur·편집 후 지움·제출 시도에서 표시하고 생성 버튼 차단은 그대로 유지한다.

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

## 규칙 기반 제안과 AI 제안 요청·수락·부분 변경·상황 후보 (A5/A7 · LLM-I04/I05/I06 · VAR01/02)

`frontend/src/prompt/proposals.ts`와 PromptBuilder가 원문의 사전 이름/별칭 부분 문자열을 찾아 후보를 제시한다. 사용자가 제안 버튼을 열고 수락해야 선택에 반영한다. 원문은 보존하고 기존 선택/비활성 항목은 제외한다. confidence는 규칙 점수이며 모델 확률이 아니다. 경고 해설과 제거 가능한 중복 후보를 표시하지만 충돌은 자동 해제하지 않는다. 사전 ID·Scene·API 계약·컴파일러는 그대로다.

LLM-I04는 이 패널 옆에 `POST /api/v1/prompt/proposals`(LLM-I03)를 호출하는 상태 기계를 붙였고, LLM-I05가 그 응답을 수락 카드로 렌더한다. 세 파일이 역할을 나눈다.

| 파일 | 역할 |
| --- | --- |
| `frontend/src/prompt/llmProposals.ts` | 순수 상태 기계. `idle/loading/ready/empty/unavailable/error/cancelled`, `revisionsFor()`(sha256 지문 3개), `proposalBody()`, `startProposal`/`settleProposal`/`cancelProposal`/`invalidateProposal`, `runProposal()`(25초 abort), `proposalNotice()` |
| `frontend/src/prompt/proposalCapability.ts` | capability 판정(`supported`/`absent`/`unsupported_schema`/`stale_dictionary`), 버튼 라벨, 폴백 한 문장 |
| `frontend/src/prompt/digest.ts` | 동기 SHA-256. `revisions`가 계약상 `sha256:<hex>`이고 요청 본문을 만드는 같은 동기 동작 안에서 필요해 `crypto.subtle`을 쓸 수 없다 |
| `frontend/src/prompt/proposalCards.ts` | 한 응답을 수락 카드로 변환. `proposalCards({reply, scene, dictionary, family, scope})` → 카드·개수·`batchIds`·`excluded`·`truncated`·`rejectedCount`. scene을 변경하지 않고 결정만 반환 |
| `frontend/src/prompt/partialChange.ts` | 부분 변경 범위. `partialScope()`가 대상 그룹 밖의 현재 선택을 잠금으로 계산하고, `partialDiff()`가 수락 전 유지/추가/적용 불가 행을 만든다. `LOCK_NOTE`가 \"설정 고정 ≠ 동일 인물 보장\"을 고정한다 |
| `frontend/src/prompt/proposalUndo.ts` | 한 단계 되돌리기. `recordAcceptance()`가 이번 클릭이 *추가한* ID만 기록하고, `undoStatus()`가 지문 불일치 시 되돌리기를 거부하며, `undoScene()`은 기록된 ID만 제거한다 |
| `frontend/src/prompt/situationVariants.ts` | VAR01 상황 후보 표시. `variantCards({reply, scene, dictionary, family, scope})` → 후보 카드(장소·행동 diff, 사전 밖 표현, 차단 사유)·`truncated`·`rejectedCount`. 적용 함수는 없다 — 후보를 장면으로 바꾸는 것은 VAR02다 |
| `frontend/src/prompt/variantApply.ts` | VAR02 후보 적용·되돌리기. `applyVariantScene()`이 차단된 카드를 거부하고 `selectEntry`/`removeEntry`로 장면을 만들며, `recordVariantApply()`·`variantUndoStatus()`·`undoVariantScene()`이 한 단계 되돌리기를 지문으로 판정한다. 최종 prompt·저장 데이터를 건드리지 않는다 |

동작 규칙:

- **입력 중 자동 호출 없음.** 요청은 버튼 클릭 한 곳에서만 시작하며 `useEffect`나 `onChange` 경로에 호출 지점이 없다. 테스트가 호출 지점 수를 검사한다.
- **오래된 응답 방어는 두 겹이다.** ① `request_id`가 현재 것과 다르면 폐기. ② 서버가 되돌려준 `revisions`가 보낸 값과 다르면 폐기(프로토콜 오류), 보낸 값은 맞지만 지금 화면의 지문이 다르면 `cancelled/stale_revision`으로 폐기. 원문·선택·최종 prompt는 어떤 경우에도 바뀌지 않는다. `ready`/`empty` 결과도 계산 당시의 `revisions`를 들고 있어, 원문을 고치면 낡은 제안이 즉시 철회된다(I05 카드의 전제). `error`/`unavailable`은 그 시점의 상태 문구이므로 입력이 바뀌어도 유지한다.
- **capability가 없으면 AI 버튼을 만들지 않는다.** 비활성 버튼 대신 "이 서버에서는 AI 제안을 사용할 수 없습니다. 지금은 원문에서 사전 항목만 찾습니다." 한 문장을 보여주고 규칙 제안은 그대로 쓴다. 사전 버전이 서버와 다르거나 schema가 다를 때도 호출하지 않는다(호출하면 사용자가 조치할 수 없는 `stale_dictionary` 실패만 돌아온다).
- **응답 상태를 그대로 쓴다.** `ready`/`empty`/`unavailable`은 실패가 아니라 각자의 상태이고 `message`는 서버 문장을 그대로 표시한다. 클라이언트는 새 문구를 지어내지 않는다.
- **수락은 카드에서만 일어난다(LLM-I05).** 응답은 네 종류의 카드로 렌더한다: `quoted`(원문에서 찾은 항목), `inferred`(AI가 덧붙인 항목), `unresolved`(사전 항목이 없는 원문 구절), `ambiguous`(여러 해석, 서버가 고르지 않음). 카드마다 `선택에 추가` 버튼이 있지만, 사전 항목이 있고 막는 사유가 없을 때만 나타난다. 구절·모호 카드는 원문을 보존하려고 표시만 한다.
- **일괄 수락은 원문 근거만 포함한다(C01-3).** `batchIds`는 `quoted`이면서 막는 사유가 없는 카드의 ID다. `inferred`는 개별 수락은 되지만 일괄에서는 빠지고, `일괄 수락에서 빠진 항목` 접이식 목록에 이유와 함께 나온다. 사용자가 클릭하지 않은 항목이 선택에 들어가는 경로는 없다.
- **막는 사유는 여덟 가지다.** `duplicate`(같은 응답에 같은 ID), `not_in_dictionary`, `inactive`, `already_selected`, `conflict`, `unmapped`, 그리고 부분 변경의 `locked`, `out_of_scope`. 충돌은 *일괄 결과 누적 집합*을 기준으로 판정하므로, 클릭한 뒤 컴파일러 경고로 뒤늦게 알게 되는 일이 없다. `already_selected`는 거절이 아니라 "이미 반영됨"이므로 `제외 목록`에 넣지 않는다. 충돌 쌍은 `compiler.ts`의 `conflictsAmong()` 한 곳에서 온다.
- **부분 변경은 같은 응답을 범위로 판정한다(LLM-I06).** `부분 변경 범위`에서 그룹을 고르면 버튼이 `선택한 그룹만 정리`가 되고 요청이 `kind: "partial_change"` + `target_groups` + `locked_ids`로 나간다. 잠금은 사용자가 입력하는 값이 아니라 **대상 그룹 밖의 현재 선택**을 `partialScope()`가 계산한 것이다. 잠긴 값을 바꾸는 제안과 범위 밖 제안은 서버가 `locked`/`out_of_scope`로 거절하고, 클라이언트도 같은 규칙으로 카드를 차단한다(스텁·구버전 서버에서도 약속이 유지된다). 그룹 이름이 사전에 없으면 전체 정리로 강등하지 않고 범위 없음으로 둔다.
- **수락 전에 diff를 보여준다.** 부분 변경 응답에는 `수락하면 이렇게 바뀝니다`(고정·추가·적용 불가)가 붙는다. 바뀌는 항목이 없으면 `지금 수락해도 선택이 바뀌지 않습니다`를 띄운다. 잠금은 **설정 고정**이며 동일 인물 보장이 아니라는 문장을 패널과 카드 양쪽에 쓴다.
- **되돌리기는 한 단계이고, 기록된 ID만 지운다.** 수락하면 그 클릭이 *추가한* ID만 `recordAcceptance()`에 남는다. `방금 추가한 … 되돌리기`는 그 ID만 제거하므로 이후 직접 고른 항목은 남는다. 수락 뒤 원문이나 선택이 바뀌어 지문이 달라지면 되돌리기를 **비활성**하고 사유를 보여준다 — 낡은 기록으로 다른 장면을 되돌리지 않는다. 되돌리기 버튼은 카드 패널 밖에 있어, 카드를 모두 수락해 패널이 비어도 남는다.
- **수락은 장면만 바꾼다.** `selectEntry` → `compileScene` 기존 경로를 그대로 쓰므로 카드가 선택기로 만들 수 없는 장면을 만들지 않는다. 원문(`freeTextKo`)과 최종 prompt는 클릭으로 바뀌지 않고, 브라우저 검사가 두 값을 클릭 전후로 비교한다. 최종 prompt 반영은 여전히 `초안 적용` 단계다.
- **클릭 뒤 카드는 남는다.** 수락은 `reapplyProposal`로 응답의 지문만 새 선택에 맞춰 다시 잡으므로 남은 카드가 계속 쓸 수 있다. 반면 원문을 고치면 `invalidateProposal` → `cancelled/stale_revision`으로 카드가 전부 철회된다("이전 제안을 버렸습니다").
- **거절은 선택을 바꾸지 않는다.** `제안 닫기`는 카드만 없애고 선택·원문·최종 prompt는 그대로다("AI 제안을 닫았습니다"). 이미 수락한 항목은 `방금 추가한 … 되돌리기`로만 되돌린다(한 단계).
- **상황 후보는 별도 요청이고, 적용은 카드마다 명시적이다(VAR01/02).** `장소와 행동만 바꾼 상황 3개` 버튼이 `kind: "situation_variants"`를 보낸다. 요청의 `target_groups`는 표시 그룹 `pose`·`setting` **고정**이고(부분 변경 범위를 고른 상태여도 후보는 항상 장소·행동만) 나머지 선택은 `locked_ids`로 잠기므로 인물·의상은 바뀌지 않는다. 후보는 최대 3개이며 장소/행동 diff와 사전 밖 표현을 그대로 보여준다. 잠금·그룹 밖·이미 선택됨·사전 밖 항목이 있는 후보는 서버와 클라이언트가 같은 사유로 차단하고 적용 버튼 없이 사유만 표시한다. 적용은 카드의 `적용` 버튼 한 번으로만 일어나며, `applyVariantScene()`이 차단된 카드를 다시 한 번 거부한 뒤 `selectEntry`/`removeEntry`로 장면을 만든다. 후보는 저장되지 않고 원문·최종 프롬프트·생성 요청을 바꾸지 않는다. 다인 귀속(`actor`) 후보는 SCENE01/02 이전이라 v1에서 거절한다.
- **상황 적용도 한 단계 되돌리기다.** 적용 시 `variantApply.ts`가 적용 **전 장면 전체**를 기록하고, `“…” 상황 적용 되돌리기`가 그 장면을 그대로 복원한다(후보는 장소·행동을 *제거*하기도 하므로 ID만 다시 추가하면 저장된 표현을 잃는다). 이후 선택이나 원문이 바뀌어 지문이 달라지면 버튼을 비활성하고 사유를 보여준다. 카드 수락 되돌리기와 상황 적용 되돌리기는 **한 슬롯**을 공유한다 — 둘 다 "마지막 장면 편집"이므로 새 편집이 이전 기록을 대체한다.
- **적용한 후보는 비교 기준을 흔들지 않는다.** 한 후보를 적용한 뒤에도 세 후보는 적용 *전* 장면을 기준으로 다시 계산되므로, 두 번째 후보가 "지금 선택에 없는 항목입니다"로 잘못 차단되지 않는다. 적용한 카드는 `지금 선택에 반영됨`으로 표시하고 적용 버튼을 숨긴다. 원문을 고치면 `invalidateProposal`이 후보 전체를 철회한다.
- **포커스는 사라진 버튼에 남지 않는다.** 수락으로 해당 카드의 버튼이 사라지면 남은 첫 수락 버튼 → 일괄 버튼 → AI 버튼 순으로 옮긴다. 대상은 커밋된 DOM에서 찾는다(같은 커밋에서 ref가 분리되므로 ref map은 살아남은 형제를 놓친다).

실제 LLM은 여전히 한 번도 호출되지 않았다. 서버는 `engine != fake` + `admission_url` + `llm_model` + 사전 로드가 모두 참일 때만 capability를 광고하므로, 현재 fake fixture 화면은 항상 폴백 문구를 보여준다. 계약은 [API 문서](API.md)의 "LLM prompt proposals" 절.

## 설명 작업 평가 (EVAL-UX01)

규칙 모드 기준선을 12개 손수 작성 장면으로 측정한 기록은 [PROMPT_COMPOSER_EVAL_UX01.md](PROMPT_COMPOSER_EVAL_UX01.md)에 있다. recall 76.3 %, precision 91.2 %, 사전 밖 표현 23개, 실제 UI 클릭 43회이며, **사람의 시간과 실제 LLM 응답 품질은 측정하지 않았다**. 측정 스크립트는 `scripts/eval-ux01/`에 있고 제품 모듈만 실행한다(네트워크·생성 호출 없음). 이 평가는 화면·계약·사전을 바꾸지 않았다.

Actions는 Python/Node 검증·전체 빌드·전체 패키징을 계속 실행한다. 변경 영역별 skip은 [설계 문서](ACTIONS_DEPLOY_OPTIMIZATION.md) 단계다. 미완료 작업은 [추적 목록](PROMPT_COMPOSER_EXECUTION_TASKS.md)에서 관리한다.
