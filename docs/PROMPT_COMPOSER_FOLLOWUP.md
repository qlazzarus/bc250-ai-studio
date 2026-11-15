# Prompt Composer 남은 작업과 회귀 추적

갱신일: 2026-11-15 · 기준: `b98ad81` 이후 capability 회귀 수정.
현재 상태를 이 문서에서 추적한다. 설계와 수동 절차는 [P5 상세](PROMPT_COMPOSER_P5.md), 실제 동작은 [현재 구현](PROMPT_COMPOSER_CURRENT.md), P0–P4 이력은 [작업 계획](PROMPT_COMPOSER_TASKS.md)을 따른다.

상태는 `미착수`, `진행`, `환경 대기`, `설계만`, `로컬 검증 완료`로 구분한다. 로컬 테스트 통과를 브라우저·운영·GPU 완료로 바꾸지 않는다. 항목을 완료 처리할 때 실행 명령, 대상 커밋/환경, 결과와 증거를 추가한다.

## 추적 목록

| ID | 우선순위 / 상태 | 남은 작업과 다음 행동 | 완료 기준 |
| --- | --- | --- | --- |
| P5-R01 | 높음 / 로컬 검증 완료 | max_body_bytes 없는 최소 설정에서 capability 전체가 실패하는 회귀 수정. optional 한도는 없으면 생략 | 기존 coordination 조건 3종을 한도 없음/1024/131072에서 검증. 관련 94건 통과, 아래 기록 |
| P5-R02 | 높음 / 미착수 | 사용자가 실패를 관찰한 실행 환경에서 수정 커밋으로 원래 회귀 명령 재실행. 원래 129건의 명령/환경과 새 결과를 함께 기록 | 동일 실행 범위에서 실패 없음. 로컬 94건으로 사용자 환경 전체 통과를 대체하지 않음 |
| P5-C01 | 높음 / 환경 대기 | 브라우저 연결 복구 후 검색·필터 밖 선택·칩 해제·전체 비우기·stale·덮어쓰기 취소·원문 반복 적용·직접 수정 검증 | [P5-C 절차](PROMPT_COMPOSER_P5.md)의 해당 행별 실행 결과 기록 |
| P5-C02 | 높음 / 환경 대기 | 로컬 Fake/fixture로 다른·같은 계열 전환, capability 실패/미지원, 과거 재사용, retry, 422/413 경로 확인 | 최종 입력·설정·applied 보존과 오류 표시를 실제 화면에서 확인 |
| P5-C03 | 중간 / 환경 대기 | 키보드·포커스·오류 연결, 360/390px 및 200% 확대 점검 | 조작 불가/겹침/가로 넘침 이슈 해결과 관찰 기록 |
| P5-L01 | 높음 / 미착수 | P5-C 및 원래 회귀 통과 후 운영 배포·롤백 검증 준비. 구 서버 capability 누락, 새/구 이력 읽기, 실제 HTTP 한도와 프록시 한도 점검 | 대상 릴리스·백업·배포/복구 절차 및 실행 결과 기록. 현재 미배포 |
| P5-D01 | 중간 / 설계만 | 자유 입력 반영 방식·적용 당시 문자열/fingerprint·renderer/provenance 영속화 계약 검토 | 구 데이터 unknown 처리·구 클라이언트 호환·마이그레이션 대안 제시. 저장 계약 변경 전 승인 |
| P6-Q01 | 중간 / 설계만 | 기존 compiler 재사용 및 체크포인트별 renderer profile 설계 구체화 | 기본/미지원 처리와 구 snapshot 보존 테스트 계획. 전면 전환은 별도 구현 |
| P6-Q02 | 중간 / 미착수 | 12개 대표 장면 × seed 17/42/123의 기존/후보 비교. 지원 모델과 설정을 먼저 확정 | 체크포인트/엔진/설정/실제 seed·이미지·실패·사용자 평가 기록. GPU 실행 전 품질 우위 주장 금지 |
| P6-T01 | 중간 / 설계만 | 원문을 포함한 전체 최종 prompt의 모델별 토큰 검사와 길이 경고 개선 | 실제 토크나이저·엔진 잘림/분할 규칙 확인 후 검증. 현재 SD 1.5 단어 수 근사치의 한계를 유지 표시 |
| P7-S01 | 후속 / 설계만 | Scene v2 actor별 속성·관계·공통 배경·v1 unassigned 보존 설계 | 스키마 변경 이유·영향·변환/복구 계획 승인 후 구현 |
| P7-I01 | 후속 / 설계만 | 참조 이미지·ControlNet/IP-Adapter/img2img의 자산·권한·엔진 계약 검토 | 업로드/전처리/모델 지원/GPU 메모리 검증. 프롬프트 문자열만으로 지원 완료 처리하지 않음 |
| P8-L01 | 후속 / 설계만 | 명시적 LLM 번역/보강 제안과 적용/거부, Client/gate 연결 설계 | 실패 시 원문·사전/직접 생성 보존, 응답 검증 및 GPU 전환 검증 |
| TEST-D01 | 낮음 / 미착수 | Starlette TestClient의 httpx 사용 중단 예정 경고 검토 | 호환 버전·lock 변경 및 관련 API 회귀 검증. 경고 숨김으로 완료하지 않음 |

다음 실행 순서: P5-R02 → P5-C01/C02/C03 → P5-L01. P6–P8 설계는 병행 검토할 수 있으나 운영·GPU 검증을 완료로 표시하지 않는다. 기존 승인 범위 밖의 스키마 변경은 별도로 보고한다.

## P5-R01 원인과 수정 기록

사용자 보고: `test_studio_advertises_coordination_only_for_complete_configuration`에서 `AttributeError: SimpleNamespace ... max_body_bytes`, **1 failed, 128 passed, 1 warning**. 원래 실행 명령과 환경은 보고에 포함되지 않았다.

로컬에서 `backend/tests/test_coordination_capability.py` 실행으로 **1 failed, 6 passed**를 재현했다. P5에서 추가한 `s.settings.max_body_bytes` 직접 접근이 최소 설정 객체에도 새 속성을 강제한 것이 원인이다. 앞선 P5 관련 40건 검증에는 이 coordination 파일이 포함되지 않아 놓쳤다.

수정:

- `backend/app/api/routes.py`: 설정에서 HTTP 한도를 읽을 수 없으면 `request_limits`를 생략한다. 임의의 64 KiB 기본값을 광고하지 않는다. 실제 Settings가 제공하는 한도는 그대로 반환한다. BodyLimit의 서버 강제 검증은 변경하지 않는다.
- `backend/tests/test_coordination_capability.py`: 기존 조율 활성/잠금 경로/owned-hold 조건 검사를 유지하고, 한도 없음·1024·131072 세 경우를 매개변수화한다. 한도 누락이 구성 capability와 coordination을 깨지 않고 설정된 값을 그대로 광고하는지 검사한다.

2026-11-15 로컬 macOS 검증:

```sh
.venv/bin/python -m pytest \
  backend/tests/test_coordination_capability.py \
  backend/tests/test_prompt_composition.py \
  backend/tests/test_api.py \
  backend/tests/test_gate_admin.py \
  backend/tests/test_gpu.py \
  backend/tests/test_gpu_owned_holds.py \
  backend/tests/test_model_switch_recovery_endpoint.py \
  backend/tests/test_studio_independence.py -q

.venv/bin/ruff check backend/app/api/routes.py backend/tests/test_coordination_capability.py
git diff --check
```

결과: **94 passed, 1 warning, 5.75초**, ruff 및 diff 검사 통과. 프런트 코드 변경 없음. 이번에는 브라우저 연결 재시도·운영 배포·GPU 생성·전체 저장소 회귀를 수행하지 않았다. 앞선 프런트 29건/백엔드 40건 결과는 당시 기록이며 이번 94건과 합산하지 않는다.
