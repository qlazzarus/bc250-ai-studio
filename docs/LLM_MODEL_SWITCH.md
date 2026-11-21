# 외부 LLM 프로젝트와 모델 전환 경계

LLM 대화와 모델 전환 UI/API의 주 프로젝트는 `bc250-llm-client`다. 이 저장소는 이미지 Studio, gate와 GPU 조율 연동을 담당한다. 외부 프로젝트의 현재 구현·배포 상태는 이 저장소 문서에서 대신 단정하지 않는다.

## 이 저장소에 존재하는 구성

Studio 앱에는 전용 조율 키로 보호된 내부 coordination/recovery 조회가 있다. 공유 GPU 잠금, owned admission, switch journal 관련 설정은 명시적으로 구성해야 하며 기본값이 활성 전환을 의미하지 않는다.

`backend/app/api/model_management.py`, `remote_model_management.py`, `backend/app/services/model_control*`, `gate_candidate.py`, `deploy/model-control/`, `systemd/bc250-model-*` 및 VM 시험 스크립트는 별도 모델 제어 후보 코드다. `app.main:create_app`의 일반 Studio router와 구분한다. 후보의 존재와 부분 테스트를 운영 서비스 설치·검증 완료로 취급하지 않는다.

현재 활성 Studio 배포는 [Actions 배포](ACTIONS_DEPLOYMENT.md)이며 모델 전환 후보의 전체 통합 배포 완료를 전제로 하지 않는다. gate·llama·모델 worker를 자동 교체하거나 재시작하지 않는다.

## 연동 계약

- LLM 클라이언트 서버가 인증과 대화 저장을 담당하고 gate를 경유한다. 브라우저는 llama/gate 제어 키를 받지 않는다.
- 명시적 이미지 요청은 Studio `/jobs`에 `source: rp`, 메시지 식별자는 `client_reference`로 전달할 수 있다.
- gate는 응답을 버퍼링하므로 token streaming을 제공한다고 가정하지 않는다. 불완전한 finish reason과 reasoning만 있는 응답을 완성된 답변으로 표시하지 않는다.
- 공유 잠금은 같은 파일/inode를 사용하는 협조 프로세스만 직렬화한다. 직접 llama 요청과 별도 GPU 작업은 별도 경계다.
- journal·hold·데이터를 삭제해 복구 검사를 우회하지 않는다. 다른 서비스의 hold를 해제하지 않는다.

외부 계획의 위치는 `bc250-llm-client/docs/plans/llm-model-switch-plan.md` 및 `llm-model-switch-design.md`다. imagegen에서 필요한 미완료 연동 검증은 [TODO](TODO.md)에만 관리한다.
