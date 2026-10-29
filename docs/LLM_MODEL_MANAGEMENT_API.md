# LLM 모델 관리 API 계약 후보

이 API는 별도 127.0.0.1:8091 HTTP 서비스와 Unix 소켓을 거치는 root 단일 작업자로 연결한 배포 후보입니다. 현재 운영 서버에는 설치되지 않았으며 전환은 기본적으로 꺼져 있습니다. 배포 전에 실제 systemd·권한·gate 이전·SELinux 및 복구를 검증해야 합니다. [수동 배포 구성 초안](./LLM_MODEL_SWITCH_DEPLOYMENT_DRAFT.md)을 참고하세요.

## 인증과 권한

client 백엔드는 전용 모델 관리 키를 `Authorization: Bearer <관리 키>`로 전달합니다. 키는 24자 이상이어야 하며 Studio 사용자·관리자 키와 gate 키와 별도로 생성해야 합니다. 키 값은 이 문서, URL, 브라우저 코드나 로그에 넣지 않습니다. 현재 후보는 한 명의 관리자용 공용 주체를 사용합니다. client 백엔드에서 사용자를 인증하고 관리자만 전환하도록 제한해야 하며, 사용자 ID별 격리는 아직 없습니다. 향후 계획은 [사용자 ID별 격리 TODO](./USER_ISOLATION_TODO.md)를 참고하세요.

이 키는 운영 서비스 조립 시 별도 저장·전달 방식을 정하고 다른 키와 다름을 검증해야 합니다. 모델 관리 API를 인터넷에 직접 노출하거나 일반 사용자에게 관리 키를 전달하지 않습니다.

## 모델 목록

`GET /api/v1/llm/models`

```json
{"models":[{"name":"example","current":true},{"name":"other","current":false}],"current":"example"}
```

`name`과 `current`는 관리용 이름입니다. 추론 API `/v1/models`의 GGUF 경로 ID를 전환 요청에 사용하지 않습니다.

## 모델 전환 요청

`POST /api/v1/llm/switches`

헤더에 `Idempotency-Key: <고유 요청 키>`를 넣고 다음과 같이 보냅니다.

```json
{"model":"other"}
```

응답은 HTTP 202와 다음 형태입니다. `id`는 조회용 작업 ID입니다.

```json
{"id":"0123456789abcdef0123456789abcdef","model":"other","state":"queued","error_code":null,"created_at":"2026-01-01T00:00:00+00:00","updated_at":"2026-01-01T00:00:00+00:00"}
```

같은 키와 모델을 다시 보내면 같은 작업이 반환됩니다. 같은 키에 다른 모델을 지정하거나 다른 전환이 진행·복구 중이면 409입니다. 모델 이름은 영문자·숫자·밑줄·하이픈만 허용하고 설치 목록에서 확인합니다. 셸 명령, 파일 경로와 추가 필드는 허용하지 않습니다. 요청 본문은 4096바이트로 제한합니다.

## 진행과 결과 조회

`GET /api/v1/llm/switches/{id}`는 위와 같은 형식의 최신 작업을 반환합니다. 주요 상태는 다음과 같습니다.

| 상태 | 의미 |
| --- | --- |
| `queued`, `waiting_for_gpu` | 접수됨, GPU 사용 대기 |
| `pausing`, `draining` | gate 일시정지 및 진행 중 요청 완료 대기 |
| `switching`, `verifying` | 모델 전환 및 서비스·모델 health 확인 |
| `rolling_back` | 이전 모델 복구 중 |
| `succeeded` | 정상 완료 |
| `failed`, `failed_rolled_back` | 실패 또는 이전 모델 복구가 확인된 실패 |
| `recovery_required` | 결과가 불확실하여 관리자 복구가 필요함. 새 전환을 차단 |

`error_code`는 제한된 오류 코드 또는 `null`이며 내부 명령 출력과 비밀값을 포함하지 않습니다. 현재 수동 복구 API는 없습니다. 운영 서비스와 복구 절차가 준비되기 전까지 별도로 조작하지 않습니다.

이전 모델 복구가 확인된 `failed_rolled_back`에는 `drain_timeout`, `restart_failed`, `health_timeout` 또는 `service_unavailable`이 표시될 수 있습니다. `recovery_required`는 복구 완료가 확인되지 않은 상태입니다. journal 없는 중단을 관리자가 현재 상태 검증 후 정리한 경우 `failed`와 `interrupted`를 반환하며, 이전 모델로 롤백했다고 주장하지 않습니다.

## 오류

- 401: 관리 키 누락 또는 불일치. 응답 `{"code":"invalid_credential"}`.
- 409: `idempotency_conflict` 또는 `switch_busy_or_recovery_required`.
- 422: 모델·키 형식, 요청 본문 또는 설치 목록 오류. 입력 검증 방식에 따라 FastAPI의 `detail` 또는 `{"code":"invalid_model_or_key"}` 형식이 반환됩니다.
- 404: 없는 작업 ID 또는 이 관리 주체에 속하지 않는 작업.
- 413: 본문 크기 초과.
- 503: 작업자·목록 조회 불가. 응답 `{"code":"service_unavailable"}`.
- 503: 전환 기능이 설정에서 꺼져 있으면 `{"code":"switch_disabled"}`.

후보 API는 접수 후 root 작업자에서 작업을 백그라운드로 진행합니다. HTTP 연결이 끊겨도 작업은 계속됩니다. 프로세스 재시작 시 전환이 활성화되어 있으면 대기 중이던 작업은 다시 실행하고, 진행 중이던 작업은 기록을 대조해 복구가 필요하면 새 전환을 막습니다. 보류 중인 gate 재시작 또는 다른 GPU 복구를 발견하면 `failed`와 `admission_blocked`를 반환합니다. 실제 systemd·GPU 환경의 강제 종료 시험은 아직 남아 있습니다.
