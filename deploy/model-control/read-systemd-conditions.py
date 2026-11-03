#!/usr/bin/env python3
"""Read systemd Unit.Conditions using one system-bus connection.

This is an internal read-only candidate. It loads and references the unit on
the same D-Bus connection, so an inactive unit is not garbage-collected
between the object lookup and property read. It never starts or stops units.
"""
import ctypes
import re

SERVICE = b'org.freedesktop.systemd1'
MANAGER = b'/org/freedesktop/systemd1'
MANAGER_IFACE = b'org.freedesktop.systemd1.Manager'
UNIT_IFACE = b'org.freedesktop.systemd1.Unit'


def read_conditions(unit):
    if not isinstance(unit, str) or not re.fullmatch(r'[A-Za-z0-9_.@-]+\.service', unit):
        raise ValueError('systemd 서비스 이름이 올바르지 않습니다.')
    lib = ctypes.CDLL('libsystemd.so.0')
    void = ctypes.c_void_p
    char = ctypes.c_char_p
    ptr = ctypes.POINTER(void)
    lib.sd_bus_open_system.argtypes = [ptr]
    lib.sd_bus_open_system.restype = ctypes.c_int
    lib.sd_bus_call_method.argtypes = [void, char, char, char, char, void, ptr, char]
    lib.sd_bus_call_method.restype = ctypes.c_int
    lib.sd_bus_get_property.argtypes = [void, char, char, char, char, void, ptr, char]
    lib.sd_bus_get_property.restype = ctypes.c_int
    lib.sd_bus_message_read.argtypes = [void, char]
    lib.sd_bus_message_read.restype = ctypes.c_int
    lib.sd_bus_message_enter_container.argtypes = [void, ctypes.c_char, char]
    lib.sd_bus_message_enter_container.restype = ctypes.c_int
    lib.sd_bus_message_exit_container.argtypes = [void]
    lib.sd_bus_message_exit_container.restype = ctypes.c_int
    lib.sd_bus_message_unref.argtypes = [void]
    lib.sd_bus_message_unref.restype = void
    lib.sd_bus_unref.argtypes = [void]
    lib.sd_bus_unref.restype = void
    bus = void()
    reply = void()
    def require(result):
        if result < 0:
            raise RuntimeError('systemd D-Bus 조건 조회에 실패했습니다.')
        return result
    require(lib.sd_bus_open_system(ctypes.byref(bus)))
    try:
        require(lib.sd_bus_call_method(bus, SERVICE, MANAGER, MANAGER_IFACE, b'LoadUnit',
                                      None, ctypes.byref(reply), b's', char(unit.encode('ascii'))))
        unit_path = char()
        if require(lib.sd_bus_message_read(reply, b'o', ctypes.byref(unit_path))) == 0 or not unit_path.value:
            raise RuntimeError('systemd unit 경로를 확인하지 못했습니다.')
        path = unit_path.value
        reply = void(lib.sd_bus_message_unref(reply))
        require(lib.sd_bus_call_method(bus, SERVICE, MANAGER, MANAGER_IFACE, b'RefUnit',
                                      None, ctypes.byref(reply), b's', char(unit.encode('ascii'))))
        reply = void(lib.sd_bus_message_unref(reply))
        require(lib.sd_bus_get_property(bus, SERVICE, path, UNIT_IFACE, b'Conditions',
                                        None, ctypes.byref(reply), b'a(sbbsi)'))
        if require(lib.sd_bus_message_enter_container(reply, b'a', b'(sbbsi)')) != 1:
            raise RuntimeError('systemd 조건 배열을 확인하지 못했습니다.')
        values = []
        while True:
            result = require(lib.sd_bus_message_enter_container(reply, b'r', b'sbbsi'))
            if result == 0:
                break
            if len(values) >= 1024:
                raise RuntimeError('systemd 조건 수가 너무 많습니다.')
            name, argument = char(), char()
            trigger, negate, status = ctypes.c_int(), ctypes.c_int(), ctypes.c_int()
            if require(lib.sd_bus_message_read(reply, b'sbbsi', ctypes.byref(name), ctypes.byref(trigger),
                    ctypes.byref(negate), ctypes.byref(argument), ctypes.byref(status))) == 0:
                raise RuntimeError('systemd 조건 항목을 확인하지 못했습니다.')
            if not name.value or argument.value is None or trigger.value not in (0, 1) or negate.value not in (0, 1):
                raise RuntimeError('systemd 조건 항목이 올바르지 않습니다.')
            values.append([name.value.decode('utf-8'), bool(trigger.value), bool(negate.value),
                           argument.value.decode('utf-8'), status.value])
            require(lib.sd_bus_message_exit_container(reply))
        require(lib.sd_bus_message_exit_container(reply))
        return {'type': 'a(sbbsi)', 'data': values}
    finally:
        if reply:
            lib.sd_bus_message_unref(reply)
        if bus:
            lib.sd_bus_unref(bus)
