#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('llama_connections',
    Path(__file__).resolve().parents[1] / 'deploy/model-control/observe-llama-connections.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
HEADER = '  sl  local_address rem_address st tx_queue rx_queue'


def row(local, state):
    return f' 0: {local} 00000000:1234 {state} 00000000 00000000'


class ConnectionsTest(unittest.TestCase):
    def test_listener_and_time_wait_are_not_active(self):
        table = '\n'.join([HEADER, row('0100007F:1F90', '0A'), row('0100007F:1F90', '06')])
        self.assertEqual(module.busy_listener_connections(table, 8080), 0)

    def test_active_server_side_and_unfinished_closing_are_detected(self):
        table = '\n'.join([HEADER, row('0100007F:1F90', '01'), row('00000000:1F90', '08'),
                           row('0100007F:2222', '01')])
        self.assertEqual(module.busy_listener_connections(table, 8080), 2)

    def test_ipv6_and_malformed_input_fail_closed(self):
        table = '\n'.join([HEADER, row('00000000000000000000000001000000:1F90', '03')])
        self.assertEqual(module.busy_listener_connections(table, 8080), 1)
        with self.assertRaises(ValueError):
            module.busy_listener_connections(HEADER + '\n 0: invalid', 8080)
        with self.assertRaises(ValueError):
            module.busy_listener_connections(HEADER + '\n' + row('0100007F:1F90', 'FF'), 8080)


if __name__ == '__main__':
    unittest.main()
