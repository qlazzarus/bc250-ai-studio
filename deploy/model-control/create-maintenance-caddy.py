#!/usr/bin/env python3
"""Generate a maintenance candidate only for the reviewed Caddyfile."""

import os
import sys
from pathlib import Path

# Ignore indentation and full-line comments, but reject additional directives,
# imports, inline comments, and changes to the reviewed routing contract.
EXPECTED = '''
:80 {
encode zstd gzip
handle /llm/api/* {
uri strip_prefix /llm
reverse_proxy 127.0.0.1:8010 {
flush_interval -1
}
}
handle /llm {
redir /llm/ 308
}
handle_path /llm/* {
root * /opt/bc250-llm-client/frontend/dist
try_files {path} /index.html
file_server
}
handle /api/* {
reverse_proxy 127.0.0.1:8090 {
flush_interval -1
}
}
handle /wiki {
redir /wiki/ 308
}
handle_path /wiki/* {
reverse_proxy 127.0.0.1:8020
}
handle {
root * /opt/bc250-ai-studio/frontend/dist
try_files {path} /index.html
file_server
}
}
'''.strip().splitlines()


def candidate(original):
    lines = original.splitlines(keepends=True)
    directives = [(i, line.strip()) for i, line in enumerate(lines)
                  if line.strip() and not line.lstrip().startswith('#')]
    if [value for _, value in directives] != EXPECTED:
        raise ValueError('Caddy 설정이 검토된 구성과 다릅니다.')
    changes = []
    for route in ('handle /llm/api/* {', 'handle /api/* {'):
        pos = next(i for i, (_, value) in enumerate(directives) if value == route)
        start = directives[pos][0]
        # Both reviewed blocks contain one nested reverse_proxy block.
        end = directives[pos + (5 if route.startswith('handle /llm') else 4)][0]
        indent = lines[start][:len(lines[start]) - len(lines[start].lstrip())]
        replacement = (f'{indent}{route}\n'
                       f'{indent}    header Retry-After 120\n'
                       f'{indent}    respond "Service temporarily unavailable" 503\n'
                       f'{indent}}}\n')
        changes.append((start, end, replacement))
    for start, end, replacement in reversed(changes):
        lines[start:end + 1] = [replacement]
    return ''.join(lines)


def main():
    if len(sys.argv) != 3:
        raise SystemExit('사용법: create-maintenance-caddy.py 원본 후보')
    try:
        text = Path(sys.argv[1]).read_text(encoding='utf-8')
        result = candidate(text)
        fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as file:
            file.write(result)
            file.flush()
            os.fsync(file.fileno())
    except (OSError, UnicodeError, ValueError) as exc:
        raise SystemExit(f'유지보수 후보 생성 실패: {exc}') from None
    print('유지보수 후보 생성 완료; Caddy 설정은 적용하지 않았습니다.')


if __name__ == '__main__':
    main()
