# LLM 모델 전환 문서 안내

정리일: 2026-11-07. **모델 전환 UI/API의 주 프로젝트는 bc250-llm-client다.** imagegen은 이미지 Studio이며, 이곳에서 작성한 모델 전환 후보는 필요한 부분을 Client로 이관·재사용한다.

현재 목표·현황·이관 목록·API 초안·M0~M8 실행 계획·완료 조건은 **[LLM Client 모델 전환 통합 계획](../../bc250-llm-client/docs/plans/llm-model-switch-plan.md)** 한 곳에서 관리한다. 해당 링크는 두 저장소를 같은 부모 디렉터리에 둔 로컬 작업 공간 기준이다. 개별 저장소만 열었다면 bc250-llm-client의 `docs/plans/llm-model-switch-plan.md`를 참조한다.

## 현재 결정

- 목표: Client UI → Client API → 제한된 서버 실행부 → 기존 ai-model과 호환되는 제어 → llama-server 모델 전환 → 후속 대화 성공.
- 진행: 사용자가 제공한 운영 ai-model 원문 분석 완료. [CLI/API 공용 실행부 상세 설계](../../bc250-llm-client/docs/plans/llm-model-switch-design.md)를 작성했다. 다음 작업은 unit·계정·gate/GPU 계약 확인과 상세 설계 확정(M1·M2)이며 기능 구현은 아직 시작하지 않았다.
- 기존 후보는 일부 활성 설정 직접 쓰기, ai-studio UID, Studio 사전 검사에 결합돼 있으므로 통째로 복사하거나 설치하지 않는다.
- Imagegen은 필요한 gate·GPU 조율 연동만 담당한다. Studio DB 이전이나 통합 배포 T1~T6 완료는 Client 기능의 기본 선행 조건이 아니다.
- 과거 코드·시험·미커밋 작업은 보존한다. 새 경로 검증 후 중복 실행부와 오래된 entrypoint를 정리한다.

## 과거 문서를 읽는 방법

`LLM_MODEL_SWITCH_*`, `LLM_MODEL_MANAGEMENT_API.md`, `BC250_SERVICE_INVENTORY.md`, `NEXT_PROJECT_LLM_CLIENT.md`의 상단 안내와 통합 계획을 먼저 읽는다.

“이번 범위는 API까지”, “Client 화면 제외”, “운영 모델 전환 제외”, “다음 우선 작업은 DB 지속 차단”은 **이전 계획의 범위**다. 현재 작업 지시로 사용하지 않는다. T1~T6의 진행률은 과거 배포 후보 기준이며 사용자 기능 완성률이 아니다.

다만 과거에 발견된 GPU 경합, 인증 불일치, 복구 불명, 파일 권한·SELinux 등의 실제 문제는 채택한 구현과 관련되면 해결해야 한다. 새 계획은 미완료 후보를 안전하거나 검증 완료된 것으로 바꾸지 않는다.

상세 조사 경위는 [방향 검토 기록](LLM_MODEL_SWITCH_DIRECTION_REVIEW.md)에 보존한다. 이후 현재 상태와 다음 작업은 통합 계획만 갱신한다.

## Imagegen에서 마무리할 작업

모델 전환 개발은 Client로 인계하되, Studio 배포는 아직 비활성이다. [AI Studio 개발·배포 재개 검토](STUDIO_RESUME_REVIEW.md)의 S0~S5로 작업 보존·의존 분리·배포 복구를 마무리한다. 문서 인계가 코드 이관이나 운영 원복 완료를 뜻하지 않는다.
