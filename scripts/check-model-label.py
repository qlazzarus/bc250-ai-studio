#!/usr/bin/env python3
"""Compare existing model-file metadata with a disposable systemd-created file."""

import os
import stat
import tempfile
from pathlib import Path

MODEL = Path("/opt/ai/config/active-model.conf")


def protected(fd):
    names = set(os.listxattr(fd))
    return {name: os.getxattr(fd, name)
            for name in ("security.selinux", "system.posix_acl_access") if name in names}


def main():
    if os.geteuid() != 0:
        raise SystemExit("root 권한이 필요합니다.")
    for path in reversed(MODEL.parent.parents):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit(f"신뢰할 수 없는 상위 경로: {path}")
    info = MODEL.parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise SystemExit(f"신뢰할 수 없는 설정 디렉터리: {MODEL.parent}")

    source_fd = os.open(MODEL, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        metadata = os.fstat(source_fd)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_nlink != 1 or metadata.st_mode & 0o022):
            raise SystemExit("활성 설정 파일의 소유권 또는 권한을 확인해야 합니다.")
        existing = protected(source_fd)
    finally:
        os.close(source_fd)

    fd, path = tempfile.mkstemp(prefix=".bc250-label-check-", dir=MODEL.parent)
    try:
        try:
            os.fchown(fd, metadata.st_uid, metadata.st_gid)
            os.fchmod(fd, stat.S_IMODE(metadata.st_mode))
            temporary = protected(fd)
        finally:
            os.close(fd)

        for name, attrs in (("기존 설정", existing), ("systemd 임시 파일", temporary)):
            context = attrs.get("security.selinux")
            print(name + " SELinux 레이블:",
                  context.rstrip(b"\0").decode("utf-8", errors="replace") if context else "없음")
            print(name + " 추가 ACL:", "있음" if "system.posix_acl_access" in attrs else "없음")
        print("보호 속성 전체 일치:", existing == temporary)
    finally:
        os.unlink(path)


if __name__ == "__main__":
    main()
