# 현재 아키텍처

BC-250 AI Studio는 FastAPI와 React/Vite로 구성된 단일 사용자 이미지 생성 서비스다. 기본 엔진은 `fake`, 기본 정책은 `manual`이다. 실제 이미지 실행은 `sdcpp` 어댑터가 담당한다.

## 구성 요소

| 위치 | 책임 |
| --- | --- |
| `backend/app/main.py` | Studio 앱 생성, 인증된 문서, lifespan, DB·스케줄러 초기화 |
| `backend/app/core/studio_config.py` | `STUDIO_*` 환경 설정과 검증 |
| `backend/app/api/routes.py`, `proposals.py` | 작업·자산·Pixel·정책 API와 LLM 프롬프트 제안 |
| `backend/app/models/`, `backend/alembic/` | 요청 스키마, SQLite/SQLAlchemy 영속 데이터와 마이그레이션 |
| `backend/app/scheduler/` | 단일 큐 작업자, 배치 항목별 결과, 취소·재시도 |
| `backend/app/services/gpu.py`, `llm.py` | GPU 잠금, LLM pause·drain·정지·복구 |
| `backend/app/engines/` | Fake PNG와 stable-diffusion.cpp 프로세스 실행 |
| `backend/app/services/registry.py`, `config/models.yaml` | 신뢰된 모델 경로, 프리셋, 지원 옵션 |
| `backend/app/pixel/` | Pillow 파생 버전 처리 |
| `frontend/src/` | 직접 입력, 프롬프트 구성기, 큐·갤러리, Pixel 화면 |
| `backend/app/gate.py` | 별도 프로세스로 실행하는 LLM admission proxy |

## 요청과 저장

브라우저 → 인증된 `/api/v1` → 모델 설정 해석 → 영속 작업 큐 → GPU 조율 → 엔진 실행 → 자산·이벤트 저장 순서다. LLM 제안은 별도 인증 API에서 gate를 통해 요청하며 이미지 큐에 넣지 않는다.

제출 설정과 모델 스냅샷, 실제 seed, 배치별 결과, 이벤트, 이미지와 JSON 메타데이터를 보존한다. retry는 원래 spec을 복사하며 현재 모델 기본값으로 재해석하지 않는다. SSE는 영속 이벤트 ID로 재연결한다. 재시작 시 실행 중이던 작업은 interrupted로 복구하고 완료 이미지와 배치 부분 성공은 유지한다.

데이터는 checkout 밖의 `STUDIO_DATA_DIR`에 저장한다. 기본값은 `~/.local/share/bc250-ai-studio`, 서버 템플릿은 `/opt/ai-studio-data`다. 모델 파일은 운영자 설정 경로에서 읽는다. 사용자 요청으로 임의 모델 경로나 셸 명령을 받지 않는다.

## 동시 실행과 복구

데이터 디렉터리 instance lock과 단일 스케줄러를 사용하므로 Uvicorn worker는 1개다. 별도 GPU 파일 잠금은 협조하는 프로세스 사이의 동시 점유를 막는다. 외부 비협조 GPU 프로세스까지 통제하지는 않는다.

실제 이미지 실행은 LLM 새 요청 pause → 진행 요청/slots drain → 허용된 LLM 서비스 정지 → 이미지 실행 → LLM 시작·health 확인 → admission 재개 흐름이다. 서비스 변경 전 transition journal을 기록한다. 불명확한 상태나 복구 실패는 GPU 작업을 차단하며 관리자 복구가 필요하다. 출력 파일 존재와 LLM 복구 성공은 별개다.

| 정책 | 동작 |
| --- | --- |
| `manual` | 관리자가 큐 작업 하나를 허가 |
| `chat_priority` | 이미지 작업 후 채팅 복구, 대기 채팅이 있으면 배치 이미지 경계에서 양보 |
| `image_priority` | 큐가 빌 때까지 이미지 lease 유지, 정책 변경은 안전한 경계에서 처리 |

## 인증과 서비스 경계

일반 API 키와 관리자 키를 분리한다. 클라이언트 키 사용자는 작업·자산 가시성을 공유한다. `namespace`는 결과 분류이며 사용자별 접근 격리가 아니다. 프런트의 빌드 키는 브라우저 번들에 포함된다.

Studio 앱은 기본 작업 router와 proposals router를 등록한다. 별도 모델 관리 후보 모듈과 systemd 파일이 저장소에 존재해도 Studio의 공개 모델 전환 기능으로 간주하지 않는다. Studio에는 전용 조율 키로 보호된 `/internal/model-switch/coordination`, `/internal/model-switch/recovery`가 있으며 필요한 설정과 gate identity가 맞을 때만 활성 상태를 보고한다. 상세 경계는 [LLM 프로젝트](LLM_MODEL_SWITCH.md), 남은 기능은 [TODO](TODO.md)를 따른다.
