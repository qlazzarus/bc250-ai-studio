# 모델과 생성 옵션

모델의 기준은 [config/models.yaml](../config/models.yaml)이며 [Registry](../backend/app/services/registry.py)가 목록과 제출 때 파일 존재 및 옵션을 검사한다. 파일이 없으면 설정의 검증 상태보다 `unavailable`이 우선한다. `tested`는 모든 해상도·프리셋·seed의 품질 보장이 아니다.

## 등록 모델

| 모델 ID | 계열 | 설정상 검증 상태 | CFG와 negative prompt | sampler와 scheduler |
| --- | --- | --- | --- | --- |
| `fake` | fake | tested, API 테스트 전용 | CFG 0..30, negative 지원 | 실제 CLI 실행 없음 |
| `klein-4b-q4` | flux2 | tested | CFG 1 고정, negative 미지원 | Euler, scheduler 생략 |
| `klein-4b-q8` | flux2 | configured | CFG 1 고정, negative 미지원 | Euler, scheduler 생략 |
| `pornmaster-klein-9b` | flux2 | tested | CFG 1/1.5/2, negative는 CFG 2 필요 | Euler, scheduler 생략 |
| `z-image-turbo` | z-image | configured | CFG 1 고정, negative 미지원 | Euler, scheduler 생략 |
| `z-image-nsfw-v2` | z-image | configured | CFG 1 고정, negative 미지원 | Euler, scheduler 생략 |
| `realistic-vision-v6` | sd15 | tested | CFG 0..30, negative 지원 | Euler, scheduler 생략 |
| `moss-image-nsfw` | moss-image | tested, balanced 한정 | CFG 3, negative 미지원 | Euler, discrete |
| `moss-image-nsfw-q8` | moss-image | configured, 프리셋 experimental | CFG 3, negative 미지원 | Euler, discrete |

설정에 기록된 제한된 실기 범위는 Klein Q4 512²/4 steps/CFG 1, Realistic Vision 512²/15 steps/CFG 7, PornMaster 512²/4 steps/seed 4242와 CFG 1·1.5·2 및 CFG 2 negative 조합이다. MOSS Q4 balanced는 512²/20 steps/CFG 3/flow shift 5/LoRA 0.7이다. MOSS Q8의 LoRA 포함 프리셋은 검증 대기다. 이 표는 새로 수행한 실기 결과가 아니다.

## 옵션 계약

`generation_options`가 CFG, negative prompt, sampler, scheduler의 정책 기준이다. `fixed`는 기본값만, `experimental`은 허용하되 실기 검증 미완료, `verified`는 기록된 검증 범위, `unsupported`는 미지원이다. 기본값·허용값·범위·조건·설명을 API에 노출한다. 기존 `supported_parameters`는 해상도·steps 등의 허용 목록으로 유지한다.

생략한 설정은 프리셋/모델 기본값으로 해석한 뒤 작업에 저장한다. 고정 옵션에 다른 값을 보내면 422다. sampler/scheduler의 enum은 [요청 스키마](../backend/app/models/schemas.py)가 기준이며 `normal` alias는 받지 않는다. scheduler null은 CLI 기본을 보존하기 위해 인자를 생략한다. 현재 등록 모델은 사용자 임의 sampler/scheduler 변경을 제공하지 않는다.

`--cfg-scale`과 distilled guidance는 같은 설정이 아니다. 상류 모델 카드의 guidance 값을 CFG에 기계적으로 대입하지 않는다. 실제 argv는 [sdcpp 어댑터](../backend/app/engines/sdcpp.py)가 배열로 만들며 운영자 `cli_args`와 요청 허용값을 결합한다. 임의 CLI 인자는 API로 받지 않는다.

## MOSS 실행

MOSS는 diffusion·text encoder·VAE 외에 tokenizer와 flow shift를 요구한다. LoRA는 운영자 레지스트리에서 파일·강도·trigger를 설정하고 파일 유효성을 검사한다. 어댑터가 tokenizer, flow shift, LoRA 디렉터리, trigger와 LoRA 태그를 구성한다. 프롬프트의 기존 LoRA 처리 규칙은 어댑터 코드가 기준이다.

Q4의 fast 12 steps와 quality 768²는 experimental이다. Q8 기본 모델 검증 기록을 LoRA 0.7 조합의 검증으로 확대하지 않는다. 모델별 해상도·프리셋·파일 경로를 변경할 때는 YAML과 해당 엔진 테스트를 함께 확인한다. 추가 검증은 [TODO](TODO.md)에서 관리한다.
