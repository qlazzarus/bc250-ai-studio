# MOSS-Image 통합 (2026-10-26)

## 변경 사항

- `config/models.yaml`: 기존 7개 정의를 그대로 보존하고 `moss-image-nsfw` 추가.
- `backend/app/services/registry.py`: 선택적 `tokenizer_path`, `flow_shift`, `lora`
  스키마와 필수 파일 검증. MOSS는 tokenizer와 flow shift 필수이며 다른 family에는
  이 두 필드를 허용하지 않는다. 활성 LoRA 파일은 `missing_files: ["lora.path"]`로 보고한다.
- `backend/app/engines/sdcpp.py`: MOSS에 tokenizer/flow shift 전달, 설정 기반 LoRA 처리,
  대기 중 파일이 삭제되는 경우 실행 전 재검증.
- `frontend/src/api.ts`, `frontend/src/App.tsx`: 선택적 프리셋 검증 상태와
  `experimental` 표시. 모델 선택 목록은 기존 `/api/v1/models` 응답을 그대로 사용한다.
- `backend/tests/test_moss.py`: 설정/인자/LoRA/파일/기존 모델/큐 통합 테스트.
- `backend/tests/test_api.py`: 모델 개수를 7에서 8로 갱신.

## 모델 설정과 실행

모델 루트는 `/opt/sd-models/moss-image`이며 diffusion Q4_K, Qwen3.5 Q4_K_M,
FLUX.2 VAE, 전용 tokenizer와 NSFW LoRA F16을 사용한다.
사용자가 제공한 실측 기록에 따라 `balanced`만 `tested`로 표시했다.
검증 범위는 512×512, 20 steps, CFG 3, Euler, flow shift 5, LoRA 0.7이다.
`fast`(512×512, 12 steps)와 `quality`(768×768, 20 steps)는 `experimental`이다.
사용자가 해상도/steps/LoRA 태그 강도를 변경한 조합은 이 실측 범위에 포함되지 않는다.

MOSS CLI에는 다음 옵션을 전달한다. 파일 경로는 모두 모델 설정에서 읽는다.

```text
--diffusion-model MODEL --llm ENCODER --vae VAE
--tokenizer TOKENIZER --flow-shift 5.0 --lora-model-dir LORA_DIRECTORY
-p "moss_xvstyle USER_PROMPT <lora:MOSS-Image-NSFW-Uncensored-LoRA-F16:0.7>"
-W 512 -H 512 --steps 20 --cfg-scale 3.0 --seed SEED -o OUTPUT
--backend Vulkan0 --sampling-method euler --scheduler discrete
```

LoRA 태그 이름은 파일 basename에서 마지막 확장자를 제거해 만든다. 트리거는 단어
경계로 확인하고, 동일 LoRA 이름의 태그가 이미 있으면 사용자가 입력한 강도를 유지한다.
원본 프롬프트는 작업/메타데이터에 보존하며 실행 직전에만 변환한다. 동결된
`model_snapshot`으로 재시도 시 설정을 재현한다. `lora.enabled: false`로 설정하면
자동 트리거/태그/디렉터리 옵션을 모두 생략하고 LoRA 파일 존재 여부도 검사하지 않는다.
이는 자동 적용을 끄는 설정이며 사용자가 직접 작성한 프롬프트는 삭제하지 않는다.

## 기존 작업 큐와 GPU 관리

큐, FastAPI, GPU 관리자, 결과 저장 코드는 수정하지 않았다. 기존 흐름은 admission gate
일시 정지 → LLM 요청 drain → 실행 중인 LLM 중지 → cgroup 종료 확인 → 메모리 확인 →
이미지 생성/PNG 검증/메타데이터 저장 → 정책에 따른 LLM 복구다.
`image_priority`에서 다음 작업이 있으면 GPU 소유권을 유지할 수 있다.
원래 중지되어 있던 LLM은 새로 시작하지 않는다.

메모리 수치는 `STUDIO_GPU_MEMORY_USED_PATH`와 기존 idle limit 설정이 있을 때만
검증된다. 경로가 없으면 `verified: false`이며 VRAM 확보를 수치로 보증하지 않는다.
새 서비스 관리 체계나 다른 AI 서비스의 자동 중지는 추가하지 않았다.

결과는 기존 `STUDIO_DATA_DIR/outputs/<source>/<job_id>/`에 저장한다.
독립 CLI 테스트용 `/opt/sd-output`으로 저장 경로를 바꾸지 않았으며, 기존 API의
자산 조회와 메타데이터 연결을 유지했다.

## 로컬 검증 결과

- 백엔드 전체 테스트: 83 passed. 기존 Starlette/httpx deprecation warning 1건.
- `ruff check backend`: 통과.
- `frontend`의 `npm run build`: TypeScript 및 Vite 빌드 통과.
- 변경 전 YAML의 바이트가 변경 후 파일의 접두부와 일치함을 확인: 기존 정의 무변경.
- 기존 7개 모델 × 3개 프리셋 × 현재/구버전 작업 스냅샷 = 42개 CLI 인자 배열이
  변경 전 엔진 출력과 정확히 동일함을 확인.
- 임시 모델 파일과 stub CLI를 사용해 실제 subprocess 경로, MOSS API 접수,
  512×512/20-step 작업, PNG 조회, metadata, completed 상태,
  FakeLLM의 pause/drain/stop/start/healthy/resume 순서를 검증.
  이는 GPU 추론이나 LoRA 텐서 적용 성공을 의미하지 않는다.

## 배포와 미검증 항목

현재 작업 환경에는 BC-250의 sd-cli와 모델 파일이 없다. 원격 배포, 실제 GPU 생성,
운영 서비스 중지/재시작은 실행하지 않았다. 다음 항목은 BC-250에서 확인해야 한다.

1. 위 변경 파일을 배포하고 기존 YAML에 추가한 모델의 경로/권한을 서비스 계정으로 확인.
   변경된 프론트엔드를 재빌드/배포한다. 코드와 YAML은 시작 시 로드되므로
   `bc250-ai-studio.service` 재시작이 필요하다. DB 마이그레이션과 sd-cli 재빌드는 불필요하다.
2. 실행 중 이미지 작업/LLM 요청과 외부 GPU 프로세스를 확인한다. 기존 gate와 GPU lock,
   메모리 측정 설정을 사용하며 운영 정책에 맞는 실행권으로 단일 작업을 시작한다.
3. `/api/v1/models`에서 MOSS가 available인지 확인하고 balanced/seed 42로
   비성적인 테스트 프롬프트(예: `a landscape with mountains`) 한 장을 생성한다.
4. 완료 상태, PNG 크기, 메타데이터와 LLM의 원래 상태 복구를 확인한다.
   worker 로그는 기존 `STUDIO_DATA_DIR/logs/<job_id>-0.log`에 저장된다.
5. 실제 worker 로그에서 다음 메시지를 확인한다. 문자열은 자동 성공 판정 조건으로
   강제하지 않으며 기존 종료 코드/PNG 검사 방식을 유지한다.

```text
Version: MOSS-Image
apply lora at runtime
(504 / 504) LoRA tensors have been applied
generate_image completed
1/1 images saved
```

12-step, 768×768 및 LoRA 비활성화의 실제 추론 품질/성능은 후속 검증 대상이다.
사용자 제공 89.98초/98.76초 실측을 이번 세션에서 재현한 것으로 보고하지 않는다.
