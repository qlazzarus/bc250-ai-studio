# IGX00 · BC-250 이미지 생성 확장 설계안

2026-11-26 KST · Studio 기준 커밋 `d1503be` · 승인 대기

**첫 실기 후보는 Realistic Vision V6의 512×512 단일 이미지 img2img다.** 이 모델은 기존 생성 기록이 있고 SD 1.5 단일 체크포인트에 필요한 VAE가 들어 있어, 새 가중치를 도입하기 전에 입력·재생성·복구를 함께 시험할 수 있다. 먼저 입력 자산 계약과 UIX 회귀 기준을 확정한다. IP-Adapter는 별도의 결정으로 남긴다. 조사한 최신 릴리스에서 SD 1.5 경로는 DGL 스크립트 전용이며 Vision 인코더와 어댑터 가중치가 추가된다. [SD 단일 체크포인트](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/sd.md) · [IP-Adapter 실행 예제와 로더](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/ip_adapter.md)

세션별로 실행할 때는 [DeepSeek 4.1 Flash 작업 카드](IGX_FLASH_TASKS.md)의 시작 프롬프트와 해당 카드 한 행을 사용한다.

## 1. 기준선과 증거 범위

| 구분 | 확인한 내용 | 판정 범위 |
|---|---|---|
| 이 작업공간 | WSL2, /dev/dri 없음, 설정의 기본 CLI 경로와 PATH에 설치본 없음 | 모델 추론·Vulkan·메모리 신규 실측 없음 |
| 운영 접근 | 내부 SSH 경로 없음. 등록된 외부 주소에는 도달했으나 공개키 인증 실패. 운영 점검 스크립트의 유지보수 키가 이 환경에 없음 | 오늘 설치된 릴리스·도움말·파일·서비스 상태 UNKNOWN. 아래 읽기 전용 절차 제공 |
| 과거 운영 기록 | 11월 23일 Fedora 43, RADV GFX1013, Mesa 25.2.4, sdcpp, chat_priority, 8개 실제 모델 exec=True, 512² PNG 조회. llama health 정상, compose 503 | 당시의 조회·상태. 8개 모델의 결과 또는 현재 배포 버전을 보증하는 증거로 확대할 수 없음. [UCP09](UCP09_BC250_VERIFICATION.md) |
| 상류 | 공식 Latest 태그 master-1133-52491bd와 원격 HEAD 모두 52491bd9f1fc15281791723bdff13baab7fd6819. 해당 소스 트리 직접 열람 | 자동 master 릴리스. 별도 장기 안정판 지정 근거 없음. 조사 기능 중 이 HEAD에만 있고 해당 릴리스에 없는 차이 없음. 미병합 PR은 지원 등급에 포함하지 않음. [릴리스](https://github.com/leejet/stable-diffusion.cpp/releases/tag/master-1133-52491bd) |

### UIX의 실제 인계점

| 단계 | 현재 소스·검증에서 확인한 계약 |
|---|---|
| UIX01 | App과 ComposePanel이 한글 작성과 직접 입력을 전환하며 패널·초안을 유지한다. 전환 자체로 compose 요청을 보내지 않는다. |
| UIX02 | 사전 검색·분류·선택 요약, 충돌 표시와 귀속 변경을 구분한다. 검색만으로 작성 revision을 올리지 않는다. |
| UIX03 | composeView와 ComposePanel이 후보 펼침, 적용, 접힌 패널의 상태 표시를 나눈다. 비동기 응답이 직접 입력을 덮으면 회귀다. |
| UIX04 | 생성 프리셋, 고급 옵션과 제출 오류의 대상 필드 이동. 기존 요청 본문의 기본값 유지가 회귀 기준이다. |
| UIX05 | 접수한 job ID 추적, 목록·상세·재시도, 큐 상태와 포커스. 재시도는 새 작업을 만든다. |
| UIX06 | Gallery, ImageViewer, MetadataModal, useGallery가 상세·메타데이터·입력 복원과 포커스 복귀를 담당한다. 현재의 파라미터 재사용과 향후 픽셀 입력 재사용은 서로 다른 사용자 동작이다. |
| UIX06A | routes.ts가 /art/compose, /art/generate, /art/jobs/:id, /art/gallery/:id/metadata, 페이지·보관 필터와 /pixel을 해석한다. 뒤로 가기·직접 진입 계약을 유지한다. |
| UIX07 | 사용자 배경과 체크아웃 사이에 차이가 있다. 작업표는 ‘대기’, 마지막 커밋은 UIX06A이고 전용 suite·증거 디렉터리가 없다. 13개 이상 페이지 이동, compose 도중 이동과 응답, 귀속 후 Tab, 모바일 IME·회전, 배포된 SPA 직접 진입과 과거 증거 대조가 남았다. 기존 하네스의 1,015개 성공은 UIX06A 당시 fake 결과다. |

근거는 [App](../frontend/src/App.tsx), [ComposePanel](../frontend/src/components/ComposePanel.tsx), [라우트](../frontend/src/lib/routes.ts), [UIX 테스트](../frontend/tests), [브라우저 suite](../scripts/prompt-composer-browser), [UIX 인계 기록](ART_STUDIO_UI_UX_IMPLEMENTATION.md)이다.

### 현재 제출부터 복구까지

1. Art의 App·useGeneration·StudioApi가 인증된 `POST /api/v1/jobs`를 사용한다. JobRequest는 알 수 없는 필드를 거부한다. job_type은 image.generate/image.batch, source는 rp/nsfw/pixel, project_id는 null이다. seed -1, 프리셋, batch 1~16, 선택적 lora_enabled·prompt_composition을 받는다. 64~2048, 8배수라는 스키마 한도 위에 모델별 해상도 목록이 적용된다. 등록된 실제 모델은 현재 512²·768²다. Registry가 파일 존재, 엔진 선택, 고정 옵션, CFG 조건·해상도를 검사하고 확정 seed·모델 snapshot을 보관한다. 잘못된 조합 422, 큐 포화 429, 접수 202 {job_id,status}. [스키마](../backend/app/models/schemas.py) · [레지스트리](../backend/app/services/registry.py) · [라우터](../backend/app/api/routes.py)
2. SQLite Job·items·Event·Asset가 상태를 보존한다. GET jobs/상세/events(SSE)로 조회한다. scheduler는 우선순위·생성시간 순서로 queued → waiting_for_gpu → running → completed/failed/cancelled/interrupted를 기록한다. 배치 seed는 확정 seed+index. chat_priority는 이미지 경계에서 양보, manual은 grant, image_priority는 다음 작업이 있으면 lease를 유지할 수 있다. 모델을 매 이미지 새 프로세스에서 로딩하므로 lease 유지만으로 가중치가 상주하지 않는다. [스케줄러](../backend/app/scheduler/runner.py) · [영속 모델](../backend/app/models/database.py)
3. GPUManager는 프로세스 내 lock과 공유 파일 lock 아래 switch barrier를 확인한다. 설정에 따른 owned hold 또는 기존 pause → LLM drain → 활성 서비스 정지·GPU idle 검증 → 이미지 실행 순이다. 원래 비활성인 LLM은 시작하지 않는다. Studio가 정지시킨 서비스만 시작·health 확인 후 자기 hold를 해제한다. 실패 시 journal·blocked·recovery가 다음 실행을 막는다. coordination/recovery 내부 endpoint와 worker의 공유 lock 소유권 검사를 그대로 사용한다. 실제 운영의 활성 모드는 확인 대상이다. [GPUManager](../backend/app/services/gpu.py) · [내부 계약](../backend/app/main.py) · [Gate](../backend/app/gate.py)
4. SdCppEngine은 SD15에 -m, 그 외에 diffusion-model/llm/vae, MOSS에 tokenizer·flow-shift를 더한다. 모델의 옵션과 사용자 허용값을 배열로 조립한다. subprocess 새 세션, 비공개 로그, timeout, TERM 후 KILL, PNG 형식·크기 검사를 거친다. 실행 중 취소는 플래그를 세워 이미지 경계에서 처리한다. 한 장이 끝나 저장된 뒤 cancelled가 될 수도 있다. 시작 시 중단 작업을 interrupted로 표시한다. retry는 실패·중단·취소된 spec 복사로 새 job을 접수한다. 결과 저장 후 LLM 복구 실패는 결과를 보존하고 별도로 보고한다. [엔진](../backend/app/engines/sdcpp.py) · [취소·재시도](../backend/app/api/routes.py)
5. outputs/{source}/{job_id}/{asset_id}.png, JSON sidecar, Asset 행에 실제 seed·batch index·모델 snapshot이 남는다. archive/restore/trash, 파일 조회, 생성 설정 재사용이 있다. PixelStudio는 활성 Studio 자산을 프로젝트에 연결하고 Pillow로 단색 배경 제거·trim·nearest thumbnail·팔레트·중앙 배치한 PNG 버전을 만들고 승인한다. 이는 이미 구현된 CPU 후처리다. 로컬 파일 유입, 마스크, 생성 모델에 원본 픽셀 전달, 범용 업스케일러는 현 실행 계약에 없다. [Pixel 화면](../frontend/src/PixelStudio.tsx) · [픽셀 처리](../backend/app/pixel/service.py)

## 2. 엔진 실행 경로와 파일 요구사항

아래는 위 태그의 소스 판독이다. 설치판의 추가 기능 전체는 UNKNOWN이다. CLI help는 빌드 식별에만 쓰고, 모델 로더·결과·backend 로그까지 확보해야 운영 지원으로 승격한다.

| 기능 | 릴리스에서 확인한 실행 경로 | BC-250 적용 조건 |
|---|---|---|
| Img2img | init 이미지 → VAE encode → strength로 선택한 sigma 구간에 노이즈 추가 → sample → decode. SD1.x 공식 예제가 있다. Klein의 -r은 별도 reference latent 경로로, init strength와 의미가 다르다. MOSS 명령 기반 edit에는 전용 HQ 또는 chinoll LoRA 등이 필요하다. | 기존 SD15 체크포인트부터 strength·seed·두 종횡비 정책 비교. Klein reference edit는 독립 capability. 등록 MOSS 스타일 LoRA를 edit 가중치로 대체 해석하지 않는다. [이미지 생성 코드](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/api/generation_image.cpp) · [SD img2img](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/dgl/sd/sd1-4-img2img.dgl) · [edit 계열](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/guides/edit.md) |
| Inpaint·outpaint | image_inpaint가 init을 요구하고 일반 모델에는 latent denoise_mask, 전용 모델에는 concat conditioning과 denoise_mask를 구성한다. 전용 SD15 예제는 원본·가린 이미지 VAE 인코딩을 사용한다. | 현재 RV는 일반 SD15다. 흑백 마스크 의미를 실측하고 보존 영역을 원본 픽셀과 최종 합성한다. Outpaint는 확장 캔버스·패딩·마스크를 조립하는 Studio 작업이다. 전용 모델 채택은 별도 승인. [분기](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/api/generation_image.cpp#L128) · [전용 예제](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/dgl/sd/sd1-5-inpainting.dgl) |
| IP-Adapter | **DGL 전용**. SD15/SDXL Classic·Plus. ViT-H/14 → pooled 또는 penultimate features → adapter.project → 양·음 조건에 apply → UNet attention. family가 맞는 adapter 파일 필수. strength·sigma 범위 및 조건에 재적용 가능. | 등록 후보는 RV 하나다. 단일 참조부터 측정하고 복수 참조는 서로 다른 입력·강도·추가 메모리를 따로 시험한다. FaceID용 얼굴 임베딩·로더 근거 부족(UNKNOWN). PhotoMaker·PuLID는 별도 방식. 일반 CLI의 과거 플래그를 현 릴리스에 복사하지 않는다. [가중치 및 DGL](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/ip_adapter.md) · [어댑터 실행](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/dgl/models/ip_adapter.cpp) |
| ControlNet | SD15 DGL은 family=sd1 제어망과 준비된 pose.png를 읽고 positive/negative에 apply한다. Canny는 CPU 이미지 전처리 구현. Z-Image에는 별도 DiT 제어망, VAE latent와 33채널 패딩 경로가 있고 반복 apply를 지원한다. 제어·reference를 함께 쓰면 별도 prediction이 필요하다. | 첫 경로는 SD15 전용 Canny 가중치+내장 edge 또는 준비된 힌트. Depth·OpenPose는 깊이/관절 추정기가 별도이고, Lineart는 전처리기나 사전 제작 선화, Scribble은 손그림을 받을 수 있다. 유형별 학습 가중치·입력 규약·강도 검증. normal/segment/tile 등 유형 이름만으로 작동 판정 금지. 다중망·IP 조합은 별도 PoC. [SD 제어망](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/dgl/sd/sd1-5-controlnet.dgl) · [Canny](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/dgl/bindings/postprocess.cpp) · [Z-Image](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/z_image.md) |
| LoRA | 디렉터리와 prompt 태그, 또는 DGL로 가중치 강도를 지정하고 대상 모듈에 적용한다. 양자화·배치 위치에 따라 auto가 immediately 또는 at_runtime을 선택한다. 연산 중 적용은 시간·메모리 비용이 있다. | MOSS의 경로·기본강도 0.7·trigger·작업별 on/off·기존 명시 태그 우선은 유지. 추가 범위는 운영자 등록·family/텐서 대상·digest 확인, 순서 있는 복수 선택과 프리셋. [상류 적용 방식](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/lora.md) · [모델 정의](../config/models.yaml) |
| 업스케일·hires | 독립 -M upscale은 ESRGAN/호환 MoSR을 로드하고 tile_size를 전달한다. 한 그래프 내 생성→업스케일 연결은 DGL 전용. hires는 고해상도 latent 재정제 경로다. | 파일 기반 순차 작업이면 생성 모델과 업스케일러 동시 상주를 피할 수 있다. 얼굴 복원 전용 가중치·백엔드는 UNKNOWN. ADetailer의 검출·재생성과 구분. 포맷 변환은 CPU 후보, Pixel 버전 이력 유지. [업스케일러](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/api/upscaler.cpp) · [지원 모델](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/esrgan.md) · [hires](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/src/api/generation_hires.cpp) |

빌드에서 SD_VULKAN은 GGML_VULKAN을 켜며 SD_CUDA와 독립이다. CLI 예제 빌드는 SD_BUILD_EXAMPLES를 확인한다. runtime backend와 params-backend는 별도이며 CPU 가중치 배치·disk offload·VAE tiling은 후보 빌드별로 비교한다. CUDA SageAttention은 대상에서 제외한다. Pillow 경로와 CPU Canny 외의 모델 추론에 CPU 전용이라는 근거는 없다. GFX1013에서 어떤 연산이 fallback되는지는 기능별 로그로만 판정한다. [빌드 옵션](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/CMakeLists.txt) · [backend 배치](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/guides/backend.md) · [CUDA 제약](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/guides/sage_attention.md)

상류 PR #2418은 idle weight release 후 backend 캐시 회수, #2419는 DGL OOM 보고 관련 수정이므로 엔진 후보 비교에 포함한다. 커뮤니티의 Z-Image Vulkan 실험은 다른 GPU·수정된 코드에서의 사례다. 다중 LoRA·고해상도 AMD 장애 제보도 추적할 회귀 사례이며 BC-250 재현 결과는 UNKNOWN이다. [캐시 PR](https://github.com/leejet/stable-diffusion.cpp/pull/2418) · [OOM PR](https://github.com/leejet/stable-diffusion.cpp/pull/2419) · [커뮤니티 실험](https://github.com/leejet/stable-diffusion.cpp/issues/1074) · [AMD 이슈](https://github.com/leejet/stable-diffusion.cpp/issues/1902)

## 3. 모델별 호환성

아래는 개발 우선순위를 정하기 위한 매트릭스다. V=VERIFIED(운영자의 과거 실기 기록이 있는 해당 레시피), S=SUPPORTED(공식 경로, 현장 미검증), C=CONDITIONAL(지정 파일·변환·설정 필요), E=EXPERIMENTAL(실험 레시피), X=UNSUPPORTED(해당 방식·계열의 지원 범위 밖), ?=UNKNOWN. Vulkan 열은 기본 생성 경로에 한정한다. 확장 기능의 **Studio 제출·BC-250 Vulkan 실증 상태는 모두 미검증**이다. 예외는 기존 MOSS 단일 LoRA 레시피다. 확대 열은 결과 PNG를 별도 업스케일러에 입력할 수 있는 조건을 뜻한다.

| 등록 ID | T2I | I2I¹ | Inpaint | Outpaint | IP | ControlNet | LoRA | 확대 | 복합 조건 | Vulkan |
|---|---|---|---|---|---|---|---|---|---|---|
| fake | X | X | X | X | X | X | X | C | X | X |
| klein-4b-q4 | V | C | ? | ? | X | ? | C | C | ? | V |
| klein-4b-q8 | S | C | ? | ? | X | ? | C | C | ? | ? |
| pornmaster-klein-9b | V | ? | ? | ? | X | ? | C | C | ? | ? |
| z-image-turbo | S | ? | ? | ? | X | C | C | C | C | ? |
| z-image-nsfw-v2 | C | ? | ? | ? | X | ? | C | C | ? | ? |
| realistic-vision-v6 | V | S | C | C | C | C | C | C | C | V |
| moss-image-nsfw | V | ? | ? | ? | X | ? | V | C | ? | V |
| moss-image-nsfw-q8 | V² | ? | ? | ? | X | ? | E | C | ? | ? |

¹ I2I는 원본 잠재공간에 strength를 적용하는 모드다. Klein의 C는 일반 init 경로와 해당 변형의 VAE·sigma 조합을 확인해야 한다는 뜻이다. 별도의 native reference edit에는 Klein 4B·9B 공식 예제가 있다. 파생 PornMaster에 같은 품질을 가정하지 않는다. 복합 C는 SD에서 호환 제어 조합, Z-Turbo에서 맞는 다중 제어 가중치가 있는 경우다. 필요한 텐서 대상이 불일치하면 LoRA C는 해당 파일에 대해 X로 내려간다. [FLUX.2](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/flux2.md) · [MOSS](https://github.com/leejet/stable-diffusion.cpp/blob/52491bd/docs/models/moss_image.md)

² Q8 base, LoRA off, 512²/768²·20 steps에 한한 운영자 기록이다. 기본 설정에서 활성화하는 LoRA 포함 preset은 experimental이다. Q4 MOSS는 512²/20 steps/CFG 3/flow shift 5/0.7, RV는 512²/15 steps/CFG 7, Klein Q4는 512²/4 steps/CFG 1, PornMaster는 512²/4 steps/Euler/seed 4242 및 CFG 2의 negative까지가 기존 기록이다. YAML 맨 위의 ‘Klein Q4만 통과’ 주석은 모델별 항목·운영 기록과 충돌한다. fake는 CPU 테스트 이미지만 출력한다. [등록 파일](../config/models.yaml) · [레시피 범위](MODELS.md)

## 4. 16GB UMA에서의 자원 예산

실측된 **기능별 최고점·초/장·LLM 복구 시간은 UNKNOWN**이다. 16GB는 OS·파일 캐시·GPU 매핑·모든 프로세스가 공유한다. 모델 파일 크기, 프로세스 RSS, Vulkan heap 사용량을 더하면 같은 페이지를 중복 셀 수 있다. 예산의 기준은 LLM drain/stop 후의 실제 MemAvailable과 실행 직전 대비 시스템 최저 MemAvailable이다. cgroup memory.peak, sd-cli 로그의 할당량, VRAM/GTT·swap·PSI를 같은 시각에 보조 지표로 남긴다. GPU idle 확인의 설정 예시 512MiB는 생성 작업의 메모리 예산이 아니다. [설정 예](../config/settings.example.yaml)

**계산 예시(추정)**. 4B Q4의 이상적인 가중치 payload는 약 2.0GB(10진), Q8은 4.0GB다. Klein 4B Q4+4B Q4 인코더는 약 4GB, 9B Q4+8B Q4는 약 8.5GB, MOSS 5B Q8+9B Q4는 약 9.5GB다. 실제 GGUF 블록·혼합 정밀도·VAE·activation·scratch·드라이버·OS를 더해야 하며 동시 상주 여부에 따라 peak가 달라진다. Z 6B Q4/Q8의 diffusion payload만 약 3/6GB이고 별도로 4B Q4 인코더·VAE가 있다. SD15는 단일 FP16 파일의 실크기부터 확인한다. 모델명으로 실제 크기를 고정하지 않는다. 768²는 512²의 2.25배 픽셀이고 일부 attention·작업 버퍼는 이보다 가파르게 늘 수 있다. 고정 512², batch 1로 먼저 측정한다.

| 작업 | 기본 생성 대비 추가 상주·최고점 추정 방식 | 실행성과 실사용성 판단 |
|---|---|---|
| 입력·CPU 변환 | RGBA 버퍼 하나는 W×H×4 bytes. EXIF 회전·디코더·복사본·동시 업로드가 최고점을 만든다. | 모델 없이 가능. 압축 바이트와 디코딩 픽셀 제한을 독립 적용. |
| I2I | 기본모델+VAE encode 활성값·init latent. encode/sample/decode 단계 중 가장 큰 구간을 측정. | SD15 우선. strength가 낮아도 모델 로딩·인코딩 시간이 든다. |
| 마스크·캔버스 | 일반 I2I+마스크·합성본, 전용 모델은 가린 원본 인코딩도 필요. 확장된 최종 면적이 GPU 비용 결정. | 같은 512²부터. 768² 확장·넓은 seam은 품질·OOM 재판정. |
| IP | SD15+ViT-H/14 가중치·vision 활성값·projection/KV. 인코더 0.63B를 FP16으로 놓은 산술 예는 약 1.26GB로, 어댑터·워크스페이스는 별도. | pooled embedding 추출 후 인코더 해제 가능 시점 측정. CPU 배치는 UMA 총량을 늘리지 않고 시간 비용이 생긴다. Plus·복수 참조 후순위. |
| ControlNet | 기본망+제어 가중치+스텝별 residual·버퍼. 내장 Canny는 이미지 버퍼, 학습형 depth/pose는 전처리망 peak 추가. | hint를 먼저 파일로 확정하고 전처리기를 종료. 복수망의 동시 가중치·시간 증가, Z Q8은 높은 위험. |
| LoRA | 기본망+각 adapter의 실제 파일·적용 버퍼. merge는 일시 복사, runtime은 스텝 비용을 측정. | Q4/8이라도 adapter가 F16일 수 있다. Q4 단일 먼저, 복수·Q8 별도. |
| 확대·hires·얼굴 | 독립 확대는 upscaler+타일 활성값+전체 출력. 4× 선형 확대는 출력 픽셀 16배. hires는 두 번째 고해상도 diffusion peak. 얼굴 복원은 검출·복원 모델 추가. | 독립 타일 확대 먼저. 타일 경계와 전체 프레임 host 버퍼 측정. hires/얼굴은 실사용성 UNKNOWN. |
| 연쇄 | 파일을 단계 사이에 확정하고 프로세스를 종료하면 추론 부분은 대체로 단계별 peak 중 최댓값. 중간 이미지·캐시·LLM 재로딩 비용은 남는다. | 단계별 lease와 채팅 대기시간을 기록한다. 동시 조건화는 가중치가 겹치므로 순차 시험 결과를 전용할 수 없다. |

운영 판정은 두 단계다. 먼저 cold/warm에서 정상 파일과 GPU 사용·메모리 회수·LLM health/hold 복구를 반복 확인한다. 이후 사용자와 정한 최대 초/장, 채팅 중단 허용시간, 최저 여유 메모리, 허용 화질을 만족하는 레시피만 기본 UI에 연다. 메모리 부족 징후, swap 지속 증가·health 실패가 있으면 해상도/조합 확대를 중단한다. weight 양자화·VAE tiling·CPU/disk 배치는 지원되는 모듈만 하나씩 바꿔 비교한다.

## 5. 제안 계약

- **입력과 이력**. 인증된 신규 입력 endpoint에 바이너리를 전송해 불변 input_id, 크기, 정규화 포맷, digest를 받는다. 기존 Asset 및 PixelVersion은 접근 가능한 ID로 참조한다. 동일한 좌표계에서 EXIF 회전 후 RGB/RGBA PNG로 정규화하고 위치·EXIF를 제거한다. 첫 범위는 정지 PNG/JPEG, byte/pixel/한 변·동시 수 제한, 실제 디코드, 방향·alpha 처리다. 다중 프레임·깨진 파일·심볼릭 링크·경로 탈출은 거부한다. 서버가 이름을 할당하고 원본 파일명은 경로로 쓰지 않는다. 임시 쓰기→검증→원자적 이동→DB 연결 사이 장애는 고아 스캔으로 정리한다. 기존 BodyLimit이 body를 메모리에 모으므로 업로드 전용 스트리밍 한도와 proxy 한도를 함께 설계한다. [현재 미들웨어](../backend/app/core/middleware.py)
- **수명주기**. 미제출 업로드는 TTL, 접수 시 job과 같은 트랜잭션에서 입력·마스크·가중치 버전을 pin한다. 보관·삭제와 큐 접수가 경합해도 참조가 끊기지 않아야 한다. 재시도 보존 기간과 삭제 정책을 설정하고 명시적 삭제 후 재실행할 수 없는 이력에는 사유를 표시한다. 영구 결과와 파생 Pixel 버전은 기존 보관 흐름에 남긴다.
- **요청과 응답**. 기존 /jobs 및 202 응답을 유지하고 선택적 generation 블록에 mode와 입력 ID, fit 정책, strength·mask·조건 목록·버전을 둔다. 생략된 과거 요청·저장 spec은 기존 T2I argv로 해석한다. 예를 들어 I2I 계약 초안은 `{"mode":"img2img","input_id":"…","strength":0.45,"fit":"contain"}`이다. batch는 job_type 축을 유지한다. 모델 resolve 시 필수/금지 필드, 유한 강도, 모델별 크기·배수·마스크 정합성·조합을 검증한다. 접수 후 실행 직전에 파일과 빌드 서명을 재검사한다. 선택적 idempotency key를 같은 호출 주체·내용 digest로 묶고 중복 전송은 기존 ID 반환, 다른 내용 충돌은 409로 한다. 기존 client_reference는 유일 키가 아니다.
- **Capability**. /models에 모드·조건별 evidence 등급 외에 executable, 이유, 필수 파일, 허용 크기·조합·엔진 버전을 추가한다. 실제 enable은 엔진 모드·파일 digest·검증된 레시피·현재 정책의 교집합이다. fake, 구형 응답, UNKNOWN은 기존 화면으로 축소한다. UI에서 모델 변경 시 무효 조건과 해제 사유를 알리고 명시적 수정 후 제출한다. 서버도 같은 규칙으로 422를 반환한다. 각 spec에는 engine/build, 입력·마스크 해시와 변환, 모델·LoRA 순서/강도, parent asset/version, 실제 seed를 동결한다. 절대 경로와 private log는 새 공개 필드에서 제외한다.
- **실행과 복구**. 기존 SdCppEngine 안에서 검증된 모드별 argv/고정 DGL 템플릿을 선택한다. 자유 형식 CLI·스크립트 입력은 받지 않는다. 입력 데이터의 문자열이 DGL 소스로 해석되지 않도록 값 바인딩 또는 엄격한 직렬화가 필요하다. 이미지와 마스크의 임시 디렉터리는 job/item 단위다. 각 GPU 단계는 Scheduler와 GPUManager가 소유한다. 전처리·후처리까지 포함한 단계별 timeout, 프로세스 그룹 종료와 재확인, 실패 종류(입력/모델/미지원/자원/timeout/복구), 중간 asset 확정 여부를 기록한다. switch와 경합하면 기존 Busy/LockBusy 재큐와 manual grant 규칙을 보존한다. lease 재사용 구간의 barrier·정책 재평가 시점도 회귀 시험한다. 운영자 복구를 자동 retry로 대체하지 않는다.
- **화면**. Art의 생성 화면에 모델별 모드와 ‘이 이미지로 수정’을 추가한다. 기존 ‘생성 설정 재사용’은 최종 프롬프트 포커스를 보존한다. 파일 선택이 기본이며 드롭·붙여넣기는 같은 검증을 거친다. 마스크 브러시/지우개·반전·feather 및 실행 취소와 키보드 크기 조정, 파일 마스크 가져오기, 적용 영역 미리보기를 제공한다. 선택한 fit/crop/pad와 원본 보존 영역을 제출 전에 보여준다. Pixel은 프로젝트·팔레트·버전 승인 역할을 유지하고 선택한 버전을 Art 입력으로 연결한다. 모드·다이얼로그 닫기·뒤로 가기·SSE 응답이 에디터 초안과 포커스를 보존해야 한다.

| 엔진 선택지 | 이득과 비용 | 채택 조건 |
|---|---|---|
| 설치 sd-cli 유지 | 기존 T2I·게이트·프로세스 종료 경로 재사용. 설치 기능은 확인 필요 | 우선안. 설치 help·digest 및 I2I 실기 통과 |
| sd.cpp 업데이트 | DGL·제어망·수정된 메모리 처리 확보 가능. argv·메모리·화질 회귀 위험 | 승인 후 별도 바이너리로 동일 seed/모델 A/B, 이전 경로 즉시 복귀 |
| 전후처리 도구 추가 | depth/pose/얼굴 등 특정 단계만 분리, CPU 순차 가능. 패키지·가중치·좌표 일치 비용 | 내장 Canny/사전 hint로 부족하고 독립 PoC 통과 |
| 보조 생성 엔진 | 빠진 특정 conditioning 가능성. 모델 중복·새 backend·복구 책임 | 단일 기능의 GFX1013 실행과 기존 worker 종료·Gate 계약 실증 |
| ComfyUI 등 | 복합 그래프 표현 가능. Python·노드·모델 캐시·상주 프로세스·AMD backend 검증 부담 | 기존 방법으로 목표 미달, 단일 lease 아래 실행·정지·회수까지 증명한 경우 별도 승인 |
| 보류 | 안정적인 기본 생성·채팅 보존 | 가중치 미승인, 재현성·headroom·화질·지연 기준 미달 시 해당 조합 숨김 |

## 6. 작업 순서와 완료 조건

IGX01 → IGX02 → IGX03 → IGX04가 편집의 주 경로다. IGX07·08은 준비된 입력/레지스트리를 공유하지만 IGX05·06 완료를 기다릴 필요가 없다. IGX10의 계측은 첫 실기부터 시작하고 최적화는 기준선 이후에 한다. IGX09는 승격된 조합만 연결한다. 아래 파일명은 기존 모듈의 basename이며 신규 DB 변경은 backend/alembic/versions에 둔다.

| 작업·선행 | 범위·제외 / 예상 파일 | API·화면 | 엔진·메모리 / 시험·완료 조건 | 위험·롤백 |
|---|---|---|---|---|
| 00 조사 | 본 문서·소스 판독. 구현·운영 변경 제외 | 기존 계약 대조 | 버전별 근거, 미확인 항목과 재확인 절차 제시 | 운영 불일치 시 해당 셀 UNKNOWN 유지 |
| 01 입력 · 00 승인 | 업로드·기존 자산·정규화·pin/TTL, 생성 제외. middleware.py, routes.py, schemas.py, database.py, migration, api.ts, Gallery.tsx, PixelStudio.tsx | 입력 생성/조회·선택 ID, 파일 선택/드롭/붙여넣기 | CPU decode. 손상·과대·EXIF·경합·재시작 후 고아 정리 및 키보드 시험, 같은 원본이 같은 방향·크기로 복원 | 디코딩 폭증/고아. 신규 접수 끄고 pin 보존 |
| 02 재생성 · 01+설치판 PoC | SD15 한 장, fit·strength·seed·이력. registry.py, sdcpp.py, schemas.py, useGeneration.ts, App.tsx. native reference edit 별도 | generation.mode/input_id/fit/strength, 원본·결과 비교 | RV 기존 VAE encode. 강도 낮음/높음, 고정 seed, crop/contain, T2I 기존 argv 대조. 구조·스타일 변화와 서비스 복구 확인 | 입력 왜곡·강도 무시. I2I capability 해제 |
| 03 부분 수정 · 02+마스크 PoC | 브러시·지우개·반전·경계·합성. App.tsx, 신규 mask editor, schemas.py, sdcpp.py, runner.py. 전용 모델 취득 제외 | mask_id와 feather 단위·정규 좌표, 키보드/마스크 파일 대안 | RV latent mask부터. 극성 표식·전흑/전백·경계 테스트. 보존 영역 RGBA 차이 0, 수정 영역의 실제 변화 | 좌표 반전·VAE 색 변화. 마스크 모드만 닫기 |
| 04 캔버스 확장 · 03 | 방향별 여백·padding·겹침. mask editor, registry.py, runner.py. 무제한 해상도 제외 | 네 방향 여백·결과 크기·보존 영역 미리보기 | 기존 inpaint 재사용. 작은 원본→512²부터 모서리/비대칭·원본 보존·이음새 육안 판정 | 면적 OOM·경계 단절. 허용 크기 축소/모드 해제 |
| 05 참조 · 01+P-IP | SD15 Classic 단일 먼저. sdcpp.py, registry.py, models.yaml, App.tsx. FaceID·다중 기본 노출 제외 | reference_id, adapter_id, strength와 모델별 선택 | ViT-H/14+SD15 adapter, DGL. 동일 seed에서 다른 참조·강도 0/양수 비교, encoder peak·hold 측정 | 잘못된 projection·과도한 지연. 템플릿/레시피 비활성 |
| 06 구조 제어 · 01+P-Control | SD15 Canny·사전 hint, 추후 유형별 확장. sdcpp.py, registry.py, models.yaml, App.tsx. 자동 pose/depth는 별도 PoC | control 종류·hint ID·weight·strength·미리보기 | matching 제어망 1개. 다른 윤곽·강도 비교, preprocessing 전후 크기 일치, 실제 구조 추종 확인 | 유형 혼용·다중망 OOM. 유형별 해제 |
| 07 LoRA · 00 승인+기존 MOSS 기준선 | 운영자 로컬 탐색·헤더/대상/해시 등록, 프리셋. registry.py, models.yaml, sdcpp.py, schemas.py, App.tsx. 온라인 모델 허브 제외 | ID/순서/강도 목록, 기존 lora_enabled와 동시 전송 규칙·선택 목록 | MOSS 0.7과 explicit tag 중복 방지 회귀, base off/단일/복수 PoC. 낡은 spec 재시도·기반 모델 불일치 거부 | 기존 prompt 태그와 이중 적용. 새 목록 해제, 기존 경로 보존 |
| 08 확대 · 01+P-Upscale | 독립 타일 확대·포맷 변환. sdcpp.py, runner.py, schemas.py, Gallery.tsx, PixelStudio.tsx. 얼굴/hires는 탐색 한정 | scale/upscaler_id/tile, 결과를 새 버전으로 표시 | 승인된 ESRGAN 계열 1개, 입력 크기×배율 검증. 타일 경계·알파·최대 출력·메모리 확인 | 타일 seam·크기 검증(T2I 가정). 독립 모드 해제 |
| 09 연쇄 · 02/03/08 중 검증된 단계, 동시 조건은 05/06/07 해당 PoC | parent/child·중간 결과 재개. database.py, runner.py, routes.py, JobCard.tsx, Gallery.tsx. 임의 그래프 실행 제외 | 부모 자산과 단계별 job ID·상태·다시 사용, 동시 조건은 허용 조합만 | T2I→I2I/마스크→확대와 I2I+IP/I2I+Control/IP+LoRA를 별도 시험. 단계 실패·중복 요청에서 중간 파일 재사용·자식 중복 없음 | 재시도 증폭·채팅 기아. 연쇄 제출 중단, 확정 자산 보존 |
| 10 자원 조정 · 최초 PoC부터 계측, 최적화는 기준선 후 | registry.py, runner.py, gpu.py, sdcpp.py, settings 예. 상주 엔진 전환 제외 | 레시피 한도·차단 사유, 기존 job/status 계약 유지 | 512/768, Q4/Q8, tile·offload 단일 변수 A/B. 결과와 품질 보존, 메모리·지연·복구 기준 통과 조합만 승격 | UMA 중복 집계·CPU 병목. 마지막 검증 레시피 복원 |
| 11 승인 검증 · 선택된 01~10 | tests, prompt-composer-browser, 전용 evidence와 검증표. 미승인 모델 시험 제외 | 기존·신규 API/라우팅/Pixel·LLM 실제 전후 비교, 새 제품 API 없음 | 모델×레시피×빌드별 파일·로그·시간·복구 기록, UIX07 미해결 표시, 실기/모의 결과 분리 | 부분 통과를 전체에 확대하는 오류. 실패 조합만 내리고 배포 후보 보류 |

**독립 PoC**는 각각 제품 UI 착수 전 별도 결과와 승인 결정을 남긴다. 공통 선행은 접근 가능한 검증 호스트, 식별된 CLI와 승인된 파일, 기존 scheduler/lease 아래에서 실행되는 시험 어댑터다. 운영 서버에서 직접 sd-cli로 Gate를 우회하지 않는다. 실기용 임시 어댑터도 후속 승인 범위다.

- **P-Init/Mask**. 설치판 T2I 원본을 기준으로 동일 프롬프트·seed와 표식 이미지에서 strength·마스크만 바꾼다. strength 0의 허용·거절/identity 의미를 먼저 고정한다. 마스크 바깥 차이 0, 안쪽 수정, 복구 정상일 때 02/03을 각각 연다.
- **P-IP**. 설치판과 고정 후보의 로더 인터페이스를 대조한다. DGL이 필요하면 운영자 고정 스크립트에서 SD15/Classic 한 장으로 로딩·projection·attention과 다른 참조 결과를 확인한다. Plus, 두 참조, FaceID는 독립 판정한다.
- **P-Control**. 준비된 edge, 내장 Canny, 준비된 pose를 분리하고 hint 색/채널·resize를 기록한다. depth/pose 전처리 모델은 CPU 실행·종료 후 추론하고 두 단계 peak 중 큰 값을 기록한다. Z 전용·중첩 제어는 SD15 성공 후에도 별도 판정한다.
- **P-LoRA/P-Upscale**. 고정 MOSS 단일과 base에 동일 seed를 적용한 뒤 승인된 두 LoRA의 개별/동시 결과를 비교한다. 확대는 작은 RGBA 격자로 전체/타일 결과의 seam·알파를 비교한다. hires/얼굴은 별도 가중치·비용·효과를 승인할 때만 진행한다.
- **P-Combine**. 동일 init·seed의 무조건/조건 A/조건 B/A+B 네 결과에서 각 조건의 기여와 최고점을 대조한다. 공식 SDXL IP+Control 예제를 등록된 SD15 조합의 증거로 전용하지 않는다. 실패 조합은 구현 계획에서 빼도 IGX01~04를 진행할 수 있다.

## 7. 검증과 운영 인계

| 층 | 관측 항목과 합격 근거 |
|---|---|
| 1 단위 | 모드 판별·모델 조건·강도/크기 경계, EXIF 좌표 변환, 해시/seed·과거 spec 기본값 |
| 2 API 계약 | 인증, 기존 요청/응답·미지 필드·422/429/409, 중복 동시 제출, 참조 pin과 삭제 경합, 재시도 계보 |
| 3 실행 명령 | SD15/분리 모델/MOSS별 argv 비교, path를 한 인자로 전달, 동일 옵션 중복 방지, 고정 DGL resource와 실제 loader 오류 확인 |
| 4 입력·마스크 | orientation 1~8, 알파, 손상·다중 프레임·표기와 실포맷 불일치, 픽셀 상한, 흑백/반전·feather·fit·보존영역 diff |
| 5 화면 컴포넌트 | capability 없음/변경, 키보드 파일 선택·모드 이동, draft 보존, 검증 실패·중복 접수 안내 |
| 6 브라우저 | 좁은 화면/데스크톱, 파일 선택·drop·paste·마스크 취소, 뒤로/앞으로·새로고침·직접 진입, Pixel→Art→결과 |
| 7 모델 호환성 | 모든 등록 ID, 누락 파일, 잘못된 family·encoder·LoRA, 동일 입력/seed의 조건 대조. fake 결과는 simulated 표시 |
| 8 BC-250 Vulkan | 장치/드라이버·빌드/가중치 digest, 실제 backend와 fallback 로그, 출력 PNG·metadata·사람이 본 구조/색/경계. 파일 존재만으로 검은 이미지 통과 금지 |
| 9 자원·실용성 | cold 1회+warm 반복 3회부터 샘플 수 명시. 로딩/encode/sample/decode·총 시간, 채팅 재개까지 초, 최소 MemAvailable·swap·PSI·cgroup peak와 회복, 시간대별 샘플·실패도 보존 |
| 10 장애·복구 | 취소 시점(대기/실행/단계 사이), timeout·자식 잔존, 비정상 종료·재기동, 모델 교체 경합·health 실패. 격리 VM에서 먼저 주입. terminal 상태·중간 결과·lock/journal·소유 hold·원래 LLM 상태 비교 |
| 11 회귀 | 기존 T2I/배치/preset·SSE·과거 메타데이터·Pixel 승인, UIX01~06A 및 UIX07 인계, 원래 활성 LLM의 실채팅 전후 성공과 원래 비활성 서비스 보존 |

이번 분석에서 기존 test_sdcpp.py, test_moss.py, test_gpu.py, test_gpu_owned_holds.py의 **48개 테스트가 통과**했다. 로컬 임시 DB·테스트 엔진 범위다. 기존 운영 검증 진입점은 [Studio 릴리스 테스트](../scripts/test-studio.sh), [VM switch 검증](../scripts/test-switch-success-vm.sh), [브라우저 하네스](../scripts/prompt-composer-browser/verify.sh)다. 실기 증거 묶음에는 job/item ID, 비밀을 제거한 실행 로그, 원본·마스크·결과 digest, 비교용 PNG, cold/warm 시계열, 서비스 상태와 판정자를 함께 둔다. 동일 레시피라도 엔진·모델 digest나 드라이버가 바뀌면 재검증한다.

### 운영자용 읽기 전용 확인

기존 유지보수 접근이 가능한 단말에서 [읽기 전용 인벤토리](../scripts/ucp09/inspect-bc250.sh)를 실행할 수 있다. 아래는 BC-250 호스트에서 실행하는 보완 조회다. cli 경로는 저장소 기본값이므로 배포된 STUDIO_SD_CLI가 다르면 그 경로로 대체한다. 설치 트리 HEAD는 바이너리 출처를 단독 증명하지 못하므로 버전 출력·sha256·CMakeCache를 함께 기록한다.

```sh
cli=/opt/stable-diffusion.cpp/build-vulkan/bin/sd-cli
readlink -f "$cli"
sha256sum "$cli"
"$cli" --version
"$cli" --help
git -C /opt/stable-diffusion.cpp rev-parse HEAD
rg '^(SD_VULKAN|GGML_VULKAN|SD_CUDA|SD_BUILD_EXAMPLES):' /opt/stable-diffusion.cpp/build-vulkan/CMakeCache.txt
find /opt/sd-models -type f -printf '%s %p\n'
sha256sum /opt/bc250-ai-studio/config/models.yaml
vulkaninfo --summary
free -h
cat /proc/pressure/memory
systemctl show bc250-ai-studio.service bc250-llm-gate.service llama-server.service -p Id -p ActiveState -p SubState -p MainPID -p MemoryCurrent
```

사용 중인 인증 세션으로 GET /api/v1/models, /api/v1/system/status, /api/v1/system/capabilities를 조회해 파일 목록과 대조한다. 실제 LLM unit이 예시와 다르면 설치된 unit 이름을 사용한다. 모델 버전 고정이 필요한 PoC에는 사용 파일의 sha256도 남긴다. 위 조회만으로 실행·성능 등급을 올리지 않는다.

### 승인 요청

1. **다음 작업 범위** — IGX01 입력 자산과 UIX 회귀 기준부터 진행할지, 열린 UIX07을 별도 선행 태스크로 완결할지 결정한다. 기본 제안은 새 화면 배포 전 UIX07 결과를 확보하는 것이다.
2. **데이터 계약** — 초기 PNG/JPEG·EXIF 제거, 업로드/해상도 한도, 임시 TTL과 이력 삭제 후 재현 보장 기간, 마스크 외부 픽셀 완전 보존 정책을 확정한다.
3. **실기 시간과 합격선** — SD15 512²·batch 1을 첫 검증 대상으로 하고 채팅이 중단될 수 있는 시험 시간, 허용 지연·여유 메모리·복구 목표를 정한다.
4. **엔진과 가중치** — 설치 엔진 유지가 기본안이다. 별도 바이너리 시험, DGL 템플릿 도입, IP/Control/ESRGAN 파일·라이선스·디스크 예산은 각 PoC 전에 승인한다. 보조 엔진·ComfyUI·FaceID는 독립 결정이다.

이번 산출물은 설계안이다. IGX01 구현과 운영 실기는 승인 대기다.
