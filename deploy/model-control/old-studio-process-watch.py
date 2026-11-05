#!/usr/bin/env python3
"""Track one old Studio main process via pidfd; not a service or GPU fence.

The caller supplies an independently observed PID and /proc start time and
must separately ensure the old service cgroup is empty. This object cannot
survive process death and does not detect children that escaped the cgroup.
"""
import os
import select
from pathlib import Path


def process_starttime(pid):
    data = (Path('/proc') / str(pid) / 'stat').read_text(encoding='ascii')
    close = data.rfind(')')
    fields = data[close + 1:].split() if close >= 0 else []
    if len(fields) <= 19 or not fields[19].isdecimal():
        raise ValueError('프로세스 시작 시각을 확인하지 못했습니다.')
    return fields[19]


class OldStudioProcessWatch:
    def __init__(self, pid, expected_starttime):
        if (type(pid) is not int or pid <= 1 or type(expected_starttime) is not str
                or not expected_starttime.isdecimal()):
            raise ValueError('기존 주 프로세스 식별 정보가 필요합니다.')
        if process_starttime(pid) != expected_starttime:
            raise ValueError('기존 주 프로세스 세대가 다릅니다.')
        fd = os.pidfd_open(pid, 0)
        try:
            if process_starttime(pid) != expected_starttime:
                raise ValueError('기존 주 프로세스가 관찰 중 변경됐습니다.')
            self.fd = fd
            if self.exited():
                raise ValueError('기존 주 프로세스가 관찰 중 종료됐습니다.')
        except BaseException:
            os.close(fd)
            raise

    def exited(self):
        if self.fd is None:
            raise ValueError('닫힌 프로세스 감시기입니다.')
        poller = select.poll()
        poller.register(self.fd, select.POLLIN)
        events = poller.poll(0)
        if any(mask & (select.POLLERR | select.POLLNVAL) for _, mask in events):
            raise ValueError('기존 주 프로세스 감시에 실패했습니다.')
        return any(mask & (select.POLLIN | select.POLLHUP) for _, mask in events)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None
