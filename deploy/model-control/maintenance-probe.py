#!/usr/bin/env python3
"""Read-only probe for the generated maintenance Caddy routes.

This observes ingress only. It cannot establish GPU, local caller, gate or
application quiescence and is not itself an authorization to deploy.
"""

import urllib.error
import urllib.request


def probe(base='http://127.0.0.1:80'):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for path in ('/api/bc250-maintenance-probe', '/llm/api/bc250-maintenance-probe'):
        try:
            response = opener.open(base + path, timeout=5)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            body = response.read(1025)
            if (response.status != 503 or response.headers.get('Retry-After') != '120'
                    or body != b'Service temporarily unavailable'):
                raise RuntimeError('유지보수 API 응답을 확인하지 못했습니다: ' + path)
    return True


def main():
    try:
        probe()
    except (OSError, ValueError, RuntimeError) as exc:
        raise SystemExit(f'유지보수 확인 실패: {exc}') from None
    print('두 API의 유지보수 응답 확인; 직접 호출과 GPU 작업은 별도 확인이 필요합니다.')


if __name__ == '__main__':
    main()
