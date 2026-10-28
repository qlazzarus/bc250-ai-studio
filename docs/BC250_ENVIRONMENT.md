# BC-250 환경 확인 기록

사용자가 제공한 `bc250-inventory.json`과 터미널 출력에 근거한 스냅샷입니다.
파일에 수집 시각이 없어 현재 실시간 상태로 간주하지 않습니다. 원본의 전체 프로세스·서비스
목록은 저장소에 복사하지 않았습니다.

| 항목 | 확인 결과 |
| --- | --- |
| OS | Fedora 43, Linux 6.17.1-300.fc43.x86_64 |
| Python | 3.14.0. uv sync 성공 및 systemd API/Fake Engine 실행 확인 |
| 여유 공간 | 인벤토리 기준 약 387 GiB, 터미널 df 표시 388G |
| Vulkan | vulkaninfo exit 0; AMD Radeon Graphics (RADV GFX1013), Mesa 25.2.4 |
| 추가 장치 | llvmpipe CPU 장치도 노출. 실제 sd-cli에서 AMD 장치 선택 여부는 미검증 |
| 기존 경로 | sd-cli, /opt/sd-models, /opt/sd-output, /opt/sd-hf-venv 모두 존재 |
| 모델 | GGUF/safetensors 12개 파일 목록 확인. 내용 무결성·실행 호환성은 미검증 |
| Realistic Vision | /opt/sd-models/realistic-vision-v6-fp16.safetensors 확인. 등록/활성화는 별도 검토 |
| LLM unit | llama-server.service — loaded / inactive / dead |
| LLM 프로세스 | 제공된 프로세스 목록에서 llama 프로세스 확인되지 않음 |
| 포트 | 22 리슨, 80/443/8080/8090 리슨 없음 (수집 당시) |
| firewalld | active / running; 활성 zone과 포트 허용 규칙은 미확인 |
| BC-250 TTM 설정 unit | bc250-ttm.service — active / exited. 이 정보만으로 VRAM 크기를 단정하지 않음 |
| 배포 진행 | Studio 서비스 active, 인증 확인, Mac SSH 터널을 통한 Fake 이미지 다운로드 완료 |

Vulkan stderr에는 dzn ICD 건너뜀, DISPLAY 미설정, display 확장 관련 경고가 있습니다.
동시에 RADV 장치 열거가 성공했으므로 이 경고만으로 Vulkan 전체 실패라고 판단하지 않습니다.
실제 추론, 서비스 계정의 /dev/dri 권한, GPU 메모리 해제는 별도 테스트가 필요합니다.

현재 probe는 명령 stdout을 32,000자로 제한하므로 전체 서비스 목록의 끝이 잘렸습니다.
다만 llama-server.service 항목은 출력 안에 포함되어 확인 가능합니다. 후속 상세 조사는:

```bash
cd /opt/bc250-ai-studio
python3 scripts/probe_server.py --llm-service llama-server.service --inspect-cli \
  > "$HOME/bc250-verified.json"
```

위 명령은 도움말과 서비스 속성을 읽으며 추론·서비스 start/stop은 하지 않습니다.
Fake Engine 배포는 이 추가 조사나 LLM 기동을 기다릴 필요 없이 진행할 수 있습니다.
후속 사용자 로그에서 키 생성, 서비스 등록, Fake Engine 외부 테스트 완료를 확인했습니다.

`PROMPT_START` 오류는 대화형 셸에서 nounset 활성화 후 발생했습니다. 프롬프트 훅의
미정의 변수 참조로 추정되며 정확한 초기화 파일은 확인하지 않았습니다. 배포 문서를
비대화형 설치 블록 방식으로 수정했습니다. 기존 셸 초기화 파일·LLM 서비스는 수정하지 않았습니다.


## 외부 Fake Engine 검증 완료

사용자가 제공한 SSE·curl 출력 기준:

- 작업: `4666699851f74cb88035ee4844284d83`
- 결과: `c26a659c45874e80939bcd9caeca52fb`
- queued → waiting_for_gpu → running → completed, error_message 없음
- Mac → SSH 터널 → Studio API를 통한 PNG 다운로드 완료
- 메타데이터: seed 42, 512×512, simulated true

이는 Fedora/Python 3.14의 API·큐·저장·반환 경로 검증입니다. 실제 GPU 추론이나
LLM 자동 전환 검증으로 취급하지 않습니다. 사용자는 다음 단계로 실제 BC-250 GPU
연동을 선택했습니다. 최초 대상은 Klein 4B Q4 / 512×512 / 4 steps / seed 42로
준비하되, 설치된 CLI 도움말·서비스 속성·서비스 계정 GPU 접근부터 확인합니다.

## 상세 사전 검사 결과

프로젝트 루트로 전달된 `bc250-verified.json` 및 사용자 권한 검사 출력 기준:

- sd-cli: `master-1000-95ff762`, commit `95ff762`; --help exit 0.
- SHA256: `810d7659c064afab8bacf9b88176d24c82d73561926b79ae610b3b8fa037ef3b`.
- `--diffusion-model`, `--llm`, `--vae`, `--steps`, `--cfg-scale`, `--seed`,
  `--sampling-method`, `--backend`, `--list-devices`, `--offload-to-cpu` 지원 확인.
- llama-server.service: loaded, inactive/dead, MainPID=0, KillMode=control-group.
- ai-studio: uid 970, gid 967, 추가 그룹 없음. renderD128의 현재 모드가 0666이고
  서비스 계정의 읽기/쓰기 검사 성공. 그룹 추가나 장치 chmod는 수행하지 않음.
- Klein 4B Q4 모델, Qwen3-4B encoder, VAE 모두 ai-studio 읽기 검사 성공.

vulkaninfo의 GPU0 번호는 sd-cli의 backend 이름과 같은 것으로 가정하지 않습니다.
다음은 ai-studio 계정으로 `sd-cli --list-devices`를 실행해 실제 GPU backend 이름을
확인하는 단계입니다. 그 후 LLM 정지 상태에서 독립적인 한 장 추론을 검증하고,
API 자동 전환은 실제 admission gate 구현/연동을 별도로 완료해야 합니다.

## 최초 실제 추론 실패 기록

사용자가 제공한 실행 로그 기준, 수동 테스트 디렉터리:
`/opt/ai-studio-data/manual-tests/klein-q4-wiz6nw`.

Klein 4B Q4, 512×512, 4 steps, seed 42, Euler, CFG 1,
`--backend Vulkan0 --offload-to-cpu`로 ai-studio 계정에서 실행했습니다.
모델·encoder·VAE 로드 및 conditioning은 진행됐으나 diffusion sampling 중
`radv/amdgpu: Not enough memory for command submission.` 이후
`device lost on Vulkan0`, `ErrorDeviceLost`, `generate failed`로 실패했습니다.
PNG 검증 성공 출력은 없습니다. 테스트 성공 또는 모델 tested로 기록하지 않습니다.

로그의 params VRAM 0 / RAM 4882.75 MB는 파라미터 배치 정보로, GPU 실행 버퍼를
포함한 총 메모리 수요나 GPU 미사용을 뜻하지 않습니다. conv2d/conv3d direct 경고는
자동 probe 후 off로 전환됐으며 이번 실패의 직접 원인으로 단정하지 않습니다.
다음 조사: 시스템 RAM/swap, amdgpu VRAM/GTT total/used, TTM limits와
bc250-ttm.service 실제 설정, 실패 시점 커널 로그. GPU device lost 이후 상태를
확인하기 전 재실행·설정 변경·기존 LLM 시작은 하지 않습니다.

## 과거 성공 로그와 메모리 진단 비교

사용자가 제공한 과거 성공은 Klein이 아닌 Z-Image NSFW v2 Q8, 768×768, 6 steps,
Euler/CFG 1/seed 42이며 wall time 48.93초, exit 0입니다. root 실행,
`--backend vulkan0 --vae-tiling --vae-tile-size 384x384 --vae-tile-overlap 0.5`,
CPU offload 플래그 없이 auto-fit이 DiT/encoder를 Vulkan에 배치했습니다.
현재 Klein 실패 명령은 ai-studio 실행, `--offload-to-cpu`로 모든 파라미터를 RAM에
배치했습니다. 모델과 사용자도 달라 인과관계가 확정된 비교 실험은 아닙니다.

실패 후 진단: RAM total 7.5 GiB / available 6.7 GiB, VRAM total 8 GiB,
GTT total 4,010,921,984 bytes (약 3.74 GiB), GPU 사용량은 낮음.
TTM pages_limit 4,194,304와 bc250-ttm 서비스의 적용 값이 일치합니다.
이 값을 더 늘리거나 root로 추론해야 한다는 근거는 없습니다.
실패 시 순간 피크 사용량은 수집되지 않았습니다.

우선 검증 가설: CPU offload 배치/전송 경로와 GTT/작업 버퍼 부담의 연관성.
RAM 파라미터 4,882.75 MB와 GTT 한도만으로 동시 상주량/원인을 확정할 수는 없습니다.
다음 비교 테스트는 동일 Klein/ai-studio/해상도/시드에서 --offload-to-cpu만 제거하여
기본 auto-fit 배치를 확인합니다. VAE tiling은 이번 sampling 실패보다 뒤 단계이므로
첫 비교에서 추가하지 않습니다. 성공 전 레지스트리 기본값/검증 상태는 변경하지 않습니다.

## Klein auto-fit 비교 테스트 성공

사용자가 제공한 재실행 로그에서 확인:

- 실행 계정 ai-studio, GPU Vulkan0 (RADV GFX1013).
- Klein 4B Q4 / 512×512 / 4 steps / seed 42 / Euler / CFG 1.
- 이전 실패 명령에서 --offload-to-cpu만 제거. TTM·권한·기존 서비스 변경 없음.
- auto-fit이 DiT/encoder/VAE 파라미터를 Vulkan0에 배치.
- 파라미터 메모리 로그: VRAM 4882.75 MB / RAM 0 MB (총 실행 피크는 아님).
- conditioning 2.91초, sampling 7.33초, VAE decode 1.32초.
- generate_image 11.57초 (전체 프로세스 wall time 측정 아님).
- 결과: /opt/ai-studio-data/manual-tests/klein-autofit-JbHNTA/result.png
- 1/1 images saved 및 Pillow 512×512 PNG 검증 성공.

이 환경의 해당 설정에서는 CPU offload 없이 정상 실행된 비교 증거를 확보했습니다.
이로써 offload 경로 연관성이 강화됐지만 드라이버 내부의 정확한 실패 원인을 확정하거나
모든 모델·해상도에 결과를 일반화하지 않습니다. conv2d/conv3d direct 자동 probe 경고는
성공 실행에도 존재합니다. 생성 이미지의 시각적 품질은 아직 직접 검토하지 않았습니다.
API 실제 엔진·LLM 전환 통합 검증은 별도로 남아 있습니다.

## LLM admission/권한 사전 검증

사용자가 제공한 실행 기록 기준, `bc250-llm-gate.service`의 `/control`은
paused=false, waiting=0, active=0 상태로 응답했습니다. Studio는 아직 Fake Engine입니다.
`ai-studio`를 대상으로 한 최소 polkit 규칙은 llama-server.service의 start/stop만 허용했고,
ai-studio가 stop 후 start를 수행한 뒤 `ActiveState=active`, `MainPID=4326`을 확인했습니다.
llama 직접 8080과 gate 8081의 `/health`도 최종 성공했습니다. LLM 기동 대기 중 8080 연결
실패와 gate 503은 발생했지만, 기동 완료 뒤의 정상 상태가 확인되었습니다.

다음 사전 조건은 llama `/slots`가 Studio가 요구하는 JSON 배열과 boolean `is_processing`
필드를 제공하는지 확인하는 것이다. 이를 통과한 뒤에만 Studio의 sdcpp/manual API 테스트를 한다.
사용자가 실행한 jq 검증은 true로 성공했다.

## 실제 API 전환 통합 테스트 성공

사용자가 제공한 SSE·systemd 로그 기준, job `7e6709375e1d4170a33c8bf9a6a0de63`가
`klein-4b-q4`, 512×512, 4 steps, seed 42로 manual grant 이후 실행됐다.
결과 asset은 `e7140880b4e148e8b661f0d2758ab57d`이며 오류 없이 completed 됐다.

- Studio 상태: engine=sdcpp, simulated=false, policy=manual, recovery_required=false.
- 모델: available, tested, execution_enabled=true, missing files 없음.
- LLM: 19:52:13 stop, 19:52:27 start 요청, 19:52:45 모델 로드·8080 리슨 확인.
- Job: 19:52:13.367 UTC started, 19:52:46.112 UTC completed.
- SSE heartbeat 두 건은 LLM 재시작 중 발생했으며 terminal completed/end가 이어짐.

이는 API -> SQLite Queue -> admission gate -> llama stop -> sd-cli Vulkan0 -> asset
저장 -> llama restart/health -> gate resume 흐름의 첫 성공 증거다. 현재 정책은 manual이며,
자동 image_priority/chat_priority 운영과 외부 RP client의 gate migration은 별도 단계다.
사용자는 기존 SSH 터널을 통해 Mac에서 실제 asset PNG를 열고, metadata의
model_id=klein-4b-q4, seed=42, 512×512, steps=4, simulated=false를 확인했다.

## Realistic Vision v6 단일 Vulkan 검증 성공

`/opt/sd-models/realistic-vision-v6-fp16.safetensors`는 root 소유 2.0 GiB 파일이며,
ai-studio 계정에서 읽을 수 있음을 확인했다. Studio 레지스트리를 변경하기 전, admission
gate를 pause하고 llama를 정지한 단일 테스트를 실행했다.

- 모델: SD 1.x safetensors, Realistic Vision v6 FP16.
- 실행: ai-studio, `--backend Vulkan0 --sampling-method euler`.
- 설정: 512×512, 15 steps, CFG 7, seed 42.
- auto-fit 파라미터 메모리: VRAM 2035 MiB, RAM 0 MiB (전체 실행 피크는 아님).
- generate_image: 9.77초, 전체 wall time: 10.24초, exit status 0.
- 결과: `/opt/ai-studio-data/manual-tests/rv6-20261024-202957/result.png`.
- PNG 검증: 512×512, RGB, non-interlaced.

llama는 테스트 후 active/running 및 직접 8080 health 정상으로 복구됐다. gate는 테스트
이전의 paused 상태를 보존했으므로 운영자가 명시적으로 resume한 뒤 `paused=false`,
`waiting_requests=0`, `active_requests=0`, gate 8081 health 정상임을 확인했다. Studio
정책은 이후 자동 운영을 위해 `image_priority`로 설정됐다.

## PornMaster CFG/negative prompt T08 검증 성공

사용자 실행 결과는 `docs/t08-pornmaster-20261026-073336/`에 보관했다. Studio real sdcpp
manual 작업 네 건이 모두 완료됐으며, 공통 조건은 512×512, 4 steps, Euler, scheduler 생략,
seed 4242, safe-for-work teacup prompt다.

- CFG 1.0 / empty negative: job `6bec2883073f4ad79f3714670a5b3f1e`, 49.536초.
- CFG 1.5 / empty negative: job `cd9ce74c5555442fa06a37ea5bfbe185`, 66.290초.
- CFG 2.0 / empty negative: job `731c37e8f0394f9392955473c9173ebc`, 66.650초.
- CFG 2.0 / `avoid blur, low contrast`: job `490bb708d7fc437e830d1131b47a785f`, 66.798초.

각 job/asset metadata는 resolved CFG·negative prompt·Euler·scheduler null·`simulated:false`를
보존했고, PNG는 모두 512×512 RGB였다. 전후 Studio는 recovery/error 없이 idle이었고
llama-server는 active/control-group 상태로 복구됐으며 MainPID가 변경됐다. GPU memory
counter와 각 실행의 full sd-cli argv는 제공된 증거에 기록되지 않아 수치/텍스트를 단정하지
않는다. 8-step recipe, 768×768, 다른 seed 및 sampler/scheduler 변경은 이 결과로 검증되지
않는다.
