# Phase 0 / Phase 1 validation record

Date: 2026-10-24 (Asia/Seoul).
Host: macOS Darwin ARM64, not the Fedora BC-250 target.
Inventory Python: 3.13.3; uv-selected project interpreter: CPython 3.13.15.
Dependencies are pinned by uv.lock. No existing LLM/GPU services were stopped,
no model files were downloaded, and no GPU inference was executed.

## Executed results

- `.venv/bin/python -m pytest -q`: **47 passed**, 3.05 seconds.
- `.venv/bin/ruff check .`: **passed**.
- `.venv/bin/ruff format --check .`: **38 files already formatted**.
- `sh -n scripts/dev.sh`: **passed**.
- `python3 scripts/probe_server.py --help`: **passed**.

One dependency warning: the installed Starlette TestClient warns that httpx support
is deprecated in favor of httpx2. The tests currently pass using the locked httpx
version. This is not a hardware compatibility warning.

## Evidence and coverage

| Required area | Evidence |
| --- | --- |
| Model registry, missing files | test_registry_missing_files_and_presets |
| Job submission/status/results | test_generate_assets_metadata_and_namespace |
| Batch seeds and per-item outcomes | test_batch_seed_and_results, test_batch_failure_preserves_first_image |
| Cancel queued/running | test_manual_grant_and_cancel, test_running_cancel_preserves_partial_outputs |
| Failure/retry preserving settings | test_failed_retry_preserves_settings |
| Restart recovery | test_restart_recovery_keeps_queued_work, test_journal_blocks_until_admin_recovery |
| Concurrent requests/GPU locks | test_concurrent_submissions, test_gpu_serializes_simultaneous_leases, test_gpu_lock_across_instances, test_single_instance_lock |
| LLM stop, worker, restart failures | parameterized test_llm_recovery_after_failure |
| Active chat protection | test_busy_drain_does_not_stop_llm, slot-schema/timeout tests |
| Policy transitions | image_priority, chat_priority and image-boundary policy tests |
| Model/seed/output metadata | generation and batch tests; authenticated PNG retrieval |
| SSE reconnect/replay | test_sse_replay_terminal_and_bad_cursor |
| Auth/admin | test_authentication_and_admin |
| Traversal/input limits | test_traversal_and_symlink, parameterized invalid inputs, body limit |
| CLI injection/timeout cleanup | test_argument_array_and_model_specific_options, test_worker_timeout_reaps_process |
| Allowlisted service/admission/memory checks | test_llm_adapter.py |
| Pixel processing / Phaser atlas | Deferred to Phase 3; not implemented or claimed tested |

The service tests use FakeLLM or mocked HTTP/command responses. The CLI timeout test
runs a temporary Python sleeper, never sd-cli. API tests use FastAPI TestClient and
a real temporary SQLite database/filesystem, including migrations and restarts.
They verify API -> queue -> CPU fake image -> metadata -> protected file delivery.

## Remaining verification

- Actual Fedora service permissions, cgroup termination and Vulkan memory observation.
- Installed sd-cli option compatibility and each real model's inference.
- External admission gate integration for all existing chat clients.
- Explicitly approved real LLM stop/restart and one-image end-to-end test.
- Browser interaction through the SSH tunnel (Phase 2), Pixel/Phaser tests (Phase 3), integrated chat proxy (Phase 4).

Hardware tests are a separate manual procedure in DEPLOYMENT.md and are never
triggered by the default pytest suite. Fake results do not certify BC-250 operation.

## 2026-10-26 model-option regression record

The following checks were run locally on macOS without GPU inference, service
restart, or deployment:

- `.venv/bin/pytest` — **65 passed**.
- `.venv/bin/ruff check backend/app backend/tests` — passed.
- `npm --prefix frontend run lint` — passed.
- `npm --prefix frontend run build` — passed (`tsc -b` and Vite production build).

| Value path | Regression evidence |
| --- | --- |
| `/models` capability response and legacy YAML fallback | `test_models_publish_typed_generation_capabilities`, `test_registry_generation_capability_has_legacy_fallback_and_is_type_checked` |
| Request enum/fixed-value rejection | `test_job_option_enums_reject_sd_cli_aliases_and_fixed_scheduler` |
| PornMaster CFG and conditional negative prompt resolve | `test_pornmaster_cfg_and_negative_prompt_contract_is_resolved_before_execution` |
| Resolved sampler/scheduler to one argv flag; pre-T04 spec fallback | `test_dynamic_sampler_and_scheduler_are_emitted_once_and_legacy_specs_keep_cli_args` |
| Job spec → frozen snapshot → retry → asset metadata | `test_generation_options_survive_job_metadata_and_retry` |
| Old job/metadata nullable reads and retry without reinterpretation | `test_legacy_job_and_metadata_default_new_option_fields_without_reinterpretation` |
| Capability UI type and conditional payload compilation | TypeScript check within `npm --prefix frontend run build`; lint within `npm --prefix frontend run lint` |

The frontend currently provides selectors only for capability values that are
changeable. It shows fixed sampler/scheduler values but does not send them. No
React component test runner is configured in this repository. Browser and actual
BC-250 generation tests remain manual, separately approved work.

## 2026-10-26 T08 BC-250 PornMaster execution record

User-operated BC-250 validation completed with real `sdcpp` execution
(`simulated: false`) under manual policy. Four 512×512 PNGs were saved and locally
preserved in `docs/t08-pornmaster-20261026-073336/`:

| CFG | Negative prompt | Job | Asset | Job elapsed |
| --- | --- | --- | --- | --- |
| 1.0 | empty | `6bec2883073f4ad79f3714670a5b3f1e` | `275d58ad108f48ceaed54b8687b01737` | 49.536s |
| 1.5 | empty | `cd9ce74c5555442fa06a37ea5bfbe185` | `d52cf546edcf4f7aa86816b6d2712dc3` | 66.290s |
| 2.0 | empty | `731c37e8f0394f9392955473c9173ebc` | `0bba2c6595b842f391ef78aec5a36890` | 66.650s |
| 2.0 | `avoid blur, low contrast` | `490bb708d7fc437e830d1131b47a785f` | `631215936b764e5bad4a2ee00721463a` | 66.798s |

All jobs used the same safe-for-work teacup prompt, 4 steps, Euler, scheduler
omitted, and seed 4242. Every job and metadata record contains the requested
resolved CFG/negative prompt, `sampling_method: euler`, `scheduler: null`, and
`simulated: false`. The before/after status has no recovery block or error;
llama-server remained `active` with `KillMode=control-group` and a changed MainPID,
consistent with the controlled transition. No reliable GPU memory counter was
configured. The Studio journal contains access logs but not a complete sd-cli argv,
so exact runtime argv capture remains unavailable.


## 추가: 사용자 실행 Fedora 배포 검증

사용자가 제공한 로그에서 Fedora 43 / Python 3.14.0 의존성 설치, systemd 시작,
미인증 401, 인증 상태 조회 및 Mac SSH 터널을 통한 Fake 작업 완료·SSE·PNG 다운로드를
확인했습니다. 결과 메타데이터는 seed=42, 512×512, simulated=true입니다.
이는 위 로컬 pytest 47개를 Fedora에서 재실행했다는 의미는 아닙니다.
실제 Vulkan 추론과 LLM 서비스 전환은 아직 검증 전입니다.

## 추가: 사용자 실행 실제 API 전환 검증

Klein Q4 작업 `7e6709375e1d4170a33c8bf9a6a0de63`이 manual grant 후 sdcpp/Vulkan0에서
완료됐고 asset `e7140880b4e148e8b661f0d2758ab57d`이 저장됐습니다. 로그상 gate를 통한
LLM 정지, sd-cli 실행, LLM start/health, gate resume이 성공했으며 시스템 오류·recovery
요구 상태는 없었습니다. 외부 SSH 터널을 통한 이 실제 asset의 다운로드는 다음 확인 단계입니다.
사용자가 이후 Mac에서 asset을 다운로드·열고 metadata의 `simulated: false`를 확인하여,
외부 클라이언트 반환 경로도 검증되었습니다.

## 추가: 사용자 실행 실제 Vulkan 단일 이미지 검증

Klein 4B Q4 / 512×512 / 4 steps / seed 42를 ai-studio 계정에서 수동 실행하여
Vulkan0 추론, 이미지 저장 및 Pillow 검증 성공을 확인했습니다. CPU offload를 제거한
기본 auto-fit 사용; generate_image 로그 11.57초. 이전 offload 사용 실행은 실패했습니다.
이는 독립 sd-cli 검증이며 API 큐의 실제 엔진 실행이나 LLM 자동 전환의 성공을 뜻하지 않습니다.
자세한 비교와 결과 경로는 BC250_ENVIRONMENT.md에 기록했습니다.
