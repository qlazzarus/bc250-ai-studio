> Archive · 2026-11-16 보관 · 기준 소스 `730e077`. 아래 상태/테스트 수는 당시 기록이며 현재 현황은 [현재 구현](../../../PROMPT_COMPOSER_CURRENT.md), 남은 작업은 [추적 목록](../2026-11-17/PROMPT_COMPOSER_FOLLOWUP.md)을 따른다.

# Prompt Composer P5 개선과 후속 설계

현재 남은 작업과 회귀 수정 상태는 [후속 작업 추적](../2026-11-17/PROMPT_COMPOSER_FOLLOWUP.md)에서 관리한다. capability 설정 누락 회귀(P5-R01)와 원래 129건 범위 재실행(P5-R02)은 통과했고, P5-C01/C02/C03 브라우저 검증과 P6-UX 화면 검증도 로컬 Chromium에서 완료했다. 운영 배포·롤백과 GPU 품질 검증은 여전히 미완료다.

작성일: 2026-11-15. 기준 커밋 `12ee5ea`와 기존 문서 변경을 보존하고 적용한 로컬 변경이다. Scene v1·prompt_composition v1·최종 prompt 실행 기준·retry 복사를 유지한다. 사전은 1.2.0, 컴파일러는 1.3.0이다. P0–P4 기록은 [기존 작업 계획](../2026-11-17/PROMPT_COMPOSER_TASKS.md)에 보존한다.

## 대조 결과와 위험

| 발견 사항 | 위험도 | 조치 |
| --- | --- | --- |
| 화면은 제한 초과를 경고만 하고 최종 편집/구성 바이트를 검사하지 않음 | 높음: 접수 실패 및 입력 수정 위치 불명확 | P5-A 적용·제출 검사 |
| 추가 설명이 언어와 관계없이 최종 입력에서 누락 | 높음: 사용자 의도와 실행 입력 차이 | P5-B 명시적 원문 반영/별도 보관 |
| 마지막 applied와 현재 scene·최종 입력의 차이를 알기 어려움 | 중간: 이력 오해 | 문자열 비교와 선택 변경 상태 표시 |
| 복원 시 과거 초안에 현재 경고·미변환 목록을 섞음 | 중간: 재현성 오해 | 저장 사실만 복원, 재생성은 명시적 동작 |
| HTTP 전체 한도와 구성 32 KiB 한도 혼동 | 중간: 환경별 접수 실패 | capability에 설정된 HTTP 한도 광고 |
| 반영 방식·당시 경고·출처가 저장 계약에 없음 | 잔여 중간 | 기록 없음 표시. 새 필드를 추정하지 않음 |

## P5-A — 검증과 적용 상태

- **문제:** JavaScript UTF-16 길이는 Python 문자열 길이와 다르며 클라이언트에서 확실한 거절 요청도 제출했다. scene과 applied의 관계도 화면에서 불명확했다.
- **수정 파일:** `frontend/src/prompt/validation.ts`, `builderState.ts`, `compiler.ts`, `frontend/src/components/PromptBuilder.tsx`, `frontend/src/App.tsx`, `frontend/src/api.ts`, `backend/app/api/routes.py`.
- **계약:** 저장 구조 변경 없음. capability 응답에 optional `request_limits.max_body_bytes`만 추가한다. 구 클라이언트는 무시하고 구 서버에서는 필드가 없을 수 있다.
- **구현:** 코드포인트 개수, NUL/손상된 surrogate, 선택 100개, 초안·최종 8,000자, 추가 설명·미변환 text 4,000자, 미변환 101개, 표현 300자, ID/버전/라벨 제한, 중복 ID·매핑 상태·모델 계열을 검사한다. 구성 JSON은 서버 기본값(`unresolved.id=null` 등)을 채운 UTF-8 32 KiB로 검사한다. HTTP는 실제 전송 `JSON.stringify(body)` 바이트를 광고된 한도와 비교한다.
- **오류 UX:** 최종/negative/추가 설명·선택·초안에 오류를 연결하고 크기와 수정 안내를 표시한다. 전체 구성/요청 오류는 제출 버튼 앞에도 표시한다. 적용 및 제출을 차단하되, 편집 중인 scene은 마지막 applied를 대체하지 않는다. capability 미지원/실패 시 전송하지 않는 구성의 오류로 직접 생성을 막지 않는다.
- **상태:** `scene`, `result`, `generatedFrom`, `applied`를 유지하고 클라이언트 전용 `generatedMode`, `freeTextMode`, `provenance`, `appliedScene`, `appliedPrompt`를 추가한다. 최신 여부·선택 변경·문자열 수정·검증 결과는 독립 판정한다. 해시 대신 적용 당시 문자열을 메모리에서 직접 비교하며 의미 일치를 주장하지 않는다.
- **호환성:** 구 서버에서 HTTP 한도를 알 수 없으면 서버 검증에 맡긴다. 같은 계열은 기존 이력을 유지하고 다른 계열은 기존 확인·재결속·applied 초기화를 유지한다. 직접 수정한 최종 입력은 유효하면 제출 가능하다.
- **완료 조건:** 경계값 검사, capability fallback, 수정 후 applied 유지, 재적용 및 family 방어가 단위/API 검증을 통과한다. 로컬 구현 완료. 브라우저 완료는 P5-C와 별도다.
- **잔여 위험:** capability 이후 서버 설정 변경이나 프록시의 더 작은 한도는 서버가 최종 판단한다. 프런트 검사는 UI가 만드는 타입을 전제로 하며 임의 외부 JSON의 타입/추가 필드는 서버 Pydantic이 최종 검증한다. SD 1.5 토큰 경고는 여전히 근사치이고 자유 입력까지 정확히 토큰화하지 않는다.

## P5-B — 자유 입력과 과거 복원

- **문제:** 자유 입력 누락과 반복 반영 가능성, 저장값/현재 계산값 혼합.
- **수정 파일:** `builderState.ts`, `PromptBuilder.tsx`, `MetadataModal.tsx`, `App.tsx`, `compiler.ts`, 관련 테스트.
- **계약:** Scene/API 버전은 그대로다. 원문은 `free_text_ko`, 실제 적용 후보는 `draft_prompt`, 실행 문자열은 최상위 `prompt`로 보존한다. `unresolved`는 번역되지 않은 원문/미제공 표현 기록이며 최종 입력에 없다는 증거가 아니다. 반영 방식은 클라이언트 전용이며 영속화하지 않는다.
- **원문 반영:** 사용자가 선택하면 사전 초안 뒤에 개행 하나와 원문을 그대로 붙인다. 사전 초안이 없으면 원문 자체를 사용한다. trim·번역·언어 감지·토큰 재작성은 하지 않는다. 원문 내 LoRA 구문은 문자열로 보존할 뿐 해당 엔진 기능 지원을 추가하는 것은 아니다.
- **별도 보관:** 기본값이다. 사전 초안에는 원문을 넣지 않는다. 자유 입력만 있고 사전 초안이 비었으면 유효한 최종 입력을 직접 작성한 뒤 `설명만 이력에 적용`할 수 있다. 최종 입력은 바꾸지 않고 빈 초안과 원문을 저장한다. capability 미지원 때 구성 이력은 저장되지 않는 기존 안내를 따른다.
- **중복 방지:** 매번 사전 컴파일 결과와 원문으로 후보를 새로 만든다. 현재 최종 입력에 추가하지 않고 후보로 교체하므로 반복 생성/적용이 누적되지 않는다. 다른 최종 입력을 교체할 때 기존 확인을 유지한다. 원문에 사용자가 의도적으로 반복한 문장은 제거하지 않는다.
- **복원:** `restoreComposition()`은 저장된 초안·버전·선택·미변환 목록만 복원한다. 경고·출처 배열은 비우고 `provenance=saved`로 기록 없음 안내를 표시한다. 재사용의 최종 prompt·설정·시드는 그대로다. `현재 컴파일러로 초안 다시 만들기`를 눌러야 저장된 선택 표현에 현재 규칙을 적용한다. 최신 사전 표현을 자동 덮어쓰지 않으며 계열 변경 시에만 기존 재결속 계약을 따른다.
- **비교:** 메타데이터는 저장 초안과 최종 prompt의 문자열 동일 여부만 알린다. 적용 당시 문자열과 반영 방식은 별도 기록 없음으로 표시한다. 복원 후 재생성만 해도 과거 applied는 유지되며 명시적 재적용 때 바뀐다.
- **테스트/완료 조건:** 원문 공백·개행·혼합 언어·특수 구문, 반복 생성/적용, 수정·원문 변경·계열 변경·복원, 별도 보관, API 메타데이터 보존을 검증한다. 로컬 구현 완료.
- **잔여 위험:** 반영 방식은 재접속 후 알 수 없다. 복원 후 새로 생성할 때 기본값은 별도 보관이므로 원문 포함을 다시 선택해야 한다. 과거에 저장하지 않은 renderer/provenance는 재구성하지 않는다. 이를 영속화하는 변경은 별도 계약 검토가 필요하다.

## P5-C — 브라우저 통합 검증 절차

**상태: 로컬 브라우저 검증 완료 (2026-11-15).** 이전 세션에서는 브라우저 도구가 `The browser access host is unavailable`을 반환했으나, 이번에는 로컬 캐시 Chromium과 Playwright로 실제 조작을 수행했다. 채워진 결과는 [후속 추적의 P5-C 기록](../2026-11-17/PROMPT_COMPOSER_FOLLOWUP.md)에 있다. 실제 보조기기/스크린리더 낭독은 여전히 미검증이다.

운영 GPU 대신 별도 로컬 Fake 환경을 사용한다. 아래 키는 로컬 시험용 예시이며 운영에 사용하지 않는다. 서버 data_dir를 새 임시 경로로 지정한다.

```sh
# 저장소 루트, 터미널 1
STUDIO_API_KEY=client-key-for-tests-1234567890 \
STUDIO_ADMIN_KEY=admin-key-for-tests-1234567890 \
STUDIO_DATA_DIR="$(mktemp -d /tmp/studio-p5.XXXXXX)" \
STUDIO_ENGINE=fake STUDIO_POLICY=image_priority \
.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 18090

# frontend/, 터미널 2
VITE_STUDIO_API_KEY=client-key-for-tests-1234567890 \
VITE_STUDIO_TARGET=http://127.0.0.1:18090 npm run dev
```

`http://127.0.0.1:5173`에서 확인한다. 5173이 다른 프로젝트에 점유돼 있으면 `npm run dev -- --port 5174`로 띄우고 `VITE_CORS`에 그 origin을 넣는다. Fake는 사전 매핑이 없으므로 사전 구절/다른 계열의 화면 시험에는 API 응답 fixture 또는 시험용 registry가 필요하다. 운영 모델을 실행하는 것으로 대체하지 않는다. DevTools Network의 응답 재정의/요청 차단은 해당 로컬 페이지에만 적용하고 시험 후 해제한다.

계열 전환·미지원 계열·한도 시험에는 모델 파일 없이 도는 시험용 registry를 쓴다. `STUDIO_REGISTRY_PATH`로 넘기고 모두 `engine: fake`로 둔다.

```yaml
# /tmp/pc-browser/models.yaml (요지)
models:
  - id: fake-sd15
    family: sd15
    engine: fake
  - id: fake-sd15-alt     # 같은 계열, 다른 ID
    family: sd15
    engine: fake
  - id: fake-flux2
    family: flux2
    engine: fake
  - id: fake-unknown      # 미지원 계열
    family: unknown-family
    engine: fake
```

`fake-flux2`는 100/100 매핑이라 계열 커버리지 경고가 나오지 않는 것이 정상이며, `fake-unknown`에서만 `미변환` 칩과 미지원 경고를 확인할 수 있다.

| 시나리오 | 절차와 기대 결과 | 상태 |
| --- | --- | --- |
| 검색·분류·필터 밖 선택 | 인물 선택 → 조명 검색/분류 → 선택 칩에 인물 유지 | 통과 (2026-11-15) |
| 칩 해제·전체 비우기 | 칩 ×와 선택 비우기, 취소/확인 → 추가 설명·최종 입력 유지 | 통과 |
| 초안·stale | 선택/원문 반영 → 초안 → 선택 또는 방식 변경 → 재생성 전 적용 불가 | 해당 없음 — P6-UX 자동 미리보기가 초안을 즉시 갱신해 stale 상태가 UI에 나타나지 않음. `isDraftStale` 가드는 유지 |
| 덮어쓰기 | 기존 최종 입력 작성 → 다른 초안 적용 → 취소는 보존, 확인은 후보로 교체 | 통과 |
| 자유 입력 | 혼합 언어/특수 구문으로 원문 반영, 3회 생성/적용 → 한 번만 포함 | 통과 |
| 별도 보관 | 사전 없이 원문과 직접 최종 입력 → 설명만 이력에 적용 → 최종 입력 유지 | 코드 경로 확인, 초안 없는 직접 입력 접수는 P5-C02k에서 확인 |
| 최종 수정 | 적용 후 직접 수정 → 수정 안내, 생성 가능, 결과 초안과 최종 차이 표시 | 통과 |
| 다른/같은 계열 | fixture 모델 전환 → 다른 계열 확인·재결속, 같은 계열 applied 유지 | 통과 |
| capability 실패/미지원 | 로컬 capability 요청 차단 또는 구성 지원 필드 제거 후 새로고침 → 긴 편집 scene이 있어도 유효한 직접 prompt 제출 가능 | 통과 (차단·미지원·한도 없음 3종) |
| 과거 재사용 | 구 구성/새 구성/구성 없는 metadata fixture → 실제 설정·최종 입력 복원, 과거 경고를 생성하지 않음 | 통과 (구 compiler 1.0.0 구성) |
| retry | 시험용 실패/취소 작업 retry → 원 spec 유지, 새 작업 ID | 통과 |
| 한도·서버 오류 | 8001 코드포인트/4001 설명/32 KiB 경계 및 낮은 HTTP 한도 fixture → 구체적 오류와 차단. 강제 422/413 응답 → 기존 오류 UI 표시, 입력 보존 | 통과 |
| 키보드 | Tab/Shift+Tab으로 입력·선택·칩·생성·적용 이동, Space/Enter, 오류 연결과 포커스 확인 | 통과 (Enter 열기, Space 선택, 2px 포커스 링, aria 연결) |
| 좁은 화면 | DevTools 360px·390px·200% 확대 → 텍스트/버튼 겹침·가로 넘침·접근 가능성 확인 | 통과 (360/390px·640×450 근사) |

완료 조건은 각 행에 실행 환경·스크린샷/관찰 결과·실패 이슈를 남기는 것이다. 실행 환경과 관찰 결과는 [후속 추적의 P5-C01/C02/C03 표](../2026-11-17/PROMPT_COMPOSER_FOLLOWUP.md)에 있다. 로컬 브라우저 검증이 끝났어도 운영 배포·롤백 검증과 GPU 품질 검증은 별도이며, P5-L01 전까지 릴리스 준비 완료로 표시하지 않는다.

## P6 — 모델별 렌더러 설계와 평가 (구현하지 않음)

기존 P6 품질 검토와 P7 모델별 컴파일 확장 후보를 이 단계로 묶는다. `Scene → Normalized Scene → Model Renderer → Validation → Prompt`를 후보 구조로 삼되 기존 `compileScene`의 정렬·중복·충돌·출처 로직을 먼저 재사용한다. Normalized Scene은 선택 스냅샷을 읽으며 최신 사전으로 몰래 재결속하지 않는다. Renderer는 SD 태그형과 자연어 구절형부터 시작하고 Z-Image/FLUX/MOSS 공통 구현을 허용한다. family와 renderer를 1:1로 고정하지 않고 registry의 모델 ID/체크포인트 profile에서 renderer를 선택하는 방안을 설계한다. 알 수 없는 profile은 기존 계열 처리로 명시적으로 돌아간다.

변경 대상 후보는 compiler와 별도 renderer/profile 모듈, 평가 fixture이며 대규모 UI 재작성은 없다. 저장할 renderer version/profile ID, compilation fingerprint, 반영 방식 및 적용 문자열 fingerprint는 별도 계약 제안이다. 사전 버전은 이미 항목별로 저장하고 모델 ID·설정·seed는 기존 job/asset 값과 연결해 중복 진실을 만들지 않는다.

평가 장면 12개: 인물 전신, 얼굴 근접, 걷는 인물, 실내 창가, 야간 네온, 카페, 숲, 해변, 고양이, 건축물, 수채화, 의도적 다인/속성 충돌. 각 장면에 원문·선택 ID/스냅샷·기존/후보 최종 prompt를 고정하고 사용 가능한 체크포인트마다 seed 17/42/123을 동일하게 비교한다. 체크포인트 파일 해시·엔진 버전·renderer 버전·해상도·steps·CFG·sampler·scheduler·negative·트리거·실제 seed·시간·실패를 기록한다. 모델마다 허용 설정이 다르므로 동일 숫자를 강요하지 않는다. 모델 내 기존/후보의 조건을 맞추고 순차 실행한다.

선택 요소 반영·불필요한 의미 추가·인물별 귀속·아티팩트·사용자 선호를 나란히 평가하고 실패 사례도 남긴다. 구절형보다 좋다는 결론은 GPU 결과 없이는 내리지 않는다. 완료 조건은 profile 선택 규칙과 호환성 테스트, 사용자 평가 및 재현 자료이며 현재는 설계만 완료다. GPU 비용/가용성·엔진 차이는 잔여 위험이다.

## P7 — Scene v2와 캐릭터 귀속 (구현하지 않음)

후보 구조: 독립 actor ID와 각 actor의 외형·의상·포즈, 공통 setting/lighting, actor ID를 참조하는 관계·행동, 참조 자산 ID와 사용 목적. Scene v1 선택은 단일 actor에 무조건 귀속하지 않고 `unassigned` 또는 legacy 선택 그룹으로 읽어 원문과 스냅샷을 보존한다. v1 → v2 변환은 사용자 검토 가능한 명시적 변환이며 저장 이력을 파괴하지 않는다.

ControlNet Pose/IP-Adapter/img2img는 텍스트 renderer 외에 자산 업로드/권한/보관, 조건 이미지 전처리, engine capability, 요청 schema와 GPU 메모리 검증이 필요하다. 후보 변경 파일·마이그레이션·구 버전 읽기 전략을 별도 제안하고 승인 후 구현한다. 완료 조건은 다인 속성/관계의 구조 및 v1 왕복/legacy 보존 시험이다. 이번에는 Scene v2·새 참조 API·DB migration을 구현하지 않았다.

## P8 — 선택적 LLM 보조 (A5/A7 결정론 선행 구현)

번역·장면 보강·모델별 제안·누락/충돌 설명·캐릭터 구성을 사용자의 명시적 요청으로만 수행한다. 원문/결정론적 초안/LLM 제안을 분리하고 제안 diff와 적용/거부를 제공한다. 별도 인증된 Client/gate 경계와 GPU admission/drain을 설계하며 LLM 실패·응답 불완전·메모리 부족에도 현재 사전/직접 생성이 계속 동작해야 한다. 변경 대상 후보는 Client 연동 API와 제안 UI, 응답 스키마이며 이번 구현에는 없다. 완료 조건은 원문 보존·실패 복구·명시적 적용·자원 전환 검증이다.

이 단계의 구체적 자동화 후보는 [LLM 자동화 제안](../../../PROMPT_COMPOSER_LLM_AUTOMATION.md)에 8개(오프라인 배치 A1–A4, 온라인 제안 A5–A7, 평가 보조 A8)로 정리했다. 그 문서는 우선순위·계약 초안·GPU 경합 규칙·측정 지표·위험을 다룬다. 사전 스키마·Scene v2·제안 API·운영 GPU 사용은 승인 전 수행하지 않는다.

2026-11-15에 A5(원문→사전 후보)와 A7(경고 해설)을 **LLM 없이 결정론으로 선행 구현**했다(`frontend/src/prompt/proposals.ts`, `PromptBuilder.tsx`). 타이핑 중에는 호출하지 않고 버튼을 눌렀을 때만 제안을 계산하며, 수락은 기존 `selectEntry()`를 재사용한다. 충돌 경고는 문장 설명만 하고 자동 해제하지 않는다. 이 구현은 서버·스키마·GPU·CI를 건드리지 않으므로 P8 승인 경계에 해당하지 않는다. LLM 교체는 `ProposalRequest`/`SelectionHint` 타입을 유지한 채 구현만 바꾸면 된다. 상세는 [후속 추적의 LLM 기록](../2026-11-17/PROMPT_COMPOSER_FOLLOWUP.md)을 따른다.

## 검증 기록과 승인 경계

자동 검증 명령과 결과는 [현재 구현 문서](../../../PROMPT_COMPOSER_CURRENT.md)의 이번 검증 절을 따른다. 테스트 통과, 브라우저 확인, 운영 배포, GPU 품질은 별도 상태다.

이번 변경은 하위 호환 UI·검증 개선과 capability 응답의 optional 필드 추가다. 저장 스키마 변경·파괴적 migration·대규모 UI 변경·운영 배포를 수행하지 않았다. 반영 방식/renderer/fingerprint 영속화, Scene v2, 참조 자산 및 엔진 계약 변경이 필요해지면 이유·영향·대안·마이그레이션을 제시하고 별도 승인을 받는다.

## 변경 파일 목록

| 파일 | 변경 내용 |
| --- | --- |
| `frontend/src/prompt/validation.ts` | 신규 코드포인트·바이트·구성·제출 검증 |
| `frontend/src/prompt/builderState.ts` | 원문 반영·적용 비교·저장 사실 복원 |
| `frontend/src/prompt/compiler.ts` | 1.3.0, 코드포인트 경고와 nullable unresolved ID 호환 |
| `frontend/src/components/PromptBuilder.tsx` | 반영 방식·필드 오류·적용 상태·복원 안내 |
| `frontend/src/components/MetadataModal.tsx` | 최종/초안 비교와 기록 없음 표시 |
| `frontend/src/App.tsx` | 실제 제출 본문 검증 및 필드 오류 |
| `frontend/src/api.ts` | optional HTTP 한도 capability 타입 |
| `frontend/tests/prompt-p5.test.mjs` | P5 상태·유니코드·Python 교차 검증 9건 |
| `backend/app/api/routes.py` | 설정된 HTTP 요청 한도 광고 |
| `backend/tests/test_prompt_composition.py` | capability 및 원문/수정 최종 이력 테스트 2건 추가 |
| `README.md` | 현재 구현 문서 진입점 |
| `docs/API.md` | 한도·capability·미변환/미기록 의미 |
| `docs/GENERATION_MODES_DESIGN.md` | 구현/제안 구분과 후속 설계 연결 |
| `docs/PROMPT_COMPOSER_TASKS.md` | P5-A/B/C와 새 P6–P8, 기존 이력 보존 |
| `docs/PROMPT_SEED_EXPANSION_PLAN.md` | 확장 당시 계획과 현재 상태 구분 |
| `docs/PROMPT_COMPOSER_CURRENT.md` | 현재 동작·제한·검증 결과 |
| `docs/PROMPT_COMPOSER_P5.md` | 설계·영향·수동 절차·후속 범위·위험 |

문서에는 이전 턴에서 작성한 변경도 포함되어 있으며 이를 보존하고 이어서 갱신했다.
