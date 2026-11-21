# Studio API

공개 경로는 `/api/v1` 아래이며 `Authorization: Bearer <STUDIO_API_KEY>`가 필요하다. 관리자 동작은 별도 관리자 키를 사용한다. `/docs`, `/openapi.json`도 인증된다. 일반 클라이언트는 자산·작업을 공유하며 사용자 격리는 없다. 키를 URL query로 보내지 않는다.

정확한 타입·enum·제약은 [schemas.py](../backend/app/models/schemas.py), [routes.py](../backend/app/api/routes.py), [proposals.py](../backend/app/api/proposals.py)와 인증된 OpenAPI가 기준이다.

## 시스템과 모델

| 메서드·경로 | 동작 |
| --- | --- |
| `GET /system/health` | API/DB liveness. LLM 실행 상태와 별개 |
| `GET /system/status` | scheduler·GPU·오류·복구 상태 |
| `GET /system/capabilities` | simulated, Pixel, 구성 스키마, 선택적 LLM 제안 지원 |
| `GET /system/policies` | 현재 정책 |
| `PUT /system/policies` | 관리자 정책 변경, 활성 이미지 강제 종료 없음 |
| `POST /system/manual-grant` | 관리자 한 작업 실행 허가 |
| `POST /system/recover` | 관리자 journal 복구, 생존 이미지 worker가 없음을 먼저 확인 |
| `GET /models`, `/models/{id}`, `/models/{id}/presets` | 파일 가용성과 옵션·프리셋 |

`generation_options`의 고정·조건부 허용값을 따르고 미지원 값을 보내지 않는다. 상세는 [모델](MODELS.md)을 따른다. capability의 과거 phase 숫자만으로 개별 기능을 추정하지 않는다.

## 작업과 이벤트

| 메서드·경로 | 동작 |
| --- | --- |
| `POST /jobs` | 202 `{job_id,status}`. `image.generate`, `image.batch` |
| `GET /jobs`, `/jobs/{id}` | 목록·상세. 목록은 limit/offset |
| `POST /jobs/{id}/cancel` | 대기 작업 즉시 취소, 실행 작업은 이미지 경계에서 취소 |
| `POST /jobs/{id}/retry` | failed/interrupted/cancelled 작업의 설정·seed를 복사한 새 작업 |
| `GET /jobs/{id}/events` | 영속 SSE. Last-Event-ID 또는 after로 재연결 |

입력은 `source`(rp/nsfw/pixel), 모델, prompt/negative, 해상도, steps, CFG, sampler/scheduler, seed, priority, batch_count, preset, client_reference와 선택적 prompt_composition이다. `project_id`를 통한 생성 연결은 현재 허용하지 않는다. seed -1은 제출 시 확정하고 batch_count는 1..16이다. 옵션 생략은 모델·프리셋으로 해석한 후 저장한다.

상태는 queued → waiting_for_gpu → running → completed/failed/cancelled다. 재시작 때 진행 중 상태는 interrupted가 된다. 배치 부분 결과를 보존하며 retry는 원래 spec을 재해석하지 않는다. SSE는 15초 heartbeat와 terminal 종료를 제공한다. 브라우저는 인증 헤더를 위해 fetch streaming을 사용한다.

주요 오류는 401 인증, 403 권한, 404 없음, 409 상태 충돌, 413 body 상한, 422 입력/모델 지원 불일치, 503 복구 차단이다.

## 자산

`GET /assets`는 namespace, archived, limit, offset으로 조회한다. `/assets/{id}`, `/metadata`, `/file`로 상세·메타데이터·파일을 읽는다. `POST /assets/{id}/archive`, `/restore`는 복구 가능한 보관이다. `DELETE /assets/{id}`는 보관된 자산에만 허용하며 PNG와 sidecar를 비공개 trash로 이동하고 DB 레코드를 삭제한다. 이 삭제에 대한 API 복원이나 자동 purge는 없다.

## 프롬프트 구성 스냅샷

`prompt_composition.schema_versions: [1,2]`가 지원 버전이다. v1은 계열·compiler 버전·선택 ID/분류/이름/사전 버전/매핑·한글 원문·초안·미변환을 저장한다. v2는 `remainder`에 수락한 번역을 추가한다. 실제 엔진 실행은 최상위 `prompt`를 따르며 서버는 구성에서 prompt를 재컴파일하지 않는다.

| 항목 | 상한 또는 조건 |
| --- | --- |
| 선택 | 100개, ID 중복 금지 |
| 한글 원문 | 4,000자 |
| 초안·최종 prompt | 각각 8,000자 |
| 미변환 | 101개, text 각각 4,000자 |
| 선택 rendered | 300자, mapping 상태와 일치 |
| v2 remainder | 8개, source_ko/suggested_en 각각 200자 |
| 번역 출처 | proposal_id 8..64자, proposal_model 1..200자, accepted_at UTC 초 단위 |
| 구성 전체 | 정규화 JSON UTF-8 32 KiB |
| HTTP body | `max_body_bytes`, 소스 기본값 65,536 bytes |

추가 필드·NUL·계열 불일치 등을 거절한다. 서버는 저장 스냅샷의 ID를 현재 사전과 대조하지 않는다. job spec, 이벤트, asset metadata, sidecar, retry로 전달하며 과거 기록에 없으면 null이다. 경고·sources·자유 입력 방식·적용 지문은 저장 필드가 아니다.

v1 body에 remainder를 넣으면 422다. 클라이언트는 구 서버에서 번역 기록을 제외한 v1을 보내고 누락을 안내하며 최종 prompt는 유지한다. 구성 미지원이면 필드를 생략한다. `request_limits.max_body_bytes`가 없으면 배포별 body 상한을 추정하지 않는다.

## LLM 프롬프트 제안

`POST /prompt/proposals`는 선택적 기능이다. 서버가 유효 사전·gate·LLM 모델 등 제공 조건을 만족할 때만 `prompt_proposals` capability를 광고한다. 버전은 1, 응답 상한은 16 KiB, 서버 timeout은 20초다. 요청 body 상한은 8 KiB다.

요청은 kind, request_id, target_family, dictionary_version, free_text_ko, revisions(scene/selection/text)와 해당 kind의 선택·범위 필드를 갖는다. 한 번의 명시적 요청이며 큐·자동 retry·streaming·일반 제안 이력 저장은 없다.

| kind | 응답과 제약 |
| --- | --- |
| `selection_hint` | 사전 ID와 원문 근거/추론, 미해결·모호성·거절 사유 |
| `partial_change` | target_groups 범위와 locked_ids 준수 |
| `situation_variants` | 장소/행동(pose/setting) 후보 최대 3개. 바뀐/제거 ID, 한글 설명, 미변환 구절 |
| `remainder_translation` | 원문 code-point offset `remainder_spans` 최대 8개를 번역. source_ko/suggested_en/confidence |

상황은 label_ko 40자, prompt_ko 200자, ID 목록 각각 20개 제한이다. 사전 외/비활성/범위 외 ID, 잘못된 diff, actor 귀속 등을 거절한다. 번역은 각 문자열 200자 제한이며 서버가 offset으로 원문을 추출한다. 번역 외 kind에 remainder_spans를 보내지 않는다.

클라이언트는 request_id·kind·revision을 대조하고 timeout에 5초 여유를 더한다. 응답 수신만으로 선택이나 최종 prompt를 바꾸지 않는다. capability 또는 사전 버전 불일치 시 요청하지 않는다. 수락된 번역만 나중에 v2 구성으로 저장될 수 있다.

`unsupported_v1`, `unavailable`은 HTTP 200의 기능 상태다. unavailable은 설정·사전·GPU·gate·upstream·timeout·cancelled·invalid_reply·busy 등의 why와 안내를 갖는다. 인증·크기·형식 오류는 401/413/422로 구분한다. 동시 요청은 credential당 1개, 전체 2개로 제한하며 GPU/scheduler 상태를 읽기만 한다.

## Pixel

`GET/POST /projects`, `GET/PUT /projects/{id}`, `GET/POST /projects/{id}/assets`로 프로젝트와 의미 자산을 관리한다. `POST /assets/{pixel_asset_id}/process`, `/approve?version_id=...`와 `GET /pixel/versions/{id}/file`을 제공한다. Pixel 보관·복원·삭제는 `/pixel/assets/{id}` 아래다. [Pixel Studio](PIXEL_STUDIO.md)의 CPU 처리이며 후보 생성·Atlas export는 지원하지 않는다.

Studio에는 대화 API, 통합 `/prompt/compose`, 구성 v3가 없다. 예정 계약은 [TODO](TODO.md)로 구분한다.
