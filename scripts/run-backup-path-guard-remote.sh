#!/usr/bin/env bash
# Package the path-guard regression and run it only in the existing test VM.
set -Eeuo pipefail
umask 077
[[ $# -ge 1 && $# -le 2 ]] || { echo '사용법: bash scripts/run-backup-path-guard-remote.sh internal|external 시험종류' >&2; exit 1; }
case $1 in
  internal) deploy_host=192.168.0.57; deploy_port=22 ;;
  external) deploy_host=yeppyshiba.iptime.org; deploy_port=2222 ;;
  *) echo 'internal 또는 external을 선택하세요.' >&2; exit 1 ;;
esac
test_kind=${2:-backup-path-guard}
case $test_kind in backup-path-guard|backup-units|backup-units-cgroup|backup-dropins|backup-dropin-link|preserve-new-archive|check-new-switch-state|check-deployment-rollback-resume|preserved-switch-state|restore-legacy-files|linked-legacy-restore|install-units|install-studio-release|install-studio-release-resume|install-studio-failure-resume|install-studio-config-guard-resume|installed-studio-services-resume|installed-studio-repair-resume|new-service-start-resume|staged-secrets-resume|staged-config-adapter-resume|caddy-linked-migration-resume|caddy-maintenance-adapter-resume|caddy-systemd-adapter-resume|caddy-systemd-linked-resume|migration-journal-resume|migration-backup-record-resume|preserve-new-adapter-resume|preserve-recovery-check-resume|assemble-coordinator-resume|staged-release-resume|attested-stage-resume|offline-attestation-resume|offline-bound-stage-resume|trusted-offline-check-resume|trusted-offline-coordinator-resume|intake-artifact-resume|intake-stage-linked-resume|intake-ssh-linked-resume|intake-sudo-boundary-resume|intake-ssh-boundary-resume|intake-ssh-receive-resume|intake-ssh-stream-resume|intake-ssh-stream-stage-resume|old-studio-process-watch-resume|studio-generation-service-resume|studio-generation-boundary-resume|studio-process-observer-resume|studio-observed-generation-resume|studio-candidate-generation-resume|startup-phase-checks-resume|studio-candidate-bound-startup-resume|generation-release-required-resume|stage-release-resume|pinned-coordinator-resume|pinned-initial-install-resume|pinned-initial-preparation-resume|pinned-preparation-chain-resume|pinned-record-release-resume|pinned-record-gate-resume|pinned-preparation-chain-boot|install-model-code-resume|install-model-code-failure-resume|initial-preparation-resume|observe-direct-llm-resume|local-idle-composite-resume|observe-studio-idle-resume|inspect-stopped-studio-db-resume|legacy-backup-studio-db-resume|wiki-fence-resume|wiki-runtime-condition-resume|wiki-condition-dbus-resume|read-systemd-conditions-resume|wiki-condition-fence-resume|wiki-persistent-condition-resume|wiki-condition-reboot-prepare|wiki-condition-reboot-verify|coordinator-wiki-fence-resume|coordinator-idle-chain-resume|initial-local-idle-boot|initial-listener-idle-resume|advisory-gpu-fence-boot|nft-cgroup-isolated-resume|nft-systemd-restart-resume|nft-atomic-refresh-resume|nft-socket-transfer-resume|nft-pidfd-access-resume|nft-pidfd-separate-uid-resume|llama-listener-resume|gate-identity-resume|gate-start-identity-resume|gate-real-start-identity-resume|db-restart-generation-race-resume|db-services-reboot-prepare-resume|db-services-reboot-verify-resume|db-service-stop-reexec-resume|db-service-restart-fence-resume|db-sqlite-writer-lock-resume|db-directory-ownership-resume|studio-db-permissions-resume|studio-db-bind-readonly-resume|studio-db-condition-bind-resume|db-process-references-resume|db-mapping-references-resume|db-known-processes-resume|llama-connection-backup-resume|gpu-lock-handoff-boot|startup-lock-sequence-boot|startup-lock-sequence-resume|gate-confirm-uncertain-boot|deployment-hold-resume|coordinator-idle-backup-resume|manual-rollback-wiki-resume|manual-rollback-linked-resume|manual-rollback-full-wiki-resume|initial-install-adapter-resume|initial-install-real-studio-resume|initial-install-real-both-resume|service-migration-rollback|legacy-backup-sequence|legacy-rollback-sequence|legacy-backup-adapter|service-migration-rollback-resume|api-services-resume|api-services-continue|current-code-resume|current-studio-code-resume|current-release-services-resume|separated-release-services-resume|caddy-metadata-resume|caddy-capture|caddy-snapshot-verify|caddy-file-swap|caddy|caddy-lifecycle|caddy-atomic-lifecycle|caddy-reload-uncertain|caddy-transaction) ;; *) echo '지원하지 않는 시험입니다.' >&2; exit 1 ;; esac
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
local_dir=$(mktemp -d "${TMPDIR:-/tmp}/bc250-path-guard.XXXXXXXX")
archive=$local_dir/source.tar.gz
git -C "$root" ls-files -z -- backend/app backend/alembic ':!backend/app/services/gate_process_identity.py' > "$local_dir/app-files"
app_files=()
while IFS= read -r -d '' app_file; do
  app_files+=("$app_file")
done < "$local_dir/app-files"
app_files+=(backend/app/services/gate_process_identity.py)
[[ ${#app_files[@]} -gt 1 ]] || { echo '백엔드 소스를 찾지 못했습니다.' >&2; exit 1; }
extra_files=()
extra_tar=()
if [[ $test_kind == attested-stage-resume || $test_kind == intake-ssh-linked-resume || $test_kind == intake-ssh-receive-resume || $test_kind == intake-ssh-stream-resume || $test_kind == intake-ssh-stream-stage-resume ]]; then
  candidate=/tmp/bc250-attested-candidate.S9O50r88/bc250-model-control-candidate.tar.gz
  digest=f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8
  python3 "$root/scripts/verify-candidate-run.py" /tmp/bc250-gh.cKdNJRvV/gh "$candidate" \
    cc55bb9873b8884410606491e390b76c397f2e5e 41945044035 1
  [[ $(sha256sum "$candidate" | cut -d ' ' -f 1) == "$digest" ]] || {
    echo '시험 후보 해시가 예상과 다릅니다.' >&2; exit 1;
  }
  cp -- "$candidate" "$local_dir/attested-candidate.tar.gz"
  [[ $(sha256sum "$local_dir/attested-candidate.tar.gz" | cut -d ' ' -f 1) == "$digest" ]] || exit 1
  extra_tar=(-C "$local_dir" attested-candidate.tar.gz)
fi
if [[ $test_kind == offline-attestation-resume ]]; then
  candidate=/tmp/bc250-attested-candidate.S9O50r88/bc250-model-control-candidate.tar.gz
  evidence=/tmp/bc250-attestation-evidence.kXXAru8Y
  python3 "$root/scripts/verify-candidate-run.py" /tmp/bc250-gh.cKdNJRvV/gh "$candidate" \
    cc55bb9873b8884410606491e390b76c397f2e5e 41945044035 1 \
    --bundle "$evidence/sha256:f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8.jsonl" \
    --trusted-root "$evidence/trusted-root.jsonl"
  cp -- /tmp/bc250-gh.cKdNJRvV/gh "$local_dir/offline-gh"
  cp -- "$candidate" "$local_dir/offline-candidate.tar.gz"
  cp -- "$evidence/sha256:f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8.jsonl" "$local_dir/offline-bundle.jsonl"
  cp -- "$evidence/trusted-root.jsonl" "$local_dir/offline-trusted-root.jsonl"
  extra_tar=(-C "$local_dir" offline-gh offline-candidate.tar.gz offline-bundle.jsonl offline-trusted-root.jsonl)
fi
if [[ $test_kind == install-studio-release || $test_kind == install-studio-release-resume || $test_kind == install-studio-failure-resume || $test_kind == install-studio-config-guard-resume || $test_kind == initial-install-real-studio-resume || $test_kind == initial-install-real-both-resume ]]; then
  [[ -f $root/frontend/dist/index.html && -f $root/config/models.yaml ]] || {
    echo '시험에 필요한 프런트엔드 빌드 또는 모델 설정이 없습니다.' >&2; exit 1;
  }
  extra_files+=(frontend/dist config/models.yaml)
fi
tar -czf "$archive" -C "$root" \
  scripts/test-db-services-reboot-vm.sh \
  deploy/model-control/service-stop-fence-sequence.py \
  scripts/test-db-restart-generation-race-vm.sh \
  scripts/test-db-service-restart-fence-vm.sh \
  deploy/model-control/sqlite-process-guard.py \
  deploy/model-control/sqlite-writer-guard.py \
  scripts/test-db-sqlite-writer-lock-vm.sh \
  scripts/test-db-directory-ownership-vm.sh \
  scripts/run-isolated-vm-test-on-host.sh scripts/test-backup-path-guard-vm.sh scripts/test-backup-units-vm.sh scripts/test-preserve-new-archive-vm.sh scripts/test-check-new-switch-state-vm.sh scripts/test-preserved-switch-state-vm.sh scripts/test-restore-legacy-files-vm.sh scripts/test-install-units-vm.sh scripts/test-install-studio-release-vm.sh scripts/test-installed-studio-services-vm.sh scripts/test-new-service-start-vm.sh scripts/trace-startup-confirm-vm.py scripts/test-staged-secrets-vm.sh scripts/test-staged-configuration-adapter-vm.sh scripts/test-caddy-linked-migration-vm.sh scripts/test-migration-journal-vm.sh scripts/test-migration-backup-record-vm.sh scripts/test-preserve-new-adapter-vm.sh scripts/test-preserve-recovery-check-vm.sh scripts/test-assemble-coordinator-vm.sh scripts/test-staged-release-vm.sh scripts/test-attested-stage-vm.sh scripts/test-offline-attestation-vm.sh scripts/test-offline-bound-stage-vm.sh scripts/test-trusted-offline-check-vm.sh scripts/test-trusted-offline-coordinator-vm.sh scripts/test-intake-authenticated-artifact-vm.sh scripts/test-intake-stage-linked-vm.sh scripts/test-intake-ssh-linked-vm.sh scripts/test-intake-sudo-boundary-vm.sh scripts/test-intake-ssh-boundary-vm.sh scripts/test-intake-ssh-receive-vm.sh scripts/test-intake-ssh-stream-vm.sh scripts/test-intake-ssh-stream-stage-vm.sh scripts/test-old-studio-process-watch-vm.sh scripts/test-studio-generation-service-vm.sh scripts/test-studio-generation-boundary-vm.sh scripts/test-studio-process-observer-vm.sh scripts/test-studio-observed-generation-vm.sh scripts/test-studio-candidate-generation-vm.sh scripts/test-studio-candidate-bound-startup-vm.sh scripts/test-startup-phase-checks-vm.sh scripts/test-startup-phase-checks.py scripts/test-assemble-phase-safety.py scripts/test-generation-bound-startup.py scripts/test-generation-release-required-vm.sh scripts/test-generation-release-required.py scripts/test-studio-process-observer.py scripts/test-old-studio-process-watch.py scripts/candidate-attestation-adapter.py scripts/verify-candidate-run.py scripts/test-stage-release-vm.sh scripts/test-pinned-coordinator-vm.sh scripts/test-initial-install-adapter-vm.sh scripts/test-install-model-code-vm.sh scripts/test-initial-preparation-vm.sh scripts/test-observe-direct-llm-vm.sh scripts/test-observe-studio-idle-vm.sh scripts/test-inspect-stopped-studio-db-vm.sh scripts/test-legacy-backup-studio-db-vm.sh scripts/test-wiki-maintenance-fence-vm.sh scripts/test-wiki-runtime-condition-vm.sh scripts/test-wiki-condition-dbus-vm.sh scripts/test-read-systemd-conditions-vm.sh scripts/test-wiki-condition-fence-vm.sh scripts/test-wiki-condition-reboot-vm.sh scripts/test-coordinator-wiki-fence-vm.sh scripts/test-coordinator-idle-chain-vm.sh scripts/test-advisory-gpu-fence-vm.sh scripts/test-nft-cgroup-isolated-vm.sh scripts/test-nft-systemd-restart-vm.sh scripts/test-nft-atomic-refresh-vm.sh scripts/test-nft-socket-transfer-vm.sh scripts/test-nft-pidfd-access-vm.sh scripts/test-nft-pidfd-access.py scripts/test-gate-identity-vm.sh scripts/test-gate-start-identity-vm.sh scripts/test-gate-real-start-identity-vm.sh scripts/test-studio-db-permissions-vm.sh scripts/test-studio-db-bind-readonly-vm.sh scripts/test-studio-db-condition-bind-vm.sh scripts/test-db-process-references-vm.sh scripts/test-db-mapping-references-vm.sh scripts/test-db-known-processes-vm.sh scripts/test-llama-listener-vm.sh scripts/test-llama-connection-backup-vm.sh scripts/test-gpu-lock-handoff-vm.sh scripts/test-startup-lock-sequence-vm.sh scripts/test-gate-confirm-uncertain-vm.sh scripts/test-deployment-hold-vm.sh scripts/test-manual-rollback-wiki-vm.sh \
  scripts/test-backup-dropins-vm.sh scripts/test-backup-dropin-link-vm.sh scripts/test-service-migration-rollback-vm.sh scripts/test-api-services-vm.sh scripts/resume-api-services-vm.sh scripts/test-current-code-vm.sh scripts/test-current-studio-code-vm.sh scripts/test-current-release-services-vm.sh scripts/test-separated-release-services-vm.sh scripts/test-caddy-metadata-vm.sh scripts/test-caddy-capture-vm.sh scripts/test-caddy-snapshot-verify-vm.sh scripts/test-caddy-file-swap-vm.sh \
  deploy/model-control/backup-stopped.sh \
  deploy/model-control/backup-archive.sh deploy/model-control/check-service-cgroup.py deploy/model-control/check-new-switch-state.py deploy/model-control/check-preserved-switch-state.py deploy/model-control/verify-backup.py deploy/model-control/legacy-backup-sequence.py deploy/model-control/legacy-rollback-sequence.py deploy/model-control/legacy-rollback-manual.py deploy/model-control/legacy-backup-adapter.py deploy/model-control/preserve-new-archive.sh deploy/model-control/preserve-new-stopped.sh deploy/model-control/preserve-new-adapter.py deploy/model-control/restore-legacy-files.py deploy/model-control/install-units.py deploy/model-control/preserve-installed-units.py deploy/model-control/install-studio-release.py deploy/model-control/start-new-services.py deploy/model-control/prepare-secrets.py deploy/model-control/verify-staged-secrets.py deploy/model-control/staged-configuration-adapter.py deploy/model-control/migration-journal.py deploy/model-control/coordinated-migration.py deploy/model-control/assemble-coordinator.py deploy/model-control/verify-release-candidate.py deploy/model-control/verify-staged-release.py deploy/model-control/stage-release.py deploy/model-control/assemble-pinned-coordinator.py deploy/model-control/initial-install-adapter.py deploy/model-control/install-model-code.py deploy/model-control/prepare-initial-settings.py deploy/model-control/verify-initial-preparation.py deploy/model-control/prepare-state.py deploy/model-control/offline-attestation-check.py deploy/model-control/intake-authenticated-artifact.py deploy/model-control/observe-direct-llm.py deploy/model-control/observe-db-process-references.py deploy/model-control/observe-llama-listener.py deploy/model-control/observe-llama-connections.py deploy/model-control/local-idle-composite.py deploy/model-control/initial-local-idle.py deploy/model-control/advisory-gpu-fence.py deploy/model-control/gpu-lock-handoff.py deploy/model-control/old-studio-process-watch.py deploy/model-control/studio-generation-boundary.py deploy/model-control/studio-process-observer.py deploy/model-control/deployment-hold-check.py deploy/model-control/startup-lock-sequence.py deploy/model-control/inspect-deployment-record.py deploy/model-control/observe-studio-idle.py deploy/model-control/inspect-stopped-studio-db.py deploy/model-control/wiki-maintenance-fence.py deploy/model-control/read-systemd-conditions.py deploy/model-control/verify-wiki-condition.py deploy/model-control/wiki-condition-fence.py \
  deploy/model-control/restore-backup-to-stage.sh deploy/model-control/migrate-legacy-gate.py \
  scripts/test-maintenance-caddy-host.sh scripts/test-maintenance-caddy.py scripts/test-maintenance-lifecycle.py \
  deploy/model-control/create-maintenance-caddy.py deploy/model-control/capture-caddy.py deploy/model-control/caddy-file-swap.py deploy/model-control/caddy-transaction.py deploy/model-control/caddy-maintenance-adapter.py deploy/model-control/maintenance-probe.py deploy/model-control/studio.conf deploy/model-control/gate.conf deploy/model-control/llm-client.conf deploy/model-control/50-bc250-studio-llm.rules systemd/bc250-gpu-lock.conf systemd/bc250-model-worker.socket systemd/bc250-model-worker.service systemd/bc250-model-api.service \
  pyproject.toml uv.lock "${app_files[@]}" ${extra_files[@]+"${extra_files[@]}"} ${extra_tar[@]+"${extra_tar[@]}"}
if [[ $test_kind == attested-stage-resume || $test_kind == intake-ssh-linked-resume || $test_kind == intake-ssh-receive-resume || $test_kind == intake-ssh-stream-resume || $test_kind == intake-ssh-stream-stage-resume ]]; then
  [[ $(tar -tzf "$archive" | awk '$0 == "attested-candidate.tar.gz" {n++} END {print n+0}') == 1 ]] || {
    echo '전송 압축 파일에 시험 후보가 정확히 한 개 포함되지 않았습니다.' >&2; exit 1;
  }
  archived_digest=$(tar -xOzf "$archive" attested-candidate.tar.gz | sha256sum | cut -d ' ' -f 1)
  [[ $archived_digest == f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8 ]] || {
    echo '전송 압축 파일에 포함된 시험 후보 해시가 다릅니다.' >&2; exit 1;
  }
  echo '전송 압축 파일의 시험 후보 포함과 해시 확인'
fi
if [[ $test_kind == offline-attestation-resume ]]; then
  python3 - "$archive" <<'PYCODE'
import hashlib
import sys
import tarfile
expected = {
    'offline-gh': 'b768184570b12536be4ac1528893f6340d1c6a7b40b56ad45bca9cd0e87ad34d',
    'offline-candidate.tar.gz': 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8',
    'offline-bundle.jsonl': '3c828832941a65f61eb2fdffa8cd54c9c50ab503b1df143fc969f18f6bd308b9',
    'offline-trusted-root.jsonl': '65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c',
}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for name, digest in expected.items():
        matches = [entry for entry in archive.getmembers() if entry.name == name]
        if len(matches) != 1 or not matches[0].isfile():
            raise SystemExit('전송 압축 파일의 검증 자료 누락 또는 중복')
        with archive.extractfile(matches[0]) as data:
            if hashlib.file_digest(data, 'sha256').hexdigest() != digest:
                raise SystemExit('전송 압축 파일의 검증 자료 해시 불일치')
print('전송 압축 파일의 오프라인 검증 자료와 해시 확인', flush=True)
PYCODE
fi
if command -v sha256sum >/dev/null 2>&1; then
  digest=$(sha256sum "$archive" | cut -d ' ' -f 1)
else
  digest=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
fi
echo "시험 대상: $deploy_host:$deploy_port"
echo "시험 소스 SHA-256: $digest"
echo "로컬 시험 파일 보관: $local_dir"
remote_dir=$(ssh -p "$deploy_port" "yeppyshiba@$deploy_host" \
  'umask 077; mktemp -d "$HOME/bc250-path-guard.XXXXXXXX"')
[[ $remote_dir =~ ^/home/yeppyshiba/bc250-path-guard\.[[:alnum:]]{8}$ ]] || {
  echo '서버 임시 경로를 확인하지 못했습니다. 서버 출력을 확인하세요.' >&2; exit 1;
}
echo "서버 시험 파일 보관: $remote_dir"
scp -P "$deploy_port" "$archive" "yeppyshiba@$deploy_host:$remote_dir/source.tar.gz"
ssh -p "$deploy_port" "yeppyshiba@$deploy_host" bash -s -- "$remote_dir" "$digest" "$test_kind" <<'REMOTE'
set -Eeuo pipefail
remote_dir=$1
digest=$2
test_kind=$3
printf '%s  %s\n' "$digest" "$remote_dir/source.tar.gz" | sha256sum -c -
if [[ $test_kind == caddy || $test_kind == caddy-lifecycle || $test_kind == caddy-atomic-lifecycle || $test_kind == caddy-reload-uncertain || $test_kind == caddy-transaction ]]; then
  tar -xzf "$remote_dir/source.tar.gz" -C "$remote_dir" \
    scripts/test-maintenance-caddy-host.sh scripts/test-maintenance-caddy.py scripts/test-maintenance-lifecycle.py \
    deploy/model-control/create-maintenance-caddy.py deploy/model-control/capture-caddy.py deploy/model-control/caddy-file-swap.py deploy/model-control/caddy-transaction.py deploy/model-control/caddy-maintenance-adapter.py deploy/model-control/maintenance-probe.py
  if [[ $test_kind == caddy ]]; then
    bash "$remote_dir/scripts/test-maintenance-caddy-host.sh" "$remote_dir"
  elif [[ $test_kind == caddy-lifecycle ]]; then
    python3 "$remote_dir/scripts/test-maintenance-lifecycle.py" /etc/caddy/Caddyfile \
      "$remote_dir/deploy/model-control/create-maintenance-caddy.py"
  elif [[ $test_kind == caddy-atomic-lifecycle ]]; then
    python3 "$remote_dir/scripts/test-maintenance-lifecycle.py" /etc/caddy/Caddyfile \
      "$remote_dir/deploy/model-control/create-maintenance-caddy.py" \
      "$remote_dir/deploy/model-control/capture-caddy.py" \
      "$remote_dir/deploy/model-control/caddy-file-swap.py"
  elif [[ $test_kind == caddy-reload-uncertain ]]; then
    python3 "$remote_dir/scripts/test-maintenance-lifecycle.py" /etc/caddy/Caddyfile \
      "$remote_dir/deploy/model-control/create-maintenance-caddy.py" \
      "$remote_dir/deploy/model-control/capture-caddy.py" \
      "$remote_dir/deploy/model-control/caddy-file-swap.py" uncertain
  else
    python3 "$remote_dir/scripts/test-maintenance-lifecycle.py" /etc/caddy/Caddyfile \
      "$remote_dir/deploy/model-control/create-maintenance-caddy.py" \
      "$remote_dir/deploy/model-control/capture-caddy.py" \
      "$remote_dir/deploy/model-control/caddy-file-swap.py" transaction
  fi
else
  tar -xzf "$remote_dir/source.tar.gz" -C "$remote_dir" scripts/run-isolated-vm-test-on-host.sh
  bash "$remote_dir/scripts/run-isolated-vm-test-on-host.sh" \
    "$remote_dir/source.tar.gz" "$digest" "$test_kind"
fi
REMOTE
