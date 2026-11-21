# Prompt composer browser verification

프롬프트 구성 회귀 검증용 CDP 하네스. 저장소 의존성을 추가하지 않고 Node 내장 `WebSocket`과 Playwright 번들 Chromium만 사용한다. 결과는 `docs/evidence/prompt-composer-gap04/`에 남는다.

## 실행

```sh
# 백엔드(fake fixture + 임시 data_dir) + Vite + Chromium을 한 번에 실행하고 정리한다.
sh scripts/prompt-composer-browser/verify.sh
```

- 기본 포트는 백엔드 4201, 프런트 4206이다. `BACKEND_PORT`/`WEB_PORT`로 바꾼다.
- `verify.sh`는 `mktemp -d` 데이터 디렉터리, `models.fixture.yaml`, 고정 테스트 키, 일회용 브라우저 프로필만 쓴다. 끝나면 데이터 디렉터리와 프로필을 지운다. 운영 서버·GPU·실데이터를 쓰지 않는다.
- 이미 백엔드/프런트를 띄워 두었다면 `APP_URL`을 주면 서버를 새로 띄우지 않는다.
  ```sh
  BACKEND_PORT=4201 sh scripts/prompt-composer-browser/serve.sh   # 다른 터미널, 유지
  APP_URL=http://localhost:4206/ sh scripts/prompt-composer-browser/verify.sh
  ```
- 환경 변수: `CHROME_PATH`(Chromium 실행 파일), `CDP_PORT`, `APP_URL`, `SHOT_DIR`, `RESULT_FILE`, `OUT`.
  - macOS에서 Playwright 번들이 없으면 Edge를 쓸 수 있다: `CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"`.
- `run.mjs`는 `APP_URL` 없이 실행되지 않는다. 격리 서버를 거치지 않는 실수로 운영 주소를 치는 것을 막기 위해서다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `make_fixture_registry.py` | `models.fixture.yaml` 재생성(fake-sd15/alt, fake-flux2, fake-unknown) |
| `models.fixture.yaml` | 위 스크립트 산출물. 모든 엔진이 `fake`다 |
| `driver.mjs` | CDP 연결, evaluate/click/type/select, **실제 키 이벤트**(Tab/Shift+Tab/Space/Enter), 스크린샷 |
| `suite.mjs` | 진입점(GAP03), 그룹 순서, 칩 제거 후 포커스(GAP01) |
| `suite-messages.mjs` | 메시지 3등급(GAP02), separate/verbatim, 미지원 계열, 8001자 차단 |
| `suite-keyboard.mjs` | 키보드 순회·조작, 터치 크기, 360/390/1280 반응형 |
| `suite-contracts.mjs` | 적용·덮어쓰기 취소, 생성, 과거 복원, 422/413, 계열 전환, capability 미지원 |
| `suite-trans06.mjs` | 번역 제안→포함→적용→모델 계열 변경→기록 유지→재적용, 그리고 실제 `POST /jobs` 본문의 v2 `remainder`·출처 검사 |
| `suite-u12.mjs` | 실제 SQLite 왕복: 제출→metadata 조회→갤러리 `정보`/구성 이력→`이 설정으로 다시 생성`→새로고침 후 재확인→취소 작업 `재시도` |
| `run.mjs` | Chromium 기동, 스위트 실행, `results.json` 기록 |

## 주의

- `press()`는 keydown **한 번**만 보낸다. keydown과 char를 함께 보내면 Enter가 두 번 활성화되어 버튼이 두 번 눌린다(하네스에서 실제로 겪은 문제).
- `.focus()` 후 `activeElement`만 비교하면 키보드 도달성을 입증하지 못한다. `tab()`으로 실제 순회한 결과를 기록한다.
- 결과 판정은 `results.json`의 `pass` 값이다. `pass: null`은 참고 기록이며 실패가 아니다.
- 이 하네스는 실기기 터치·스크린리더·확대·운영 서버·GPU 품질을 검증하지 않는다([남은 검증](../../docs/TODO.md) 참조).
- **번역문은 stub이다.** 모든 스위트가 페이지 안에서 제안 응답을 가로채므로 이 결과로 번역 품질을 말할 수 없다. `results.json` 첫 항목 `증거 출처`가 `engine`/`llm`/`claim`을 기록하며, `run.mjs`는 fake 엔진에 stub이 아닌 llm 표기를 주면 실행을 거부한다. 실연결 품질은 `scripts/live02_proposals.py`(LIVE02)다.
