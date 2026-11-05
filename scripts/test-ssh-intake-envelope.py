#!/usr/bin/env python3
"""Check the untrusted SSH intake envelope parser without opening connections."""
import importlib.util
import io
import json
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/ssh-intake-envelope.py'
spec = importlib.util.spec_from_file_location('ssh_intake_envelope', path)
envelope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(envelope)


class EnvelopeTest(unittest.TestCase):
    def setUp(self):
        self.identity = {'commit': 'a' * 40, 'sha256': 'b' * 64, 'run_id': '42', 'attempt': '1'}

    def test_header_leaves_candidate_bytes_unread(self):
        stream = io.BytesIO(json.dumps(self.identity).encode() + b'\n' + b'candidate\nbytes')
        self.assertEqual(envelope.read_header(stream), self.identity)
        self.assertEqual(stream.read(), b'candidate\nbytes')

    def test_invalid_headers_are_rejected(self):
        duplicate = b'{"commit":"a","commit":"b"}\n'
        cases = [duplicate, b'{}', b'\xff\n', b'x' * 1024 + b'\n',
                 json.dumps({**self.identity, 'run_id': 42}).encode() + b'\n',
                 json.dumps({**self.identity, 'attempt': '0'}).encode() + b'\n',
                 json.dumps({**self.identity, 'extra': 'x'}).encode() + b'\n']
        for raw in cases:
            with self.subTest(raw=raw[:30]), self.assertRaises(ValueError):
                envelope.read_header(io.BytesIO(raw))


if __name__ == '__main__':
    unittest.main()
