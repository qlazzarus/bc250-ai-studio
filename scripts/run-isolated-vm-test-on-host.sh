#!/usr/bin/env bash
# Start the existing disposable VM, run one allowlisted test, and shut it down.
set -Eeuo pipefail
[[ $(id -u) != 0 && $# == 3 && $2 =~ ^[0-9a-f]{64}$ ]] || {
  echo '일반 사용자로 소스 압축 파일, SHA-256, 시험 종류를 전달하세요.' >&2; exit 1;
}
archive=$1
expected=$2
resume=no
guest_extra=''
case $3 in
  label-rollback)
    guest_dir=bc250-label-rollback-source
    guest_script=scripts/test-label-rollback-vm.sh
    ;;
  client-key)
    guest_dir=bc250-client-key-source
    guest_script=scripts/test-client-gate-key-vm.sh
    ;;
  client-check)
    guest_dir=bc250-client-gate-check-source
    guest_script=scripts/test-client-gate-check-vm.sh
    ;;
  startup-client)
    guest_dir=bc250-startup-client-source
    guest_script=scripts/test-startup-client-vm.sh
    ;;
  restart-recovery)
    guest_dir=bc250-restart-recovery-source
    guest_script=scripts/test-systemd-restart-recovery-vm.sh
    ;;
  rollback-failure)
    guest_dir=bc250-rollback-failure-source
    guest_script=scripts/test-systemd-rollback-failure-vm.sh
    ;;
  inflight-crash)
    guest_dir=bc250-inflight-crash-source
    guest_script=scripts/test-systemd-inflight-crash-vm.sh
    ;;
  backup-archive)
    guest_dir=bc250-backup-archive-source
    guest_script=scripts/test-backup-archive-vm.sh
    ;;
  backup-archive-acl)
    guest_dir=bc250-backup-archive-acl-source
    guest_script=scripts/test-backup-archive-vm.sh
    ;;
  backup-units)
    guest_dir=bc250-backup-units-source
    guest_script=scripts/test-backup-units-vm.sh
    ;;
  backup-units-cgroup)
    guest_dir=bc250-backup-units-cgroup-source
    guest_script=scripts/test-backup-units-vm.sh
    ;;
  preserve-new-archive)
    guest_dir=bc250-preserve-new-archive-source
    guest_script=scripts/test-preserve-new-archive-vm.sh
    ;;
  check-new-switch-state)
    guest_dir=bc250-check-new-switch-state-source
    guest_script=scripts/test-check-new-switch-state-vm.sh
    ;;
  check-deployment-rollback-resume)
    guest_dir="bc250-check-deployment-rollback-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-check-new-switch-state-vm.sh
    guest_extra=' deployment'
    resume=yes
    ;;
  preserved-switch-state)
    guest_dir=bc250-preserved-switch-state-source
    guest_script=scripts/test-preserved-switch-state-vm.sh
    ;;
  restore-legacy-files)
    guest_dir=bc250-restore-legacy-files-source
    guest_script=scripts/test-restore-legacy-files-vm.sh
    ;;
  backup-path-guard)
    guest_dir=bc250-backup-path-guard-source
    guest_script=scripts/test-backup-path-guard-vm.sh
    ;;
  backup-dropins)
    guest_dir=bc250-backup-dropins-source
    guest_script=scripts/test-backup-dropins-vm.sh
    ;;
  backup-dropin-link)
    guest_dir=bc250-backup-dropin-link-source
    guest_script=scripts/test-backup-dropin-link-vm.sh
    ;;
  service-migration-rollback)
    guest_dir=bc250-linked-service-rollback-v2-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    ;;
  legacy-backup-sequence)
    guest_dir=bc250-legacy-backup-sequence-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    ;;
  legacy-rollback-sequence)
    guest_dir=bc250-legacy-rollback-sequence-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    ;;
  legacy-backup-adapter)
    guest_dir=bc250-legacy-backup-adapter-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    ;;
  linked-legacy-restore)
    guest_dir=bc250-linked-legacy-restore-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    ;;
  install-units)
    guest_dir=bc250-install-units-source
    guest_script=scripts/test-install-units-vm.sh
    ;;
  install-studio-release)
    guest_dir=bc250-install-studio-release-source
    guest_script=scripts/test-install-studio-release-vm.sh
    ;;
  install-studio-release-resume)
    guest_dir="bc250-install-studio-resume-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-install-studio-release-vm.sh
    resume=yes
    ;;
  install-studio-failure-resume)
    guest_dir="bc250-install-studio-failure-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-install-studio-release-vm.sh
    guest_extra=' failure-only'
    resume=yes
    ;;
  install-studio-config-guard-resume)
    guest_dir="bc250-install-studio-config-guard-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-install-studio-release-vm.sh
    guest_extra=' config-mismatch-only'
    resume=yes
    ;;
  installed-studio-services-resume)
    guest_dir="bc250-installed-studio-services-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-installed-studio-services-vm.sh
    resume=yes
    ;;
  installed-studio-repair-resume)
    guest_dir="bc250-installed-studio-repair-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-installed-studio-services-vm.sh
    guest_extra=' repair-lock'
    resume=yes
    ;;
  new-service-start-resume)
    guest_dir="bc250-new-service-start-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-installed-studio-services-vm.sh
    guest_extra=' startup-phases'
    resume=yes
    ;;
  staged-secrets-resume)
    guest_dir="bc250-staged-secrets-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-staged-secrets-vm.sh
    resume=yes
    ;;
  staged-config-adapter-resume)
    guest_dir="bc250-staged-config-adapter-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-staged-configuration-adapter-vm.sh
    resume=yes
    ;;
  caddy-linked-migration-resume|caddy-maintenance-adapter-resume|caddy-systemd-adapter-resume|caddy-systemd-linked-resume|manual-rollback-linked-resume|manual-rollback-full-wiki-resume)
    host_caddy=$(readlink -e -- "$(command -v caddy)")
    [[ -f $host_caddy && -x $host_caddy && $(stat -c '%u' "$host_caddy") == 0 \
      && -z $(find "$host_caddy" -maxdepth 0 -perm /022 -print) ]] || exit 1
    caddy_digest=$(sha256sum "$host_caddy" | cut -d ' ' -f 1)
    [[ $caddy_digest =~ ^[a-f0-9]{64}$ ]] || exit 1
    guest_dir="bc250-caddy-linked-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-caddy-linked-migration-vm.sh
    guest_extra=" $caddy_digest"
    if [[ $3 == caddy-maintenance-adapter-resume ]]; then guest_extra+=' adapter'; fi
    if [[ $3 == caddy-systemd-adapter-resume ]]; then guest_extra+=' adapter-systemd'; fi
    if [[ $3 == caddy-systemd-linked-resume ]]; then guest_extra+=' systemd-linked'; fi
    if [[ $3 == manual-rollback-linked-resume ]]; then guest_extra+=' manual-linked'; fi
    if [[ $3 == manual-rollback-full-wiki-resume ]]; then guest_extra+=' manual-wiki-linked'; fi
    resume=yes
    ;;
  migration-journal-resume)
    guest_dir="bc250-migration-journal-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-migration-journal-vm.sh
    resume=yes
    ;;
  migration-backup-record-resume)
    guest_dir="bc250-migration-backup-record-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-migration-backup-record-vm.sh
    resume=yes
    ;;
  preserve-new-adapter-resume)
    guest_dir="bc250-preserve-new-adapter-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-preserve-new-adapter-vm.sh
    resume=yes
    ;;
  preserve-recovery-check-resume)
    guest_dir="bc250-preserve-recovery-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-preserve-recovery-check-vm.sh
    resume=yes
    ;;
  assemble-coordinator-resume)
    guest_dir="bc250-assemble-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-assemble-coordinator-vm.sh
    resume=yes
    ;;
  generation-release-required-resume)
    guest_dir="bc250-generation-release-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-generation-release-required-vm.sh
    resume=yes
    ;;
  studio-candidate-bound-startup-resume)
    guest_dir="bc250-studio-bound-startup-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-candidate-bound-startup-vm.sh
    resume=yes
    ;;
  startup-phase-checks-resume)
    guest_dir="bc250-startup-phase-checks-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-startup-phase-checks-vm.sh
    resume=yes
    ;;
  studio-candidate-generation-resume)
    guest_dir="bc250-studio-candidate-generation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-candidate-generation-vm.sh
    resume=yes
    ;;
  studio-observed-generation-resume)
    guest_dir="bc250-studio-observed-generation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-observed-generation-vm.sh
    resume=yes
    ;;
  studio-process-observer-resume)
    guest_dir="bc250-studio-process-observer-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-process-observer-vm.sh
    resume=yes
    ;;
  studio-generation-boundary-resume)
    guest_dir="bc250-studio-generation-boundary-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-generation-boundary-vm.sh
    resume=yes
    ;;
  studio-generation-service-resume)
    guest_dir="bc250-studio-generation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-generation-service-vm.sh
    resume=yes
    ;;
  old-studio-process-watch-resume)
    guest_dir="bc250-old-studio-watch-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-old-studio-process-watch-vm.sh
    resume=yes
    ;;
  intake-ssh-stream-stage-resume)
    guest_dir="bc250-intake-ssh-stream-stage-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-ssh-stream-stage-vm.sh
    resume=yes
    ;;
  intake-ssh-stream-resume)
    guest_dir="bc250-intake-ssh-stream-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-ssh-stream-vm.sh
    resume=yes
    ;;
  intake-ssh-receive-resume)
    guest_dir="bc250-intake-ssh-receive-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-ssh-receive-vm.sh
    resume=yes
    ;;
  intake-ssh-boundary-resume)
    guest_dir="bc250-intake-ssh-boundary-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-ssh-boundary-vm.sh
    resume=yes
    ;;
  intake-sudo-boundary-resume)
    guest_dir="bc250-intake-sudo-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-sudo-boundary-vm.sh
    resume=yes
    ;;
  intake-ssh-linked-resume)
    guest_dir="bc250-intake-ssh-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-ssh-linked-vm.sh
    resume=yes
    ;;
  intake-stage-linked-resume)
    guest_dir="bc250-intake-stage-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-stage-linked-vm.sh
    resume=yes
    ;;
  intake-artifact-resume)
    guest_dir="bc250-intake-artifact-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-intake-authenticated-artifact-vm.sh
    resume=yes
    ;;
  trusted-offline-coordinator-resume)
    guest_dir="bc250-trusted-coordinator-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-trusted-offline-coordinator-vm.sh
    resume=yes
    ;;
  trusted-offline-check-resume)
    guest_dir="bc250-trusted-offline-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-trusted-offline-check-vm.sh
    resume=yes
    ;;
  offline-bound-stage-resume)
    guest_dir="bc250-offline-bound-stage-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-offline-bound-stage-vm.sh
    resume=yes
    ;;
  offline-attestation-resume)
    guest_dir="bc250-offline-attestation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-offline-attestation-vm.sh
    resume=yes
    ;;
  attested-stage-resume)
    guest_dir="bc250-attested-stage-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-attested-stage-vm.sh
    resume=yes
    ;;
  staged-release-resume)
    guest_dir="bc250-staged-release-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-staged-release-vm.sh
    resume=yes
    ;;
  stage-release-resume)
    guest_dir="bc250-stage-release-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-stage-release-vm.sh
    resume=yes
    ;;
  pinned-coordinator-resume)
    guest_dir="bc250-pinned-coordinator-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    resume=yes
    ;;
  pinned-initial-install-resume)
    guest_dir="bc250-pinned-initial-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' initial-install'
    resume=yes
    ;;
  pinned-initial-preparation-resume)
    guest_dir="bc250-pinned-preparation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' initial-preparation'
    resume=yes
    ;;
  pinned-preparation-chain-boot)
    guest_dir="bc250-pinned-preparation-chain-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' preparation-chain'
    ;;
  pinned-preparation-chain-resume)
    guest_dir="bc250-pinned-preparation-chain-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' preparation-chain'
    resume=yes
    ;;
  pinned-record-release-resume)
    guest_dir="bc250-pinned-record-release-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' record-release'
    resume=yes
    ;;
  pinned-record-gate-resume)
    guest_dir="bc250-pinned-record-gate-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-pinned-coordinator-vm.sh
    guest_extra=' record-release-gate'
    resume=yes
    ;;
  install-model-code-resume)
    guest_dir="bc250-install-model-code-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-install-model-code-vm.sh
    resume=yes
    ;;
  install-model-code-failure-resume)
    guest_dir="bc250-install-model-failure-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-install-model-code-vm.sh
    guest_extra=' failure-only'
    resume=yes
    ;;
  initial-preparation-resume)
    guest_dir="bc250-initial-preparation-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-initial-preparation-vm.sh
    resume=yes
    ;;
  local-idle-composite-resume)
    guest_dir="bc250-local-idle-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-observe-direct-llm-vm.sh
    guest_extra=' composite'
    resume=yes
    ;;
  observe-direct-llm-resume)
    guest_dir="bc250-direct-observe-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-observe-direct-llm-vm.sh
    resume=yes
    ;;
  observe-studio-idle-resume)
    guest_dir="bc250-studio-observe-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-observe-studio-idle-vm.sh
    resume=yes
    ;;
  inspect-stopped-studio-db-resume)
    guest_dir="bc250-studio-db-observe-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-inspect-stopped-studio-db-vm.sh
    resume=yes
    ;;
  legacy-backup-studio-db-resume)
    guest_dir="bc250-legacy-backup-db-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-legacy-backup-studio-db-vm.sh
    resume=yes
    ;;
  wiki-fence-resume)
    guest_dir="bc250-wiki-fence-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-maintenance-fence-vm.sh
    resume=yes
    ;;
  wiki-runtime-condition-resume)
    guest_dir="bc250-wiki-condition-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-runtime-condition-vm.sh
    resume=yes
    ;;
  wiki-condition-dbus-resume)
    guest_dir="bc250-wiki-condition-dbus-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-condition-dbus-vm.sh
    resume=yes
    ;;
  read-systemd-conditions-resume)
    guest_dir="bc250-systemd-conditions-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-read-systemd-conditions-vm.sh
    resume=yes
    ;;
  wiki-condition-fence-resume)
    guest_dir="bc250-wiki-condition-fence-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-condition-fence-vm.sh
    resume=yes
    ;;
  wiki-persistent-condition-resume)
    guest_dir="bc250-wiki-persistent-condition-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-condition-fence-vm.sh
    guest_extra=' persistent'
    resume=yes
    ;;
  wiki-condition-reboot-prepare)
    guest_dir="bc250-wiki-reboot-prepare-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-condition-reboot-vm.sh
    guest_extra=' prepare'
    resume=yes
    ;;
  wiki-condition-reboot-verify)
    guest_dir="bc250-wiki-reboot-verify-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-wiki-condition-reboot-vm.sh
    guest_extra=' verify'
    resume=yes
    ;;
  manual-rollback-wiki-resume)
    guest_dir="bc250-manual-rollback-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-manual-rollback-wiki-vm.sh
    resume=yes
    ;;
  gate-confirm-uncertain-boot)
    guest_dir="bc250-gate-confirm-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-gate-confirm-uncertain-vm.sh
    ;;
  deployment-hold-resume)
    guest_dir="bc250-deployment-hold-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-deployment-hold-vm.sh
    resume=yes
    ;;
  startup-lock-sequence-resume)
    guest_dir="bc250-startup-lock-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-startup-lock-sequence-vm.sh
    resume=yes
    ;;
  startup-lock-sequence-boot)
    guest_dir="bc250-startup-lock-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-startup-lock-sequence-vm.sh
    ;;
  gpu-lock-handoff-boot)
    guest_dir="bc250-gpu-handoff-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-gpu-lock-handoff-vm.sh
    ;;
  advisory-gpu-fence-boot)
    guest_dir="bc250-gpu-fence-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-advisory-gpu-fence-vm.sh
    ;;
  nft-systemd-restart-resume)
    guest_dir="bc250-nft-systemd-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-systemd-restart-vm.sh
    resume=yes
    ;;
  nft-atomic-refresh-resume)
    guest_dir="bc250-nft-atomic-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-atomic-refresh-vm.sh
    resume=yes
    ;;
  nft-socket-transfer-resume)
    guest_dir="bc250-nft-transfer-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-socket-transfer-vm.sh
    resume=yes
    ;;
  nft-pidfd-access-resume)
    guest_dir="bc250-nft-pidfd-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-pidfd-access-vm.sh
    resume=yes
    ;;
  nft-pidfd-separate-uid-resume)
    guest_dir="bc250-nft-pidfd-separate-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-pidfd-access-vm.sh
    guest_extra=' separate-uid'
    resume=yes
    ;;
  llama-listener-resume)
    guest_dir="bc250-llama-listener-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-llama-listener-vm.sh
    resume=yes
    ;;
  gate-identity-resume)
    guest_dir="bc250-gate-identity-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-gate-identity-vm.sh
    resume=yes
    ;;
  gate-start-identity-resume)
    guest_dir="bc250-gate-start-identity-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-gate-start-identity-vm.sh
    resume=yes
    ;;
  gate-real-start-identity-resume)
    guest_dir="bc250-gate-real-start-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-gate-real-start-identity-vm.sh
    resume=yes
    ;;
  db-restart-generation-race-resume)
    guest_dir="bc250-db-restart-race-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-restart-generation-race-vm.sh
    resume=yes
    ;;
  db-services-reboot-prepare-resume)
    guest_dir="bc250-db-reboot-prepare-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-services-reboot-vm.sh
    guest_extra=' prepare'
    resume=yes
    ;;
  db-services-reboot-verify-resume)
    guest_dir="bc250-db-reboot-verify-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-services-reboot-vm.sh
    guest_extra=' verify'
    resume=yes
    ;;
  db-service-stop-reexec-resume)
    guest_dir="bc250-db-stop-reexec-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-service-restart-fence-vm.sh
    guest_extra=' reexec'
    resume=yes
    ;;
  db-service-restart-fence-resume)
    guest_dir="bc250-db-restart-fence-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-service-restart-fence-vm.sh
    resume=yes
    ;;
  db-sqlite-writer-lock-resume)
    guest_dir="bc250-sqlite-lock-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-sqlite-writer-lock-vm.sh
    resume=yes
    ;;
  db-directory-ownership-resume)
    guest_dir="bc250-db-owner-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-directory-ownership-vm.sh
    resume=yes
    ;;
  studio-db-permissions-resume)
    guest_dir="bc250-studio-db-permissions-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-db-permissions-vm.sh
    resume=yes
    ;;
  studio-db-bind-readonly-resume)
    guest_dir="bc250-studio-db-bind-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-db-bind-readonly-vm.sh
    resume=yes
    ;;
  studio-db-condition-bind-resume)
    guest_dir="bc250-studio-db-condition-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-studio-db-condition-bind-vm.sh
    resume=yes
    ;;
  db-process-references-resume)
    guest_dir="bc250-db-reference-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-process-references-vm.sh
    resume=yes
    ;;
  db-mapping-references-resume)
    guest_dir="bc250-db-mapping-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-mapping-references-vm.sh
    resume=yes
    ;;
  db-known-processes-resume)
    guest_dir="bc250-db-known-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-db-known-processes-vm.sh
    resume=yes
    ;;
  llama-connection-backup-resume)
    guest_dir="bc250-llama-connection-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-llama-connection-backup-vm.sh
    resume=yes
    ;;
  nft-cgroup-isolated-resume)
    guest_dir="bc250-nft-cgroup-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-nft-cgroup-isolated-vm.sh
    resume=yes
    ;;
  initial-local-idle-boot)
    guest_dir="bc250-initial-idle-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-coordinator-idle-chain-vm.sh
    guest_extra=' initial'
    ;;
  initial-listener-idle-resume)
    guest_dir="bc250-initial-listener-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-coordinator-idle-chain-vm.sh
    guest_extra=' initial'
    resume=yes
    ;;
  coordinator-idle-backup-resume)
    guest_dir="bc250-idle-backup-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-coordinator-idle-chain-vm.sh
    guest_extra=' adapter'
    resume=yes
    ;;
  coordinator-idle-chain-resume)
    guest_dir="bc250-idle-chain-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-coordinator-idle-chain-vm.sh
    resume=yes
    ;;
  coordinator-wiki-fence-resume)
    guest_dir="bc250-coordinator-wiki-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-coordinator-wiki-fence-vm.sh
    resume=yes
    ;;
  initial-install-adapter-resume)
    guest_dir="bc250-initial-install-adapter-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-initial-install-adapter-vm.sh
    resume=yes
    ;;
  initial-install-real-studio-resume)
    guest_dir="bc250-initial-install-real-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-initial-install-adapter-vm.sh
    guest_extra=' real-studio'
    resume=yes
    ;;
  initial-install-real-both-resume)
    guest_dir="bc250-initial-install-both-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-initial-install-adapter-vm.sh
    guest_extra=' real-both'
    resume=yes
    ;;
  service-migration-rollback-resume)
    guest_dir=bc250-linked-service-rollback-v2-source
    guest_script=scripts/test-service-migration-rollback-vm.sh
    resume=yes
    ;;
  api-services-resume)
    guest_dir=bc250-api-services-v3-source
    guest_script=scripts/test-api-services-vm.sh
    resume=yes
    ;;
  api-services-continue)
    guest_dir=bc250-api-services-continue-source
    guest_script=scripts/resume-api-services-vm.sh
    resume=yes
    ;;
  current-code-resume)
    guest_dir=bc250-current-code-v2-source
    guest_script=scripts/test-current-code-vm.sh
    resume=yes
    ;;
  current-studio-code-resume)
    guest_dir="bc250-current-studio-code-${RANDOM}-${RANDOM}"
    guest_script=scripts/test-current-studio-code-vm.sh
    resume=yes
    ;;
  current-release-services-resume)
    guest_dir=bc250-current-release-services-source
    guest_script=scripts/test-current-release-services-vm.sh
    resume=yes
    ;;
  separated-release-services-resume)
    guest_dir=bc250-separated-release-services-source
    guest_script=scripts/test-separated-release-services-vm.sh
    resume=yes
    ;;
  caddy-metadata-resume)
    guest_dir=bc250-caddy-metadata-source
    guest_script=scripts/test-caddy-metadata-vm.sh
    resume=yes
    ;;
  caddy-capture)
    guest_dir=bc250-caddy-capture-source
    guest_script=scripts/test-caddy-capture-vm.sh
    ;;
  caddy-snapshot-verify)
    guest_dir=bc250-caddy-snapshot-verify-source
    guest_script=scripts/test-caddy-snapshot-verify-vm.sh
    ;;
  caddy-file-swap)
    guest_dir=bc250-caddy-file-swap-source
    guest_script=scripts/test-caddy-file-swap-vm.sh
    ;;
  verify-backup)
    guest_dir=bc250-verify-backup-source
    guest_script=scripts/test-verify-backup-vm.sh
    ;;
  restore-stage)
    guest_dir=bc250-restore-stage-source
    guest_script=scripts/test-restore-stage-vm.sh
    ;;
  backup-rollback)
    guest_dir=bc250-backup-rollback-source
    guest_script=scripts/test-backup-rollback-vm.sh
    ;;
  legacy-pause-rollback)
    guest_dir=bc250-legacy-pause-rollback-source
    guest_script=scripts/test-legacy-pause-rollback-vm.sh
    ;;
  gate-backup-rollback)
    guest_dir=bc250-gate-backup-rollback-source
    guest_script=scripts/test-gate-backup-rollback-vm.sh
    ;;
  *) echo '지원하지 않는 시험 종류입니다.' >&2; exit 1 ;;
esac
vm_dir="$HOME/bc250-fedora43-test-vm"
test -f "$archive"
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
test -f "$vm_dir/test-disk.qcow2"
test -f "$vm_dir/seed.iso"
test -f "$vm_dir/vm-key"
test -f "$vm_dir/known_hosts"
if [[ $resume == yes ]]; then
  [[ -f $vm_dir/vm.pid ]] || { echo '실행 중인 시험 VM의 PID 파일이 없습니다.' >&2; exit 1; }
  pid=$(cat "$vm_dir/vm.pid")
  [[ $pid =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || {
    echo '시험 VM 프로세스를 확인하지 못했습니다.' >&2; exit 1;
  }
  ssh_options=(-i "$vm_dir/vm-key" -o BatchMode=yes -o ConnectTimeout=5
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$vm_dir/known_hosts")
  ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
    'test "$(hostname)" = bc250-fedora43-test && test "$(systemd-detect-virt)" = qemu'
  ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
    "mkdir -m 700 \"\$HOME/$guest_dir\""
  scp "${ssh_options[@]}" -P 22223 "$archive" \
    "vmtest@127.0.0.1:$guest_dir/source.tar.gz" </dev/null
  if [[ $3 == intake-ssh-linked-resume ]]; then
    transfer_dir=$(mktemp -d "$HOME/bc250-intake-ssh.XXXXXXXX")
    tar -xOzf "$archive" attested-candidate.tar.gz > "$transfer_dir/candidate.tar.gz"
    printf '%s  %s\n' 'f86034fca0fee64df141d2b80a9532a9785ee04bb3af86ecc78d90e48359b7d8' \
      "$transfer_dir/candidate.tar.gz" | sha256sum -c -
    ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
      "mkdir -m 700 \"\$HOME/$guest_dir/upload\""
    scp "${ssh_options[@]}" -P 22223 "$transfer_dir/candidate.tar.gz" \
      "vmtest@127.0.0.1:$guest_dir/upload/candidate.tar.gz" </dev/null
    echo "별도 시험 SSH 후보 전송 완료; 호스트 시험 파일 보관: $transfer_dir"
  fi
  ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
    "set -e; cd \"\$HOME/$guest_dir\"; \
     printf '%s  %s\\n' '$expected' source.tar.gz | sha256sum -c -; \
     tar -xzf source.tar.gz; \
     sudo bash '$guest_script' \"\$HOME/$guest_dir\"$guest_extra"
  echo '시험 완료. 이전 실패 기록을 보존하기 위해 VM은 실행 상태로 둡니다.'
  exit 0
fi
available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
[[ $available -ge 3000000 ]] || { echo '사용 가능한 메모리가 부족합니다.' >&2; exit 1; }
[[ -z $(ss -H -ltn 'sport = :22223') ]] || { echo '포트 22223이 사용 중입니다.' >&2; exit 1; }
if [[ -e "$vm_dir/vm.pid" ]]; then
  old_pid=$(cat "$vm_dir/vm.pid")
  [[ $old_pid =~ ^[0-9]+$ ]] || { echo '이전 PID 파일이 유효하지 않습니다.' >&2; exit 1; }
  if kill -0 "$old_pid" 2>/dev/null; then
    echo '이전 PID가 실행 중입니다. 확인 후 진행하세요.' >&2; exit 1
  fi
fi

history=$(mktemp -d "$vm_dir/boot-history.XXXXXXXX")
for name in vm.pid serial.log; do
  if [[ -e "$vm_dir/$name" ]]; then mv -- "$vm_dir/$name" "$history/$name"; fi
done
echo "이전 VM 실행 기록 보관: $history"
trap 'echo "시험이 중단됐습니다. VM과 시험 파일 상태를 보존합니다." >&2' ERR
cd "$vm_dir"
nice -n 15 qemu-system-x86_64 \
  -accel tcg,thread=multi -m 1536 -smp 2 \
  -drive file=test-disk.qcow2,if=virtio,format=qcow2 \
  -drive file=seed.iso,media=cdrom,readonly=on \
  -netdev user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:22223-:22 \
  -device virtio-net-pci,netdev=net0 -display none -monitor none \
  -serial file:serial.log -pidfile vm.pid -daemonize

ssh_options=(-i "$vm_dir/vm-key" -o BatchMode=yes -o ConnectTimeout=5
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$vm_dir/known_hosts")
ready=no
for attempt in $(seq 1 24); do
  if ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
    'test "$(hostname)" = bc250-fedora43-test && cloud-init status >/dev/null' \
    >/dev/null 2>&1; then
    ready=yes
    break
  fi
  echo "시험 VM 시작 대기 $attempt/24"
  sleep 5
done
[[ $ready == yes ]] || { echo '시험 VM에 접속하지 못했습니다.' >&2; exit 1; }

ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  "mkdir -m 700 \"\$HOME/$guest_dir\""
scp "${ssh_options[@]}" -P 22223 "$archive" \
  "vmtest@127.0.0.1:$guest_dir/source.tar.gz" </dev/null
ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  "set -e; cd \"\$HOME/$guest_dir\"; \
   printf '%s  %s\\n' '$expected' source.tar.gz | sha256sum -c -; \
   tar -xzf source.tar.gz; \
   sudo bash '$guest_script' \"\$HOME/$guest_dir\"$guest_extra"

echo '시험이 통과해 VM을 정상 종료합니다.'
ssh -n "${ssh_options[@]}" -p 22223 vmtest@127.0.0.1 \
  'test "$(hostname)" = bc250-fedora43-test && sudo systemctl poweroff' || true
pid=$(cat "$vm_dir/vm.pid")
for attempt in $(seq 1 45); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo '시험 VM 종료 확인'
    free -h
    exit 0
  fi
  sleep 2
done
echo '시험 VM이 아직 종료되지 않았습니다. 강제로 종료하지 않습니다.' >&2
exit 1
