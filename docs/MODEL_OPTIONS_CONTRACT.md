# 모델별 생성 옵션 계약

작성일: 2026-10-26  
태스크: T02 — 체크포인트별 적용 표와 API 계약 확정  
전제: `docs/SDCLI_OPTIONS_AUDIT.md`의 BC-250 `sd-cli` 해시 결속 및 옵션 목록

이 문서는 다음 구현 태스크가 따라야 할 계약이다. 실제 GPU 생성 검증 전까지 `experimental`은
사용자에게 보이더라도 검증된 품질 또는 호환성을 뜻하지 않는다. `fixed`는 현재 Studio가
실행하는 값을 보존한다는 뜻이지 CLI가 다른 값을 파싱하지 못한다는 뜻이 아니다.

## 근거와 용어

BC-250의 `/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli`는 SHA-256
`810d7659c064afab8bacf9b88176d24c82d73561926b79ae610b3b8fa037ef3b`이며,
`master-1000-95ff762` / commit `95ff762`이다. 이 해시는 이전 인벤토리와 사용자가
2026-10-26에 제공한 재확인 결과가 일치한다.

이 바이너리의 `--cfg-scale`은 unconditional guidance scale, `--guidance`는 guidance
입력이 있는 모델의 distilled guidance scale이다. 둘은 별도 API 필드이며 이 계약은
`guidance`를 1차 구현 범위에 포함하지 않는다.

상태는 다음처럼 사용한다.

| 상태 | 뜻 |
| --- | --- |
| `verified` | BC-250에서 현재 Studio/동일 계열 실행 기록이 있으며, 이 계약의 현재 기본 조합을 보존한다. 새 값의 검증까지 뜻하지 않는다. |
| `experimental` | 체크포인트 제작자 또는 배포자의 명시적 설정 근거는 있으나 BC-250/sd-cli 조합의 실기 검증은 없다. |
| `fixed` | 현 레지스트리 기본값만 허용한다. |
| `deferred` | CLI에는 있으나 이 체크포인트·런타임에 적용할 증거가 부족해 API/UI에 아직 추가하지 않는다. |

## 체크포인트별 capability 결정

| Studio 모델 | 근거와 현재 실행값 | CFG / negative prompt | sampler / scheduler | 1차 구현 결정 |
| --- | --- | --- | --- | --- |
| `pornmaster-klein-9b` | 설치 파일명은 배포자가 나열한 `PornMaster_Flux2Klein_v4_Turbo_Q4_K.gguf`와 일치. Turbo LoRA 불필요인 4-step Turbo다. | `experimental`: CFG 선택값 `1.0`, `1.5`, `2.0`. 비어 있지 않은 negative prompt는 CFG `2.0`일 때만 허용. CFG 1은 negative prompt가 반영되지 않는다고 배포자가 명시. | `fixed`: `euler`; scheduler 생략 | CFG와 조건부 negative prompt를 1차 API/UI 후보로 확정. sampler/scheduler 변경은 보류. |
| `klein-4b-q4` | BFL 공식 사용 예는 4 steps, guidance scale 1.0. BC-250 API에서 4 steps/CFG 1/Euler 실제 성공 기록. | `fixed`: CFG `1.0`; negative prompt 미지원 | `fixed`: `euler`; scheduler 생략 | 기존 동작 유지. CFG/guidance/negative prompt를 새로 노출하지 않음. |
| `klein-4b-q8` | Q8은 같은 로컬 Klein 4B 계열이지만 BC-250 검증 기록 없음. | `fixed`: CFG `1.0`; negative prompt 미지원 | `fixed`: `euler`; scheduler 생략 | 기존 동작 유지. Q4 근거를 Q8 품질 검증으로 승격하지 않음. |
| `z-image-turbo` | Tongyi 공식 카드는 Turbo가 8 NFE, CFG 미사용이며 Diffusers 예에서 guidance scale 0을 명시. 현재 Studio/sd-cli 매핑은 CFG 1/Euler다. | `fixed`: 현재 CFG `1.0`; negative prompt 미지원. 공식 Diffusers guidance 0을 sd-cli `--cfg-scale 0`으로 변환하지 않음. | `fixed`: `euler`; scheduler 생략 | 기존 동작 유지. sd-cli 매핑 실증 전 CFG/guidance 변경을 노출하지 않음. |
| `z-image-nsfw-v2` | 파생 체크포인트의 제작자 모델 카드/권장 매개변수는 찾지 못함. BC-250에는 768²/6 steps/CFG 1/Euler/VAE tiling의 과거 성공 기록이 있다. | `fixed`: CFG `1.0`; negative prompt 미지원 | `fixed`: `euler`; scheduler 생략 | 기존 동작 유지. Turbo 공식 근거를 이 파생 모델에 적용하지 않음. |
| `realistic-vision-v6` | 공식 모델 카드는 negative prompt와 DPM++ SDE Karras 25+ 또는 DPM++ 2M SDE 50+를 권장한다. BC-250 Studio는 Euler/15 steps/CFG 7 실제 성공 기록이 있다. | `verified`: 기존 CFG `0..30` 및 negative prompt. 권장 CFG 범위는 모델 카드에 명시되지 않았으므로 현재 API 범위를 축소하지 않음. | `fixed`: `euler`; scheduler 생략. 모델 카드의 이름을 `sd-cli` enum으로 직접 매핑하지 않음. | 기존 CFG/negative prompt 유지. DPM++/Karras는 정확한 sd-cli 매핑과 BC-250 검증 전에는 API/UI에 노출하지 않음. |
| `fake` | CPU 테스트 엔진 | `verified`: 기존 CFG/negative prompt | API 의미 검증용; sd-cli 실행 없음 | 새 옵션 capability 표시 및 API 회귀 테스트 전용. 품질 근거가 아님. |

`steps`, 해상도, seed는 현재 레지스트리의 `supported_parameters`, presets, resolutions를
그대로 유지한다. 단계 수의 추천값과 변경 허용 여부를 이 태스크에서 바꾸지 않는다.

## 외부 근거

- PornMaster 배포자는 v4 Turbo Q4_K 파일을 나열하고 Turbo LoRA가 필요 없다고 명시한다.
  CFG 1/4 steps, CFG 1.5/8 steps, CFG 2/4 steps을 제시하며 CFG 2에서 negative prompt가
  작동한다고 설명한다. [PornMaster 모델 카드](https://huggingface.co/cl0537furry/PornMaster-flux2-klein-9b?not-for-all-audiences=true)
- BFL 공식 Klein 4B 예제는 guidance 1.0과 4 steps을 사용한다.
  [FLUX.2 Klein 4B 모델 카드](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
- Tongyi 공식 카드는 Z-Image-Turbo를 8 NFE의 distilled 모델로 분류하고 CFG 미사용으로
  표기하며, 예제에서 guidance scale 0을 사용한다.
  [Z-Image-Turbo 모델 카드](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)
- Realistic Vision 공식 모델 카드는 negative prompt와 DPM++ SDE Karras 또는 DPM++ 2M
  SDE 권장 조합을 제시한다. 해당 명칭과 BC-250 `sd-cli` 인자 사이의 동치는 아직 없다.
  [Realistic Vision V6.0 B1 모델 카드](https://huggingface.co/SG161222/Realistic_Vision_V6.0_B1_noVAE)

## API 계약

### 요청 호환성

기존 `POST /api/v1/jobs` 요청은 그대로 유효하다. 필드를 생략하면 현재처럼 선택한
preset의 `width`, `height`, `steps`, `cfg_scale`로 해석한다. 기존 최상위 request 구조,
인증, 큐, job 조회 배열 응답은 변경하지 않는다.

T04에서 추가할 optional 필드는 다음 두 개다.

| JSON 필드 | 타입 | 생략 의미 | 현재 허용 모델 |
| --- | --- | --- | --- |
| `sampling_method` | 설치된 sd-cli enum 중 하나 또는 null | 레지스트리 모델 기본 sampler를 사용 | 이 계약에서는 사용자 변경을 허용하는 모델 없음 |
| `scheduler` | 설치된 sd-cli scheduler enum 중 하나 또는 null | CLI의 model-specific 기본을 유지 | 이 계약에서는 사용자 변경을 허용하는 모델 없음 |

`cfg_scale`과 `negative_prompt`는 기존 필드를 계속 사용한다. PornMaster Turbo에서만 다음
규칙을 추가한다.

| 입력 | resolve 결과 |
| --- | --- |
| `cfg_scale` 생략 | preset의 1.0 |
| `cfg_scale: 1.0`, `1.5`, `2.0` | 허용 |
| 그 외 CFG | 422, 모델이 지원하지 않는 CFG라는 오류 |
| 빈 `negative_prompt` | 세 CFG 값 모두 허용 |
| 비어 있지 않은 `negative_prompt`와 CFG 2.0 | 허용, `experimental` 상태를 결과 capability에 보존 |
| 비어 있지 않은 `negative_prompt`와 CFG 1.0 또는 1.5 | 422, 해당 모델에서는 CFG 2.0이 필요하다는 오류 |

PornMaster의 `fast`/`balanced`/`quality` preset은 호환성을 위해 당분간 4 steps/CFG 1.0을
유지한다. CFG 1.5/8 steps 또는 CFG 2/4 steps은 사용자가 값으로 명시할 때만 선택된다.
T03은 모델 capability에 이 추천 조합을 설명으로 제공할 수 있지만 preset 이름의 의미를
바꾸지 않는다.

### sampler와 scheduler 검증 규칙

- 스키마는 T01에 기록된 exact enum만 허용한다. `normal` alias와 임의 문자열은 API에서
  받지 않는다. alias의 CLI 수용 여부에 기대지 않는다.
- Registry는 모델 capability가 `fixed`이면 `sampling_method`/`scheduler`가 null이거나
  그 모델의 명시적 기본값과 동일한 경우만 허용한다. 다르면 422를 반환한다.
- 이 계약의 모든 sdcpp 모델은 scheduler를 생략한다. 그러면 `sd-cli`의 model-specific
  기본값이 적용된다. Python이나 YAML에서 scheduler 기본값을 추정해 주입하지 않는다.
- `sampling_method`가 생략되면 현재 `cli_args`의 `--sampling-method euler`를 유지한다.
  요청 값이 허용되는 향후 capability를 가진 모델에서만 엔진은 `cli_args`의 해당 flag/value를
  제거하고 요청 값을 정확히 한 번 출력한다.
- `--backend`, `--vae-tiling` 등 운영자 `cli_args`는 요청 옵션보다 독립적으로 보존한다.
  자유 형식 `--extra-sample-args`, 임의 CLI flag, 모델 경로 또는 shell 문자열은 API로
  수용하지 않는다.

### capability 응답 계약

T03은 각 `/models` 모델 객체에 기존 필드를 보존한 채 다음 optional `generation_options`
객체를 추가한다. 기존 클라이언트는 이 필드를 무시할 수 있다.

```json
{
  "generation_options": {
    "cfg_scale": {
      "mode": "fixed | experimental | verified",
      "default": 1.0,
      "allowed_values": [1.0, 1.5, 2.0],
      "note": "negative_prompt requires cfg_scale 2.0"
    },
    "negative_prompt": {
      "mode": "unsupported | experimental | verified",
      "requires": {"cfg_scale": [2.0]}
    },
    "sampling_method": {
      "mode": "fixed",
      "default": "euler",
      "allowed_values": ["euler"]
    },
    "scheduler": {
      "mode": "fixed",
      "default": null,
      "allowed_values": []
    }
  }
}
```

`allowed_values`가 빈 배열인 `fixed` scheduler는 값이 없다는 뜻이다. `default: null`은
API가 CLI 기본을 보존하기 위해 `--scheduler`를 출력하지 않는다는 뜻이다.
고정 CFG 모델도 `cfg_scale.default`를 반환하되 `allowed_values`는 그 하나의 값만 둔다.

### 큐·응답·metadata 계약

- Registry가 확정한 `cfg_scale`, `sampling_method`, `scheduler`, `negative_prompt`는 job
  spec과 model snapshot에 저장한다. 요청에서 생략한 explicit null과 해결된 실제 값의
  표현은 T04에서 하나로 정규화한다.
- job 조회, retry, asset metadata와 설정 재사용은 해결된 값을 보여야 한다. retry는 현재
  레지스트리 또는 새 모델 기본값으로 다시 계산하지 않는다.
- 과거 job/metadata에 `sampling_method`와 `scheduler`가 없으면 조회에는 null을 표시하고,
  retry에서는 저장된 model snapshot의 `cli_args`를 그대로 사용한다.
- API 오류는 사용자가 수정할 수 있는 필드·모델 조건을 밝히되, 내부 argv와 경로는 노출하지
  않는다.

## T03~T06 구현 경계

| 태스크 | 해야 할 일 | 하면 안 되는 일 |
| --- | --- | --- |
| T03 | capability YAML/모델 타입, `/models` optional 응답, 기존 정의 fallback | 새 request 필드를 실행 가능하다고 광고하거나 기존 YAML sampler를 중복 출력 |
| T04 | 이 계약의 schema/Registry/명시적 argv 변환과 회귀 테스트 | extra args 자유 문자열, CLI 별칭 의존, 모델 파일 경로 입력 |
| T05 | queue/spec/snapshot/metadata/retry의 값 보존 확인·보완 | 기존 job을 새 capability로 재해석 |
| T06 | capability 기반 UI, PornMaster CFG/negative prompt 조건 표시, 나머지 fixed 사유 표시 | `experimental`을 tested로 표시하거나 미지원 값을 전송 |

## 보류된 옵션

`guidance`, `clip_skip`, `flow_shift`, `--vae-tiling`, tile size/overlap, highres,
reference image, LoRA, ControlNet, cache와 `--extra-sample-args`는 이 계약의 API/UI
범위 밖이다. CLI에 존재해도 체크포인트별 근거나 자산 입력 모델, sd-cli 매핑, BC-250 검증이
충분하지 않다. 후속 계약은 별도 T08 결과 또는 새 조사 태스크가 있어야 한다.

## T08 결과 보정 (2026-10-26)

BC-250에서 PornMaster Klein 9B Turbo Q4_K의 512×512 / 4 steps / Euler / seed 4242
실기 검증을 수행했다. CFG `1.0`, `1.5`, `2.0`의 빈 negative prompt 세 조합과 CFG `2.0`의
`avoid blur, low contrast` negative prompt 조합이 모두 sdcpp job, PNG, metadata 및 LLM
복구 상태까지 완료됐다. 따라서 이 한정된 CFG/negative prompt 정책은 `verified`로 승격한다.

이는 8-step 레시피, 다른 resolution/seed, sampler/scheduler, 주관적 품질 우위 또는 GPU
메모리 피크를 검증한 결과가 아니다. T08 증거는
`docs/t08-pornmaster-20261026-073336/`에 보관한다. Studio journal에는 Uvicorn access log만
있어 각 실행의 완전한 sd-cli argv 텍스트는 보존되지 않았다.
