# BC-250 sd-cli 옵션 감사

조사일: 2026-10-26  
태스크: T01 — 설치된 sd-cli 옵션 조사  
범위: 도움말과 저장된 인벤토리 대조만 수행했다. 이미지 생성, 서비스 재시작, GPU 접근은 하지 않았다.

## 확인한 설치 바이너리

사용자가 BC-250에서 제공한 다음 명령의 출력이 이 감사의 주 근거다.

```sh
/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli --help
```

출력 첫 줄은 `stable-diffusion.cpp version master-1000-95ff762, commit 95ff762`다.
경로와 버전은 저장된 `bc250-verified.json` 및 `docs/BC250_ENVIRONMENT.md`의 인벤토리와 일치한다.

저장된 인벤토리는 같은 경로의 SHA-256을
`810d7659c064afab8bacf9b88176d24c82d73561926b79ae610b3b8fa037ef3b`로 기록한다.
사용자가 2026-10-26에 다시 실행한 `sha256sum` 결과도 위 해시와 일치했다. 따라서 T02부터는
이 해시의 바이너리와 도움말을 결속된 설치 근거로 사용한다.

관련 원문은 사용자가 전달한 `sd-cli --help` 출력(299줄)과 `bc250-verified.json`의
`sd_cli_help`/`sd_cli_sha256`이다. 이 저장소에는 commit `95ff762`의 sd.cpp 소스가 없어서
옵션 파서·모델별 적용 코드는 이번 태스크에서 확인하지 못했다.

## 핵심 옵션 표

| 구분 | 설치 바이너리에 확인된 옵션 | 도움말의 타입·기본값·제약 | T02 전달 판단 |
| --- | --- | --- | --- |
| 프롬프트 | `-p, --prompt <string>` | 텍스트 프롬프트 | 현재 API가 전달 중 |
| 부정 프롬프트 | `-n, --negative-prompt <string>` | 기본값 빈 문자열 | CLI 일반 옵션 존재만 확인. 각 체크포인트에서 효과가 있는지는 미확인 |
| 단계 | `--steps <int>` | 기본값 20 | 현재 API가 전달 중 |
| CFG | `--cfg-scale <float>` | unconditional guidance, 기본값 7.0 | CLI는 수용. 모델별 변경 허용·권장값은 미확인 |
| distilled guidance | `--guidance <float>` | guidance 입력이 있는 모델용, 기본값 3.5 | CFG와 별도 옵션. 모델별 적용 여부를 T02에서 판정 |
| sampler | `--sampling-method` | `euler`, `euler_a`, `heun`, `dpm2`, `dpm++2s_a`, `dpm++2m`, `dpm++2mv2`, `ipndm`, `ipndm_v`, `lcm`, `ddim_trailing`, `tcd`, `res_multistep`, `res_2s`, `er_sde`, `euler_cfg_pp`, `euler_a_cfg_pp`, `euler_ge`, `dpm++2m_sde`, `dpm++2m_sde_bt`, `lms`; Flux/SD3/Wan 기본 Euler, 그 외 Euler A | 현재 모델 YAML의 고정 `euler`와 충돌 규칙 필요 |
| scheduler | `--scheduler` | `discrete`, `karras`, `exponential`, `ays`, `gits`, `sgm_uniform`, `simple`, `smoothstep`, `kl_optimal`, `lcm`, `bong_tangent`, `ltx2`, `logit_normal`, `flux2`, `flux`, `beta`, `llada_image`; `normal=discrete`; 기본값 모델별 | 생략 시 CLI 모델별 기본을 보존해야 함 |
| CLIP skip | `--clip-skip <int>` | 기본값 -1; 0 이하는 미지정, SD1.x는 1, SD2.x는 2 | 도움말이 CLIP 기준으로 설명. Qwen LLM encoder 모델에 적용할 근거 없음 |
| flow shift | `--flow-shift <float>` | Flow 모델(도움말 예: SD3.x/WAN)용, 기본값 auto | FLUX.2 Klein/Z-Image 적용 여부 미확인 |
| VAE tiling | `--vae-tiling` | 공간 타일로 VAE encode/decode; 도움말에 256x256 언급 | boolean 기본 상태가 명시되지 않음. 모델별 품질·메모리 검증 필요 |
| VAE tile size | `--vae-tile-size <W>x<H 또는 S>` | 기본값 256x256, `--vae-tiling` 필요 | 현재 BC-250 Z-Image 과거 실행에 384x384 사용 기록은 있으나 일반 권장값 아님 |
| VAE relative tile size | `--vae-relative-tile-size <W>x<H 또는 S>` | 1 이하는 차원 비율, 초과는 목표 tile 수; `--vae-tile-size`를 덮어씀, `--vae-tiling` 필요 | T02 1차 범위 제외 |
| VAE overlap | `--vae-tile-overlap <float>` | 타일 크기 비율, 기본 0.5 | T02 1차 범위 제외 |
| sampler 보조 인자 | `--extra-sample-args <string>` | key=value 목록. guidance schedule, APG, SLG, Flux shift 등 모델별 인자 | 자유 문자열 API로 노출하지 않음. 검증된 특정 옵션만 후속 계약 후보 |

## CFG와 guidance의 구분

이 설치 바이너리는 둘 다 제공하지만 이름과 도움말상 의미가 다르다.

- `--cfg-scale`은 unconditional guidance scale이며 기본값은 7.0이다.
- `--guidance`는 guidance 입력이 있는 모델의 distilled guidance scale이며 기본값은 3.5다.

따라서 현재 Studio의 `cfg_scale`을 `--guidance`로 바꾸거나, guidance 지원을 이유로 모든
FLUX.2 모델에 CFG 변경을 허용하면 안 된다. `--batched-cfg on|off`도 Context 옵션에 있으나,
이는 지원될 때 conditional/unconditional CFG branch 실행을 묶는 실행 최적화 옵션이다.
사용자 노출 생성 품질 옵션으로 취급하지 않는다.

## 현재 Studio와의 차이

`backend/app/engines/sdcpp.py`는 현재 `--steps`, `--cfg-scale`, `--seed`와 값이 있을 때
`--negative-prompt`를 argv 배열로 전달한다. 모델 YAML의 `cli_args`는 마지막에 붙는다.
`backend/app/services/registry.py`는 모델의 `supported_parameters`에 없는 `cfg_scale` 변경과
non-empty negative prompt를 실행 전에 거절한다. 즉 다음은 서로 다른 사실이다.

1. 설치된 sd-cli는 해당 플래그를 인식한다.
2. Studio가 해당 값을 argv로 전달할 수 있다.
3. 특정 체크포인트가 그 값을 의미 있게 사용하며 Studio에서 사용자 변경을 허용해야 한다.

T01은 1을 확인했고 2의 현재 구현을 확인했다. 3은 체크포인트 제작자 자료와 실기 검증이
필요하므로 T02 이후의 판단이다.

## T02에 필요한 결정과 자료

T02는 아래를 모델별로 확정해야 한다.

- PornMaster FLUX.2 Klein 9B Turbo v4의 정확한 제작자 모델 카드/버전, 권장 CFG,
  negative prompt, sampler, scheduler, guidance 사용 여부.
- Klein 4B Q4/Q8, Z-Image Turbo, Z-Image NSFW v2, Realistic Vision V6 각각의
  체크포인트 근거와 지원·실험적·미지원 분류.
- 현재 YAML `cli_args`의 `--sampling-method euler`와 요청 sampler가 모두 주어질 때의
  단일 인자 출력 규칙.
- scheduler 생략 시 CLI model-specific 기본을 유지하는 API 계약.
- API 1차 범위: `cfg_scale`, `negative_prompt`, `sampling_method`, `scheduler`.
  `guidance`, `clip_skip`, `flow_shift`, VAE tiling 세부값은 모델별 증거가 생길 때까지 보류.

원격에서 해시 결속이 필요할 경우 사용자는 추론 없이 다음 읽기 전용 명령을 실행할 수 있다.

```sh
sha256sum /opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli
/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli --help
```
