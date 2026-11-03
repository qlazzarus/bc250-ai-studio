#!/usr/bin/env python3
"""Exercise read-only direct-caller observations without running services."""
import importlib.util
import io
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'deploy/model-control/observe-direct-llm.py'
spec = importlib.util.spec_from_file_location('direct_llm', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ObservationTest(unittest.TestCase):
    def test_slots_fail_closed(self):
        module.require_idle_slots([{'is_processing': False}])
        for data in ([], {}, [{'is_processing': True}], [{'is_processing': 0}], [{}]):
            with self.subTest(data=data), self.assertRaises(ValueError):
                module.require_idle_slots(data)

    def test_wiki_checked_twice_and_restart_rejected(self):
        def opener(*_):
            return SimpleNamespace(open=lambda *_args, **_kwargs: io.BytesIO(b'[{"is_processing":false}]'))
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'wiki_stopped') as wiki, \
             patch.object(module, 'llama_pid', side_effect=['42', '42']), \
             patch.object(module.urllib.request, 'build_opener', side_effect=opener):
            self.assertTrue(module.observe('/fixture/guard'))
            self.assertEqual(wiki.call_count, 2)
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'wiki_stopped'), \
             patch.object(module, 'llama_pid', side_effect=['42', '43']), \
             patch.object(module.urllib.request, 'build_opener', side_effect=opener):
            with self.assertRaises(ValueError):
                module.observe('/fixture/guard')

    def test_running_wiki_stops_before_request(self):
        with patch.object(module.os, 'geteuid', return_value=0), \
             patch.object(module, 'wiki_stopped', side_effect=RuntimeError('busy')), \
             patch.object(module, 'llama_pid') as pid:
            with self.assertRaises(RuntimeError):
                module.observe('/fixture/guard')
            pid.assert_not_called()


if __name__ == '__main__':
    unittest.main()
