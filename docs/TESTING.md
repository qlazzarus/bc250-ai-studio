# 검증 가이드

검증은 현재 checkout에서 다시 실행한 결과로 판단한다. 과거 통과 개수나 스크린샷은 현재 버전의 성공을 대신하지 않는다. 기본 테스트는 fake 엔진이며 GPU 품질을 증명하지 않는다.

## 로컬 검사

저장소 루트에서 의존성을 준비한다.

```sh
uv sync --extra dev --locked
npm --prefix frontend ci
```

| 범위 | 명령 |
| --- | --- |
| Studio 릴리스 회귀 | `STUDIO_TEST_PYTHON=.venv/bin/python bash scripts/test-studio.sh` |
| 전체 백엔드 | `.venv/bin/python -m pytest backend/tests -q` |
| 프롬프트 프런트 | `node --experimental-strip-types --test frontend/tests/*.test.mjs` |
| 프롬프트 서버 | `.venv/bin/python -m pytest backend/tests/test_prompt_composition.py backend/tests/test_prompt_proposals.py backend/tests/test_proposal_provider.py backend/tests/test_proposal_api.py -q` |
| 타입·빌드 | `npm --prefix frontend run build` |
| 프런트 lint | `npm --prefix frontend run lint` |
| 백엔드 lint | `.venv/bin/ruff check backend` |
| 설치기 | `bash -n deploy/deploy-release.sh` 및 `.venv/bin/python -m pytest -q scripts/test_studio_static_deploy.py` |
| diff | `git diff --check` |

Studio 릴리스 스크립트는 지정된 테스트 파일만 실행한다. 전체 backend, 프롬프트 추가 검사, 모델 제어 후보·Linux VM 스크립트의 전체 성공을 의미하지 않는다. CI가 실제 실행하는 목록은 `.github/workflows/deploy.yml`을 따른다.

## 브라우저

```sh
sh scripts/prompt-composer-browser/verify.sh
```

격리된 fake 서버·임시 데이터·브라우저 프로필을 사용한다. 포트·Chromium 경로·출력 환경변수는 [하네스 설명](../scripts/prompt-composer-browser/README.md)을 따른다. 실제 SQLite 왕복과 키보드 조작, 모델 변경, 번역 포함·복원을 검사하지만 LLM 응답은 페이지 stub이다. `docs/evidence/`는 하네스 산출물 위치다.

## 실연결과 GPU

`scripts/live02_proposals.py --help`로 기존 proposals 실연결 입력을 확인한다. 실제 capability·provider가 없는 fake/stub 환경은 품질 평가에 사용하지 않는다. 새 통합 compose는 아직 구현되지 않았다.

GPU 검증은 설치 binary 해시·Vulkan 장치·모델 파일/프리셋·seed·해상도·steps·CFG·negative·실행 시간·PNG·메타데이터와 LLM 복구를 함께 확인한다. gate를 우회하는 호출이 없는지와 기존 큐·복구 상태를 먼저 점검한다. 실기 결과는 해당 조합에 한해 레지스트리의 검증 상태에 반영한다. 미검증 항목은 [TODO](TODO.md)에 둔다.
