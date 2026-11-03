#!/usr/bin/env python3
"""Compose verified deployment candidates; not an operational entry point.

The caller must authenticate and stage the immutable release, provide real
health/quiescence/install checks, and keep this process alive at the operator's
manual Client restart boundary. No automatic recovery or CLI is provided.
"""
import importlib.util
import os
import re
import stat
from pathlib import Path


def trusted(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('릴리스 경로가 올바르지 않습니다.')
    for item in (path, *path.parents):
        info = item.lstat()
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            raise ValueError('릴리스 경로를 신뢰할 수 없습니다.')
        if item != path or directory:
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError('릴리스 디렉터리 경로가 올바르지 않습니다.')
        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('릴리스 파일이 단일 링크의 일반 파일이 아닙니다.')


def load(name, path):
    trusted(path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def assemble(*, source, snapshot, journal_dir, commit, artifact_sha256, checker_sha256,
             expected_client_user, verify_release, preflight, check_local_idle,
             check_caddy_transition, check_restored, install, verify_new, verify_restored, initial_install_paths=None,
             wiki_record_dir=None, initial_idle_factory=None):
    callbacks = (verify_release, preflight, check_caddy_transition, check_restored,
                 verify_new, verify_restored)
    if (os.geteuid() != 0 or not all(callable(item) for item in callbacks)
            or (initial_idle_factory is None and not callable(check_local_idle))
            or (initial_idle_factory is not None and (not callable(initial_idle_factory)
                or check_local_idle is not None or initial_install_paths is None))
            or (initial_install_paths is None and not callable(install))
            or (initial_install_paths is not None and (install is not None
                or not isinstance(initial_install_paths, dict)
                or set(initial_install_paths) != {'displaced', 'cache', 'model_cache', 'manifest_dir'}))
            or ((initial_install_paths is None) != (wiki_record_dir is None))
            or not re.fullmatch(r'[0-9a-f]{40}', commit)
            or not re.fullmatch(r'[0-9a-f]{64}', artifact_sha256)
            or not re.fullmatch(r'[0-9a-f]{64}', checker_sha256)):
        raise ValueError('root, 릴리스 식별 정보와 필수 검사기가 필요합니다.')
    source, snapshot, journal_dir = map(Path, (source, snapshot, journal_dir))
    trusted(source, directory=True)
    trusted(snapshot, directory=True)
    trusted(journal_dir, directory=True)
    if verify_release(commit, artifact_sha256) is not True:
        raise ValueError('릴리스의 출처와 내용을 확인하지 못했습니다.')
    caddy_module = load('caddy_adapter', source / 'caddy-maintenance-adapter.py')
    backup_module = load('backup_adapter', source / 'legacy-backup-adapter.py')
    startup_module = load('startup_adapter', source / 'start-new-services.py')
    configuration_module = load('configuration_adapter', source / 'staged-configuration-adapter.py')
    journal_module = load('migration_journal', source / 'migration-journal.py')
    coordinator_module = load('migration_coordinator', source / 'coordinated-migration.py')
    config = configuration_module.ConfigurationCheck(source / 'verify-staged-secrets.py', checker_sha256)
    caddy = caddy_module.CaddyMaintenanceAdapter(source, snapshot,
        check_local_idle=check_caddy_transition, check_restored=check_restored)
    wiki_fence = None
    effective_idle = check_local_idle
    if initial_install_paths is not None:
        wiki_module = load('initial_wiki_fence', source / 'wiki-condition-fence.py')
        wiki_fence = wiki_module.WikiConditionFence(source, wiki_record_dir, persistent=True)
        if initial_idle_factory is not None:
            check_local_idle = initial_idle_factory(wiki_fence)
            if not callable(check_local_idle):
                raise ValueError('최초 유휴 검사기를 생성하지 못했습니다.')
        def effective_idle():
            # The same fence used by the coordinator must surround each observation.
            return (wiki_fence.check() is True and check_local_idle() is True
                    and wiki_fence.check() is True)
    backup = backup_module.LegacyBackupAdapter(source, snapshot, check_local_idle=effective_idle)
    if initial_install_paths is not None:
        initial_module = load('initial_install_adapter', source / 'initial-install-adapter.py')
        install = initial_module.InitialInstallAdapter(
            source.parent.parent, **initial_install_paths,
            check_release=lambda: verify_release(commit, artifact_sha256),
            check_configuration=config, check_maintenance=backup.maintenance,
            check_local_idle=effective_idle)
    startup = startup_module.NewServiceStart(source / 'backup-archive.sh',
        check_maintenance=backup.maintenance, check_release=lambda: verify_release(commit, artifact_sha256),
        check_local_idle=effective_idle, check_configuration=config,
        expected_client_user=expected_client_user)
    def all_preflight():
        # Wiki can still be running here; post-fence idle checks happen in backup and install.
        return (verify_release(commit, artifact_sha256) is True and preflight() is True
                and (initial_install_paths is not None or check_local_idle() is True)
                and config() is True)
    journal = journal_module.MigrationJournal(journal_dir)
    try:
        journal.release(commit, artifact_sha256)
        runner = coordinator_module.CoordinatedMigration(
            record=journal, preflight=all_preflight, transition=caddy.transition,
            transition_args={}, backup_adapter=backup, install=install, startup=startup,
            verify_new=verify_new, verify_restored=verify_restored, wiki_fence=wiki_fence)
    except BaseException:
        journal.close()
        raise
    return runner, journal
