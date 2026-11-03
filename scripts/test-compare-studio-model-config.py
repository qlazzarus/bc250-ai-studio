#!/usr/bin/env python3
"""Exercise the read-only comparison with a local SSH stand-in."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/compare-studio-model-config-remote.sh'


class CompareTest(unittest.TestCase):
    def test_matching_and_different(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / 'server-models'
            ssh = base / 'ssh'
            ssh.write_text('''#!/usr/bin/env python3
import os, subprocess, sys
assert sys.argv[1:4] == ["-p", os.environ["TEST_PORT"], os.environ["TEST_HOST"]]
source = sys.stdin.read().replace("/opt/bc250-ai-studio/config/models.yaml", os.environ["TEST_FILE"])
raise SystemExit(subprocess.run(["python3", "-", sys.argv[-1]], input=source, text=True).returncode)
''')
            ssh.chmod(0o755)
            env = dict(os.environ, PATH=f'{base}:' + os.environ['PATH'], TEST_FILE=str(target),
                       TEST_PORT='2222', TEST_HOST='yeppyshiba@yeppyshiba.iptime.org')
            target.write_bytes((ROOT / 'config/models.yaml').read_bytes())
            def run():
                return subprocess.run(['bash', str(SCRIPT), 'external'], env=env, text=True,
                                      capture_output=True, check=True).stdout
            self.assertIn('작업 트리 후보: 일치', run())
            target.write_text('private sentinel content')
            output = run()
            self.assertIn('작업 트리 후보: 다름', output)
            self.assertNotIn('private sentinel content', output)


if __name__ == '__main__':
    unittest.main()
