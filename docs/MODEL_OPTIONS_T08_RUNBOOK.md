# T08 — BC-250 PornMaster 옵션 실기 검증 절차

작성일: 2026-10-26  
승인 범위: 사용자가 BC-250에서 직접 배포·명령 실행. 이 문서는 명령과 기록 기준만 제공한다.

## 고정 범위

- 대상: `pornmaster-klein-9b`
- 프롬프트: `A ceramic teacup on a wooden table, studio lighting, safe-for-work, no people`
- 해상도: 512×512
- steps: 4 (현재 Registry가 이 모델의 steps 변경을 허용하지 않음)
- sampler: Registry 고정 Euler, scheduler 생략
- seed: `4242`
- 이미지: 조합당 1장, 총 최대 4장
- 조합: CFG `1.0`, `1.5`, `2.0` (negative prompt 없음), CFG `2.0` + `avoid blur, low contrast`
- 정책: 테스트 중 `manual`; 각 작업에만 명시적으로 grant

CFG 1.5/8 steps는 제작자 자료의 후보이지만 현재 API Registry에서는 steps가 4로 고정되어
있다. 이 T08에서 임의 config 수정이나 직접 `sd-cli` 우회를 하지 않는다.

## 중단 조건

다음 중 하나가 발생하면 이후 조합을 제출하지 않는다.

- `/models`에서 PornMaster가 `execution_enabled: true`가 아님
- Studio 상태가 `recovery_required: true`이거나 job 실패
- terminal job 뒤 LLM service/gate health가 원래 정상 상태로 돌아오지 않음
- 결과 PNG 또는 metadata가 없거나, metadata의 resolved CFG/negative prompt가 요청과 다름

실패 시 job ID, `/system/status`, job JSON, asset metadata, Studio/LLM journal을 보관하고
`/system/recover` 또는 LLM unit을 임의로 재시작하지 않는다. 상태가 안전하지 않은 경우에는
운영자가 원인을 확인한 뒤에만 별도 복구 절차를 수행한다.

## 필수 기록

각 조합마다 다음을 기록한다.

- 제출 payload 및 terminal job JSON (job ID, resolved option, model snapshot)
- asset ID와 metadata, PNG 파일 식별/크기
- Studio journal의 `sd-cli` 실행 및 LLM pause/stop/start/health/resume 구간
- 시작/완료 시각, GPU memory 상태가 verified이면 그 값
- LLM unit `ActiveState`, `MainPID`, `ControlGroup`, gate health

성공은 API·argv·파일·복구 흐름의 성공일 뿐, 주관적 이미지 품질의 최종 승인을 뜻하지 않는다.
실행 결과를 받은 뒤에만 `MODEL_OPTIONS_PROGRESS.md`의 T08 완료 상태와 모델 capability
검증 상태를 갱신한다.
