# P0: 프롬프트 구성 계약 조사 및 결정

작성일: 2026-11-15 · 상태: **로컬 코드 조사와 설계 결정 완료**. 구현·마이그레이션·배포·BC-250 실기 검증은 수행하지 않았다. 작업 목록: [프롬프트 구성 작업 계획](PROMPT_COMPOSER_TASKS.md). 설계 원칙: [이미지 생성 모드 발전 계획](GENERATION_MODES_DESIGN.md).

## 범위 결정

프롬프트 구성은 SD 1.5 전용이 아니다. 사전 선택, 한국어 입력, 편집, 확인 및 작업 제출은 모든 모델에 공통으로 제공한다. 모델별 규칙은 해당 family 또는 명시된 모델에만 적용한다. SD 1.5의 태그형, Z-Image·FLUX.2 Klein·MOSS의 자연어형은 출발 전략이며, 실제 프롬프트 효과나 품질을 검증했다는 뜻이 아니다. 포즈와 ControlNet/IP-Adapter의 첫 검증 대상만 SD 1.5로 제한한다.

MVP에서 모든 현재 모델을 선택할 수 있도록 공통 UI·스키마와 컴파일러 진입점을 만든다. 각 계열의 초기 매핑이 없는 사전 항목과 한국어 자유 입력은 미변환으로 표시하고 사용자가 직접 수정할 수 있다. 미지원 계열에 다른 계열의 규칙을 몰래 적용하지 않는다. Fake 모델은 API/UI 시험용이며 이미지 품질을 증명하지 않는다. LLM과 캐릭터 프로필은 MVP의 필수 의존성이 아니다.

## 현재 코드 근거

| 항목 | 확인된 동작 |
| --- | --- |
| 요청 | `backend/app/models/schemas.py`의 `JobRequest`는 `extra="forbid"`. `prompt` 1~8000자, `negative_prompt` 최대 4000자이며 NUL과 공백만 있는 prompt를 거부한다. 지금 임의 구성 메타데이터 필드를 보내면 422다. |
| 접수 | `backend/app/api/routes.py`의 `POST /jobs` → `Registry.resolve`가 모델·옵션·해상도를 검증하고 preset과 seed를 확정해 `enqueue`한다. 응답은 202와 job ID/status다. |
| 저장 | `backend/app/models/database.py`의 `jobs.spec`은 JSON. 모델 스냅샷과 확정 설정을 함께 보관한다. `job_dict`와 response model `JobView`가 조회를 구성한다. durable SSE event에도 `job_dict` 전체가 저장된다. |
| retry | 실패·중단·취소 작업만 `copy.deepcopy(job.spec)`으로 새 job을 만든다. 사전이나 registry를 재해석하지 않는다. 완료 작업 재시도 API는 없다. |
| 결과 | `backend/app/scheduler/runner.py`가 각 결과별로 `job.spec`에 seed 등 결과 정보를 합쳐 JSON sidecar 및 `assets.details`에 저장한다. `/assets/{id}/metadata`는 details를 반환하며 과거 sampler/scheduler만 null 보정한다. |
| 모델 옵션 | `config/models.yaml`의 family는 `sd15`, `z-image`, `flux2`, `moss-image`, `fake`가 있다. `/models`의 family 및 `generation_options`가 입력 정책을 표시한다. negative prompt는 옵션 mode 및 CFG 조건을 서버에서 다시 검증한다. |
| 실행 prompt | 일반적으로 확정 `prompt`를 실행에 사용한다. `sdcpp.py`의 `effective_prompt`는 활성 운영자 설정 LoRA에 대해 트리거와 태그를 실행 직전에 추가할 수 있다. 저장된 사용자 prompt는 원문이며 실행 문자열과 항상 동일하지 않다. |
| 크기·보안 | `BodyLimit` 기본값은 65,536 bytes이며 설정 가능하다. 인증은 기존 Studio 공통 모델이고 클라이언트 간 자산 가시성을 분리하지 않는다. job 응답, SSE, DB·sidecar에 이력이 복제될 수 있다. |
| 현재 UI | `frontend/src/App.tsx`는 직접 입력 prompt를 `/jobs`에 보낸다. `frontend/src/api.ts` 타입의 구성 이력 필드는 아직 없다. 과거 결과 재사용은 `AssetMetadata`의 확정 문자열을 복원한다. |

[API 계약](API.md) 및 [모델 레지스트리](MODELS.md)의 과거 서술은 현재 코드와 차이가 있을 수 있다. 예를 들어 MOSS는 `config/models.yaml`에 이미 포함되며 자세한 LoRA 동작은 [MOSS 통합](MOSS_IMAGE_INTEGRATION.md)을 참고한다. 이 조사만으로 현재 운영 서버의 배포 버전·설정이나 실제 모델 파일 상태를 확인한 것은 아니다.

## P0 결정: 저장 및 호환성

P4에서 **선택적 `prompt_composition` 객체를 job spec에 포함**한다. `JobRequest`와 `JobView`에 명시적으로 추가해 검증하고 `Registry.resolve`가 스냅샷으로 보존하도록 한다. 결과의 `assets.details`와 sidecar에도 현 작업 저장 흐름을 통해 전달되도록 명시적으로 검증한다. 별도 테이블은 MVP에 필요하지 않다. 이 기록은 설명용이며 실제 실행 값은 별도의 최종 `prompt` 및 모델 snapshot이다. 구성 데이터로 임의 경로, 모델 설정 또는 CLI 인자를 유도하지 않는다.

```json
{
  "prompt": "사용자가 확정한 최종 문자열",
  "prompt_composition": {
    "schema_version": 1,
    "dictionary_version": "1",
    "compiler_version": "1",
    "target_family": "sd15",
    "selections": [{"id": "lighting.soft", "label_ko": "부드러운 조명", "rendered": "soft lighting"}],
    "free_text_ko": "창가에 서 있는 인물",
    "draft_prompt": "soft lighting, ...",
    "unresolved": ["창가에 서 있는 인물"]
  }
}
```

예시는 필드 의미를 보여주는 초안이다. 실제 P4 구현은 각 선택에 category, dictionary_version, mapping_status, rendered를 저장하며 사전 버전은 선택별로 보존한다. 실제 계약은 [API 문서](API.md)와 스키마를 따른다. 사용자 최종 수정본은 최상위 `prompt`가 단일 기준이다. 모델 변경으로 컴파일 결과와 제출 대상이 달라질 경우 사용자 확인과 재컴파일/직접 확정을 요구하고, `target_family`는 제출 당시 선택 모델과 일치하도록 검증한다. 이력은 사용자가 제공한 설명이므로 최종 텍스트가 초안과 의미상 동일하다고 보장하지 않는다. MOSS 등의 실행 직전 트리거는 기존 model snapshot과 엔진 규칙을 기준으로 설명한다. 엔진 유효 프롬프트의 별도 영속화는 구현 시 민감정보와 변경 영향을 검토하며 이번 결정에서 이미 저장된 것으로 간주하지 않는다.

- **검증과 제한:** schema version 1만 허용하고 객체 외 추가 필드를 거부한다. 제안 상한: 선택 항목 100개, ID 100자, 라벨/표현 각 300자, 원문 4000자, 초안 8000자, 미해결 항목 100개·각 300자. 직렬화한 객체 UTF-8 32 KiB 이하, 전체 HTTP 요청은 설정된 기존 BodyLimit 이하다. 경계는 구현 시 JSON 인코딩과 다국어 입력을 포함해 검증하며 운영 제한이 더 작으면 그 제한이 우선한다. 초과 시 422 또는 기존 body limit의 오류를 명확히 보여주고 자르지 않는다.
- **구형 호환:** 필드 생략/`null`은 직접 입력 또는 이력 없음. 기존 요청은 그대로 유효하며 구형 job 및 asset은 `null`로 읽도록 응답 계층에서 보정한다. 과거 데이터는 일괄 수정하지 않는다. 기존 클라이언트가 새 응답 필드를 무시하는지 테스트한다. SSE에도 같은 정보가 포함되므로 크기와 기존 소비자 호환을 확인한다.
- **retry 및 이력:** retry는 원래 spec의 깊은 복사를 유지한다. 사전·컴파일러·모델 기본값 변경에도 재컴파일하지 않는다. batch의 각 asset은 동일 구성 스냅샷과 개별 seed를 갖는다. asset 재사용 시 과거 스냅샷을 복원하되 사전 버전이 더 이상 없으면 저장된 당시 표현과 최종 prompt를 보여주고 재구성 여부를 사용자가 선택한다.
- **개인정보:** 이력은 기존 인증 경계에서 job 조회, 이벤트, asset metadata 및 sidecar에 노출·복제된다. 현 시스템은 다중 사용자 격리가 아니므로 비밀 입력 전제가 아니다. 이벤트 크기와 프롬프트 로그·백업·삭제 정책을 구현 전 확인한다. 초안의 브라우저 영속 저장은 MVP에 포함하지 않으며, 페이지 이탈 시 입력 손실을 알리고 명시적으로 처리한다.

## 전개 및 검증

DB 컬럼은 기존 JSON을 사용하므로 제안 자체에 DB 스키마 변경이 필요하지 않다. 다만 실제 구현 후 마이그레이션 필요 여부는 테스트와 배포 환경으로 확인한다. 배포는 **서버 먼저**, 새 필드를 이해하는 서버 확인 후 프런트엔드를 배포한다. 구 서버는 `extra=forbid`로 새 요청을 거부하므로 프런트엔드가 새 필드를 무조건 전송하면 안 된다. 서버 capability를 명시적으로 탐지하고 미지원일 때 기존 직접 prompt 제출로 돌아가되, 구성 이력이 저장되지 않는다는 점을 사용자에게 알린다. 롤백 시 새 필드가 들어간 기존 job을 구 `JobView`가 정상 처리하는지, retry와 SSE 및 asset metadata가 유지되는지 롤백 후보 빌드로 사전 검증한다. 검증되지 않으면 데이터 백업과 호환 버전 유지 방안을 정한 뒤 배포한다.

P1~P5 구현에서 다음을 확인한다.

1. 모든 현재 family에서 모델 선택·미매핑 경고·직접 편집이 가능하고, SD 1.5 규칙이 다른 family로 누출되지 않는다.
2. 예전 요청과 예전 DB job/asset, 구 클라이언트 응답, 새 클라이언트/구 서버 조합이 안전하게 동작한다.
3. 요청 크기, 구조, version, 모델 일치, Unicode 및 누락 필드를 검증하고 오류 시 사용자 입력을 보존한다.
4. Fake Engine에서 생성·batch·SSE·metadata·retry와 사전 변경 후 이력 보존을 확인한다. GPU 점유 및 복구 흐름은 변경하지 않는다.
5. 배포 대상의 실제 코드·서버 설정·모델 파일·body limit과 운영 절차를 확인한다. Fake 테스트는 BC-250 품질·호환성 근거가 아니다.

이 결정은 로컬 코드 기준이다. 실제 운영 배포 버전과 롤백 바이너리 검증은 구현·배포 시점의 미완료 선행 확인 사항이다.
