# 모델 전환: 로컬 작업과 서버 작업 구분

> 최신 배포 차단 항목과 완료 조건은 [운영 배포 작업 목록](./LLM_MODEL_SWITCH_DEPLOYMENT_TASKS.md)을 참고합니다. 아래는 시점별 작업과 시험 기록으로, 당시의 미완료 표현이 현재 상태와 다를 수 있습니다.

기준: 저장소 코드와 모의 서비스·분리된 root 네임스페이스에서 확인한 결과, 운영자가 알려준 Fedora 설정. 아래 명시한 배포 스크립트 교체는 운영자가 직접 수행했습니다. 실제 전환 기능은 아직 운영에 배포하거나 켤 단계가 아닙니다.

운영자 확인: 기존 배포 스크립트는 root 소유이며, 새 구성 감지 시 기존 배포를 거절하는 후보를 서버에 설치했습니다. 이전 스크립트는 `/var/backups/bc250-ai-studio-deploy.oc2Mslhn`에 백업했습니다. 이는 최초 이전이나 이후 배포 절차의 검증을 대신하지 않습니다. Studio와 gate의 종료 제한은 각각 15분과 30초이고, 확인 시 두 서비스는 `Restart=on-failure`였습니다.

추가 시험: 운영자가 Fedora 43 rootless Podman 컨테이너에서 Python 3.14.8과 일반 UID로 백엔드 테스트 248개 및 Ruff를 통과했습니다. root 네임스페이스 전용 6개는 건너뛰었습니다. 컨테이너 시험은 실제 서비스의 systemd·SELinux·GPU 검증이 아닙니다.

이어 같은 Fedora rootless 컨테이너 내부의 UID 0으로 별도 root 전용 테스트 6개도 통과했습니다. 잠금·파일 소유권, 비밀값·상태 준비, 비편집 패키지 설치를 컨테이너 파일시스템에서 확인한 결과이며 호스트 root UID나 호스트 SELinux·systemd를 검증한 것은 아닙니다.

격리 VM 조사: 운영자 확인 시 QEMU 10.1.0과 qemu-img가 있고 KVM 장치는 없었습니다. CPU 12개, 메모리 7.5GiB 중 사용 가능 3.7GiB, 스왑 7.5GiB, 부하 평균 0.05/0.10/0.04는 조회 시점의 값입니다. 소프트웨어 에뮬레이션은 가능하나 운영 자원을 공유하고 느리므로 VM 실행 전 여유 메모리와 GPU 작업 상태를 다시 확인해야 합니다. VM 초기화·안전한 정지 및 systemd/SELinux 시험 절차는 아직 준비되지 않았습니다.

운영자가 Fedora 43 Cloud 이미지 `Fedora-Cloud-Base-Generic-43-1.6.x86_64.qcow2`를 `/home/yeppyshiba/bc250-fedora43-test-vm`에 내려받고 Fedora 43 공식 키 지문과 서명, SHA-256 `846574c8a97cd2d8dc1f231062d73107cc85cbbbda56335e264a46e3a6c8ab2f`를 확인했습니다. 별도 쓰기 디스크와 제한된 네트워크로 QEMU를 실행했고 SSH 접속, Fedora 43, SELinux Enforcing, systemd 실행과 cloud-init 완료를 확인했습니다. 서비스 시험과 안전한 종료 절차의 검증은 남아 있습니다.

시험 VM에 SHA-256으로 확인한 소스를 복사했고 Python 3.14.0, systemd 258 및 시험 전용 sudo 접근을 확인했습니다. VM 네트워크는 제한된 상태입니다.

운영 서버의 uv와 필요 라이브러리, 잠금된 의존성 캐시를 시험 VM으로 전달한 후 SELinux Enforcing 상태에서 root 소유 비편집 코드 설치와 격리 Python 모듈 가져오기가 성공했습니다. 처음 uv 공유 라이브러리 누락으로 중단된 디렉터리는 VM 내부에 별도 보관했습니다. 서비스 접근과 정책은 아직 시험하지 않았습니다.

시험 VM에서 후보 systemd 소켓은 활성화됐으나 작업자 초기화가 신뢰 경로 검사에서 실패했습니다. 원인은 VM의 `/`가 root:root 0775인 점입니다. 운영자가 확인한 운영 서버의 `/`는 root:root 0555이고 추가 ACL 항목이 없었습니다. 운영 서버의 나머지 상위 경로도 배포 전에 같은 조건을 확인해야 합니다.

시험 VM의 `/`를 0755로 조정한 뒤 실제 systemd 소켓 활성화와 root 작업자 기동, ai-studio의 가짜 모델 목록 조회, 전환 비활성화 응답, nobody 계정의 소켓 접근 차단을 SELinux Enforcing 상태에서 확인했습니다. 운영 서버의 권한은 변경하지 않았습니다. 게이트·실제 모델·GPU는 이 시험에 사용하지 않았습니다.

이어 시험 VM의 관리 HTTP 서비스를 systemd로 실행해 loopback 8091 수신, 미인증 요청 401, 인증된 가짜 모델 조회 200, 비활성 전환 요청 503을 확인했습니다. 실제 gate·모델·GPU는 사용하지 않았습니다.

시험 VM의 별도 ai-gate 계정과 영구 상태 파일로 gate를 기동해 미인증 401, 관리자·Studio·전환 키의 역할 구분, startup 보류 생성, 타 역할의 Studio 보류 해제 거절을 확인했습니다. gate를 재시작한 뒤 startup·관리자·전환 보류가 유지되는 것도 확인했습니다. 실제 운영 이전은 아직 검증하지 않았습니다.

시험 VM에서 gate 상태 디렉터리의 쓰기를 일시 차단했을 때 보류 생성이 실패해도 실행 중 gate가 보류를 유지했고, 권한 복구와 재시작 후 startup 및 기존에 저장된 관리자 보류가 보존됐습니다. 이 시험은 디스크·원자적 교체·동기화 실패의 모든 형태나 실제 운영 이전을 검증하지 않습니다.

시험 VM에서 root와 ai-studio가 같은 `/run/bc250-gpu/gpu.lock` inode를 사용하며 한쪽이 잠금을 보유할 때 다른 쪽이 차단되고 해제 후 획득할 수 있음을 확인했습니다. ai-studio의 빈 전환 기록 읽기도 확인했습니다. 실제 이미지 생성 및 모델 전환 경쟁 시험은 아닙니다.

시험 VM에서 관리 API·작업자를 중지하고 공유 잠금 안에서 가짜 전환 기록을 원자적으로 저장한 뒤 ai-studio가 동일한 기록을 읽고, 기록을 빈 상태로 복원했습니다. SELinux Enforcing 상태에서 수행했으며 실제 GPU나 모델 전환은 없었습니다.

전환이 비활성화되고 journal이 빈 상태에서 시험 VM의 root 작업자를 강제 종료했습니다. systemd 재시작, 관리 API의 가짜 모델 재조회, 빈 journal과 gate startup 보류 유지가 확인됐습니다. 전환 도중 강제 종료·복구 시험은 아닙니다.

시험 VM에서 레거시 호환 gate에 기존 관리자 pause를 설정하고 이전 도구의 capture 및 create-state를 수행했습니다. 새 소유권 gate 기동 후 legacy와 startup 보류가 모두 유지됐습니다. 시험 도중 systemd drop-in 순서 및 상태 디렉터리 이전 순서 오류를 수정해 이어 진행했으며, 실제 운영 중인 구버전 gate의 이전 검증을 대체하지 않습니다.

시험 VM에서 Studio가 비활성인 상태로 `confirm-startup`을 호출했을 때 명령이 실패하고 startup 및 legacy 보류가 유지됐습니다. 이 결과만으로 어느 검사에서 거부했는지나 정상 조건에서의 보류 해제를 입증하지는 않습니다.

이어 시험 VM에서 가짜 LLM과 시험 Studio 조율 응답을 사용해 `confirm-startup` 정상 경로를 수행했습니다. startup 보류만 해제되고 이전 legacy 보류가 유지됐습니다. LLM과 이미지 엔진은 시험용이므로 실제 하드웨어 검증은 아닙니다.

이후 시험 VM에서 fake에서 fake-next로 자동 전환을 시도했으나 recovery_required가 됐습니다. 확인 시 journal은 비어 있고 활성 모델은 fake이며 gate는 legacy 보류를 유지하고 DB에 복구 필요 작업이 남아 있습니다. 원인 확인과 검증된 복구까지 이 상태를 보존하고 운영 적용을 진행하지 않습니다.

원인 재현: 준비 도구가 만든 journal은 `unconfined_u:object_r:var_lib_t:s0`, systemd 작업자가 만든 교체 파일은 `system_u:object_r:var_lib_t:s0`이었습니다. 시험용 파일에서 동일한 쓰기 거절을 재현했고 `restorecon -F`로 정책 기본 레이블을 적용하면 쓰기가 성공했습니다. 신규 journal 준비 코드에 레이블 정규화를 추가했으나 실제 배포 환경의 정책과 기존 `active-model.conf`도 별도 확인해야 합니다. 기존 복구 기록은 아직 변경하지 않았습니다.

수정된 준비 도구를 SELinux Enforcing 시험 VM의 별도 신규 디렉터리에 실행해 journal에 `system_u:object_r:var_lib_t:s0`이 적용되고 systemd 작업자가 쓰고 비울 수 있음을 확인했습니다. 기존 복구 대기 기록 및 운영 서버에는 적용하지 않았습니다.

시험 VM의 빈 journal과 fake 모델 health를 확인한 후 독립 관리자 복구 보류를 설정하고 `resolve_verified`로 복구 대기 작업을 `failed`/`interrupted`로 정리했습니다. 시험 작업자의 전환 기능을 다시 끄고 독립 복구 보류만 해제했으며 기존 legacy 보류는 유지했습니다.

이후 시험 VM에서 공유 잠금과 legacy 보류를 유지한 채 빈 journal의 SELinux 레이블을 정책 기본값으로 교정했고 fake에서 fake-next로 실제 systemd 작업자 전환이 성공했습니다. 활성 설정 변경, 빈 journal 및 legacy 보류 유지, 시험 작업자의 전환 비활성화 복원을 확인했습니다. 실제 GPU·운영 모델과 전환 중 장애 복구는 시험하지 않았습니다.

별도의 시험 설정 파일로 레이블 교정 전 백업의 내용·소유권·권한·SELinux 및 ACL 일치를 확인했습니다. 정책 레이블 교정 후 내용과 권한이 유지됐고 systemd 임시 파일과 보호 속성이 일치했습니다. 이어 백업 파일을 원자적으로 복원해 원래 내용과 보호 속성이 돌아온 것을 확인했습니다. 이는 단일 시험 파일의 복원이며 운영 서비스·DB·gate 상태를 포함한 전체 롤백 시험은 아닙니다.

운영 서버의 `active-model.conf`는 `unconfined_u:object_r:usr_t:s0`이며 정책 기본 레이블은 `system_u:object_r:usr_t:s0`으로 확인됐습니다. 이 파일도 systemd 작업자의 원자적 교체 시 레이블 불일치 가능성이 있습니다. 시험 VM에서는 두 레이블이 일치했지만 운영 서버 파일에는 아직 어떤 변경도 하지 않았습니다. 실제 작업자와 동일한 보안 문맥에서의 정책·ACL 확인 및 복구 절차가 필요합니다.

운영 서버에서 작업자와 유사한 systemd 제한을 적용한 일회성 진단으로 기존 활성 설정의 `unconfined_u:object_r:usr_t:s0`과 임시 파일의 `system_u:object_r:usr_t:s0`이 다름을 확인했습니다. 운영 활성 설정은 변경하지 않았습니다. 전환 전에 journal 및 활성 설정의 교체 메타데이터를 검사하고 실패 시 보류·journal 변경 전 거절하는 후보 코드를 추가했으며, Fedora 전체 시험과 운영 배포 절차 검증은 남았습니다.

운영자 확인: 모델 관리 API를 호출할 클라이언트 백엔드는 같은 Fedora 서버에서 실행됩니다. 관리 API의 loopback 경로를 사용할 수 있지만, 클라이언트의 실제 관리자 인증과 전용 키 전달·보관 검증은 남았습니다.

운영자 확인 시 Caddy는 외부 80번 포트에서 수신하며 내부 80xx 서비스로 프록시합니다. llama-server 8080, gate 8081, Studio 8090은 각각 `127.0.0.1`에서 수신하고 있었습니다. 이는 조회 시점의 리스너 상태이며 Caddy 경로별 라우팅이나 로컬 프로세스의 직접 접근을 차단하는 유지보수 절차를 보장하지 않습니다.

현재 Caddy 구성의 대상 포트 제한 조회에서는 `/api/*` → loopback 8090이 확인됐습니다. 이 조회는 8010 등 다른 포트를 제외했으므로 전체 호출자 목록이 아닙니다. 별도 `bc250-llm-client` 저장소의 배포 예시는 `/llm/api/*` → 8010 → gate 8081이며 그 저장소의 로컬 워크플로에는 `main` push 배포가 설정돼 있습니다. 실제 운영 활성 여부와 원격 워크플로 상태는 별도로 확인해야 합니다.

추가 운영 확인: `bc250-llm-client.service`가 `yeppyshiba` 계정으로 실행되고 loopback 8010에서 수신하며 Caddy의 `/llm/api/*`가 해당 포트로 연결됩니다. 운영 Caddyfile에는 별도 `/wiki/*` → 8020 경로가 있습니다. 최초 이전 시 Studio와 LLM Client 양쪽 API 및 로컬 직접 호출자를 유지보수 범위에 포함하고 Wiki는 보존해야 합니다. 로컬 LLM Client 소스는 gate 관리 키를 사용하므로 키 교체·백업·서비스 재시작과 실제 배포 버전을 함께 검증해야 합니다. 별도 클라이언트의 원격 자동 배포 상태는 아직 확인되지 않았습니다.

공유된 운영 Caddyfile을 기준으로 두 API 경로만 503으로 처리하는 후보를 작성하고, 별도 loopback 포트의 Caddy와 가짜 Wiki로 두 503 응답·정적 경로·Wiki 프록시를 확인했습니다. 실제 Caddy 설정에는 적용하지 않았으며 기존 직접 호출자와 적용·복구 절차 확인이 남았습니다.

신규 gate 관리자 키를 root 전용 `client-gate.env`와 LLM Client systemd drop-in으로 전달하는 후보를 추가했습니다. SELinux Enforcing 시험 VM에서 실제 systemd 환경 파일의 우선순위, 클라이언트 계정의 파일 직접 읽기 차단, root 작업자 제한 환경에서 해당 파일 접근 차단을 시험용 키로 확인했습니다. 프로세스 환경에 키가 전달되므로 클라이언트 실행 계정은 관리자 권한을 가진 신뢰 경계입니다. 운영에 적용하지 않았고 실제 운영 Client의 버전과 인증 경로 확인이 남았습니다.

운영 확인: 실행 중인 LLM Client의 `main.py`와 `config.py`는 노트북의 해당 소스 해시와 일치했습니다. 프로세스 환경에 있는 클라이언트 gate 키로 현재 gate `/control`을 읽으려는 시도는 HTTP 401로 거절됐습니다. 키 불일치 또는 gate의 실제 적용 설정을 추가로 확인해야 하며, 현재 운영 키는 변경하지 않았습니다.

이후 두 운영 프로세스의 키를 출력 없이 비교한 결과 서로 달랐고, gate 프로세스의 키로는 인증이 성공했습니다. 따라서 현재 LLM Client의 관리자 제어 경로는 인증 실패 가능성이 높습니다. 신규 키 이전 후 프로세스·gate 역할·재시작 여부를 확인하는 root 전용 후보 도구를 추가했으며 운영 키는 변경하지 않았습니다.

운영 llama-server 프로세스에서 확인한 API 키 실행 옵션과 관련 환경변수는 없었고 인증 없는 `/health`와 `/v1/models`는 각각 200을 반환했습니다. 이 검사는 추론 API 전체의 인증이나 대화 호환성을 입증하지 않습니다.

새 검증 도구를 SELinux Enforcing 시험 VM의 실제 systemd gate와 클라이언트 프로세스에 적용했습니다. 잘못된 시험 키를 거절하고 drop-in으로 새 키를 적용한 후 관리자 역할과 서비스 상태 확인에 성공했습니다. 실제 운영 Client의 키와 서비스는 변경하지 않았습니다.

수정된 `confirm-startup --expected-client-user` 후보도 시험 VM에서 검증했습니다. 실제 systemd 시험 프로세스의 키가 다르면 startup·legacy 보류가 유지되고, 키를 맞춘 뒤에는 startup만 해제되고 legacy가 유지됐습니다. 시험 LLM을 사용한 결과이며 운영 서비스와 실제 키는 변경하지 않았습니다.

시험 VM에서 새 가짜 모델의 systemd 시작을 실패시켜 `restart_failed`를 발생시켰습니다. 작업자가 이전 가짜 모델을 다시 시작·health 확인하고 `failed_rolled_back`으로 종료했으며 journal을 비우고 기존 legacy 보류를 유지했습니다. 이전 모델 자체의 복구 실패 및 실제 GPU 장애는 이 시험에 포함되지 않습니다.

이어 시험 VM에서 대상 가짜 모델과 이전 가짜 모델의 시작을 모두 실패시켰을 때 `recovery_required`와 journal·전환/legacy 보류가 유지됐습니다. 시험 장애를 제거한 뒤 root 복구 명령으로 이전 모델 health를 확인하고 journal·전환 보류만 정리했습니다. 실제 GPU 장애나 운영 모델은 사용하지 않았습니다.

추가로 시험 VM에서 가짜 LLM의 systemd 재시작이 진행 중일 때 작업자를 강제 종료했습니다. 작업자가 재시작된 뒤 journal과 전환·legacy 보류가 유지됐고, systemd 작업이 끝나기 전 복구 요청은 완료되지 않았습니다. 해당 작업을 종료한 뒤 수동 복구로 이전 가짜 모델의 health, 빈 journal, legacy 보류 유지를 확인했습니다. 시험은 성공 후 VM을 정상 종료했으며 실제 운영 모델과 GPU는 사용하지 않았습니다.

위 검사 후보를 포함한 소스를 Fedora 43 rootless 컨테이너의 Python 3.14에서 시험해 백엔드 256개와 Ruff가 통과했고 root 전용 6개는 건너뛰었습니다. 이는 코드의 모의·컨테이너 검증이며 수정된 후보로 실제 systemd 전환과 운영 배포 절차를 검증한 것은 아닙니다.

수정된 후보를 별도로 복사한 Fedora 시험 VM에서 SELinux Enforcing 및 작업자에 준하는 systemd 제한을 적용했습니다. 시험 journal과 활성 모델 설정 각각의 레이블을 불일치시켰을 때 gate 보류·journal 변경 전 거절됐고, 레이블이 일치하면 가짜 모델 전환과 legacy 보류 유지가 성공했습니다. 실제 운영 모델·GPU 또는 운영 이전 시험은 아닙니다. 시험 VM은 성공 후 정상 종료했습니다.

운영 서버에서 일회성 레이블 진단을 `systemd-run --pipe`로 두 번 시도했으나 `Remote peer disconnected`가 발생하고 진단 서비스 로그가 확인되지 않았습니다. 조사 시 운영 서비스 세 개는 활성, 커널 OOM 기록은 없었으며 가용 메모리는 1.7GiB이고 시험 QEMU는 실행 중이었습니다. 연결 종료의 원인은 확정하지 않았습니다.

이후 시험 VM을 정상 종료했고 가용 메모리가 3.7GiB로 돌아왔습니다. 중간에 대화형 Bash에서 `set -u`를 실행해 프롬프트 변수가 미설정 오류를 일으키며 SSH가 끊겼으므로, 추가 명령은 별도 Bash에서 실행합니다. 시험 VM 디스크와 기록은 보존됐습니다.

## 로컬에서 진행한 작업

- 전용 HTTP API → 제한된 Unix 소켓 → 단일 root 작업자 → 기존 모델 설정·systemd 어댑터를 연결했습니다. 임의 명령은 받지 않으며 전환은 기본적으로 꺼져 있습니다.
- gate 관리자·Studio·전환 키와 hold를 분리했습니다. gate 재시작 시 `startup` 보류를 두며, Studio가 실제로 새 공유 잠금·복구 계약과 gate의 Studio 역할을 사용하고 있는지 전환 전에 확인합니다. 로컬 loopback 인증 요청에는 환경 프록시를 사용하지 않습니다.
- GPU 잠금 경합 대기, LLM 요청 drain, 관리자 pause 유지, 재시작 실패·이전 모델 복구 실패, 실제 GGUF ID 확인, journal·DB 불일치와 고아 hold의 제한된 복구 후보를 구현했습니다. 수동 `ai-model`의 안전 절차 우회는 운영자가 허용한 예외입니다.
- HTTP→소켓→실제 gate 앱→모의 systemd/모델 registry를 연결해 성공·복구·실패를 시험했습니다. 별도 모의 작업자 프로세스를 hold 획득 전후, drain, 모델 적용, health, hold 해제 직후에 강제 종료하고 재시작해 기록과 차단 상태를 확인했습니다.
- Linux 사용자·마운트 네임스페이스에서 실제 root 소유 테스트 파일로 flock, journal·모델 설정 권한, 비밀 파일 생성·덮어쓰기 방지와 잠금 의존성 기반 비편집 코드 설치를 확인했습니다. 이는 Fedora SELinux와 실제 다중 UID 검증을 대신하지 않습니다.
- Python 3.12·3.14에서 각각 백엔드 245개 테스트를 통과했고 root 네임스페이스 전용 6개는 별도로 모두 통과했습니다. Ruff, 프런트엔드 lint·빌드, Python 3.14 비편집 패키지 설치·isolated import도 확인했습니다. systemd 유닛은 로컬에 없는 실행 파일 경로만 임시 복사본에서 대체해 문법을 검사했습니다.
- `main` push 자동 배포를 저장소 워크플로에서 제거했습니다. 기존 수동 워크플로는 새 gate·root 작업자와 동기화되지 않으므로 새 구성에 사용하면 안 됩니다. 원격 저장소의 실행 설정은 이 변경을 반영하기 전까지 기존 상태입니다.

## 서버 정보만으로 확인 가능한 작업 — 서비스 변경 없음

1. 설치된 모든 LLM 모델 설정이 후보 파서의 리터럴 문법을 지원하고, 지정 GGUF 파일이 존재하는지 확인합니다. 설정값·키·모델 파일 경로는 출력하지 않습니다. [검사 스크립트](../deploy/model-control/check-model-configs.py)가 같은 검사를 구현하며, 서버에 파일을 아직 올리지 않았다면 아래 독립 명령을 사용할 수 있습니다.
2. 서버의 systemd 버전, root가 관리하는 `uv` 실행 파일 위치·권한, 관리 API 포트와 후보 계정의 사용 여부를 확인합니다. 이 결과에 따라 코드 준비 명령을 조정합니다.
3. client 백엔드가 같은 기기인지 다른 기기인지와 기존 접근 경로를 확인합니다. 다른 기기라면 TLS·인증된 백엔드 연결 방식이 필요합니다. 단일 사용자 인증은 현재 유지하고 ID별 격리는 별도 TODO입니다.

아래 명령들은 읽기 전용이며 서비스나 GPU를 건드리지 않습니다. **환경 파일을 `cat`하거나 키 값을 출력하지 않습니다.**

```bash
python3 --version
systemctl --version | sed -n '1p'
ss -H -ltn 'sport = :8091'
if getent passwd ai-gate >/dev/null; then id ai-gate; else echo 'ai-gate 계정 없음'; fi
for candidate in /usr/bin/uv /usr/local/bin/uv; do
  if [ -e "$candidate" ]; then
    stat -Lc '%A %U:%G %n' "$candidate"
  fi
done
```

```bash
python3 - <<'PY'
import os
import re
import stat
from pathlib import Path

files = sorted(Path('/opt/ai/config/models').glob('*.conf'))
if not files:
    print('모델 설정 없음')
for path in files:
    try:
        raw = path.read_bytes()
        assert not path.is_symlink() and len(raw) <= 16384
        assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}', path.stem)
        values = {}
        for line in raw.decode('utf-8').splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            item = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([A-Za-z0-9_+./:-]*)', line)
            assert item and item[1] not in values
            values[item[1]] = item[2]
        model_path = values.get('MODEL_PATH', '')
        assert model_path.startswith('/') and os.path.normpath(model_path) == model_path
        assert model_path.endswith('.gguf') and values.get('MODEL_NAME', path.stem) == path.stem
        info = os.stat(model_path)
        assert stat.S_ISREG(info.st_mode) and info.st_size > 0
        print(path.name + ': 정상')
    except (AssertionError, OSError, UnicodeError, ValueError):
        print(path.name + ': 확인 필요')
PY
```

## 서버 또는 Fedora 격리 환경에서만 할 수 있는 작업

통합 이전 절차를 확정하기 전 운영 서버의 Studio·gate·LLM Client unit 경로와 drop-in, 데이터 경로 및 설치 대상 충돌을 다시 확인해야 합니다. 최초 이전은 외부 API 유지보수, 기존 gate pause 기록과 drain, 호환되는 단위의 백업, 새 코드·키·상태·unit 설치, 클라이언트 인증과 startup 해제 검증의 순서로 구성합니다. 실패 시 유지보수를 유지하고 journal·hold·작업 상태를 확인한 다음 호환되는 구버전 코드·설정·서비스를 함께 복원해야 합니다. 이 순서는 아직 실행 가능한 전체 절차나 전체 롤백 시험 결과가 아닙니다.

운영자 재확인: Studio, gate, LLM Client, llama와 Caddy는 실행 중입니다. 세 애플리케이션의 unit은 `/etc/systemd/system`에 있고 각 환경 파일은 `/etc/bc250-ai-studio.env`, `/etc/bc250-llm-gate.env`, `/etc/bc250-llm-client.env`입니다. 세 서비스에 별도 로컬 drop-in 디렉터리는 없었습니다. 신규 코드·설정·상태·GPU 잠금 경로와 세 신규 unit도 없었습니다. `/opt/ai-studio-data`는 `ai-studio:ai-studio` 0700이며, 조회 시 `/opt`와 `/var/backups`는 같은 파일 시스템에 있고 가용 공간은 390G였습니다. 이는 특정 시점의 조회이며 배포 직전에 다시 검사해야 합니다.

운영자가 모델 설정 네 개의 후보 파서 문법과 지정 GGUF 파일 존재 여부를 읽기 전용 검사로 확인했습니다. 기존 gate 프로세스와 LLM Client 키의 불일치는 확인됐지만, 이전 도구가 읽을 기존 gate 환경 파일의 키가 현재 gate에 통하는지는 별도로 확인해야 합니다.

이후 운영자가 읽기 전용 상태 조회로 기존 gate 환경 파일의 키가 실행 중인 gate에서 인증됨을 확인했습니다. 조회 시 관리자 pause는 없었고 진행 중·대기 중 요청은 모두 0이었습니다. 이 값은 고정된 배포 조건이 아니므로 실제 이전 직전에 다시 확인하고 그 시점의 pause를 기록해야 합니다.

현재 후보의 백엔드·배포 파일을 Fedora 43 aarch64 Docker 컨테이너의 Python 3.14에서 일반 UID로 시험한 결과 279개가 통과하고 root 전용 6개는 건너뛰었습니다. Ruff와 노트북의 프런트엔드 lint·빌드도 통과했습니다. 이 결과는 운영 서버의 x86_64에서 이전에 수행한 VM 시험과 별개이며, 운영 배포와 전체 복구 절차가 검증됐다는 뜻은 아닙니다. 이후 백업 래퍼의 경로 신뢰성 검사를 추가했으며 해당 변경은 이 컨테이너 실행에 포함되지 않았습니다.

- root 코드·가상환경의 실제 소유권·ACL·심볼릭 링크 및 SELinux 레이블을 확인하고, 별도 gate UID·polkit 규칙·systemd 소켓 활성화와 각 서비스의 접근을 검증합니다. 로컬 네임스페이스 시험은 실제 systemd와 Fedora SELinux가 아닙니다.
- Studio와 gate의 기존 코드를 새 코드로 함께 이전하고 이전 관리자 pause를 보존합니다. 이전·복구 중 직접 8080 접근과 다른 GPU 사용자를 차단하는 유지보수 절차를 실제 환경에서 확인합니다.
- 사용자가 직접 읽기 전용 설치 검증을 수행한 뒤, 실제 모델 목록·현재 모델·`ai-model status/list`와 API 결과를 비교합니다. 이어 사용자가 허용하는 시점에 모델 전환과 이미지 작업 경합을 시험합니다. 모델 전환·GPU 작업을 에이전트가 자동 실행하지 않습니다.
- 재시작 실패, health timeout, 강제 종료, 이전 모델 복구 실패와 gate 영구 저장 실패는 별도 Fedora 시험 환경에서 먼저 주입합니다. 운영 서비스에 실패를 임의로 주입하지 않습니다. hold·journal·이전 모델 health와 수동 복구 및 롤백을 확인합니다.
- 실제 네트워크 구성에 맞게 client 백엔드의 TLS와 관리 키 전달을 설정합니다. 사용자 ID별 권한과 데이터 격리는 [별도 TODO](./USER_ISOLATION_TODO.md)입니다.
- 백업·롤백과 정확한 서버별 설치·재시작 명령을 서버 확인 결과와 격리 시험에 맞게 확정합니다. 현재 [수동 배포 초안](./LLM_MODEL_SWITCH_DEPLOYMENT_DRAFT.md)은 준비·복구 명령 후보를 포함하며 운영 적용 지시서가 아닙니다.

## 결과

```bash
yeppyshiba@fedora:~$ python3 --version
systemctl --version | sed -n '1p'
ss -H -ltn 'sport = :8091'

if getent passwd ai-gate >/dev/null; then
  id ai-gate
else
  echo 'ai-gate 계정 없음'
fi

for candidate in /usr/bin/uv /usr/local/bin/uv; do
  if [ -e "$candidate" ]; then
    stat -Lc '%A %U:%G %n' "$candidate"
  fi
done
Python 3.14.0
systemd 258 (258-1.fc43)
ai-gate 계정 없음
-rwxr-xr-x root:root /usr/bin/uv
yeppyshiba@fedora:~$
yeppyshiba@fedora:~$ python3 - <<'PY'
import os
import re
import stat
from pathlib import Path

files = sorted(Path('/opt/ai/config/models').glob('*.conf'))
if not files:
    print('모델 설정 없음')
for path in files:
    try:
        raw = path.read_bytes()
        assert not path.is_symlink() and len(raw) <= 16384
        assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}', path.stem)
        values = {}
        for line in raw.decode('utf-8').splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            item = re.fullmatch(r'([A-Z][A-Z0-9_]*)=([A-Za-z0-9_+./:-]*)', line)
            assert item and item[1] not in values
            values[item[1]] = item[2]
        model_path = values.get('MODEL_PATH', '')
        assert model_path.startswith('/') and os.path.normpath(model_path) == model_path
        assert model_path.endswith('.gguf') and values.get('MODEL_NAME', path.stem) == path.stem
        info = os.stat(model_path)
        assert stat.S_ISREG(info.st_mode) and info.st_size > 0
        print(path.name + ': 정상')
    except (AssertionError, OSError, UnicodeError, ValueError):
        print(path.name + ': 확인 필요')
PY
gemma4-e4b-hauhaucs.conf: 정상
gemma4-e4b-heretic-rp.conf: 정상
qwen35-35b-a3b-uncensored.conf: 정상
qwen36-35b-a3b-uncensored.conf: 정상
```
