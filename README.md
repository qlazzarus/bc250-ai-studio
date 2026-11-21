# BC-250 AI Studio

단일 Vulkan GPU를 공유하는 로컬 이미지 생성 플랫폼이다. FastAPI·SQLite 영속 큐와 React/Vite 웹 화면을 제공한다.

## 현재 제공 기능

- API 키/관리자 권한, 모델별 옵션·프리셋, 이미지·배치 생성과 취소·재시도
- 영속 이벤트 SSE, 보호된 갤러리·보관·삭제, seed·설정·메타데이터 재사용
- Fake 엔진과 stable-diffusion.cpp 어댑터, GPU 잠금과 LLM pause·drain·복구
- 사전 프롬프트 구성, 선택적 LLM 항목·상황·번역 제안, 구성 v1/v2 이력
- Pixel 프로젝트·Art Bible·의미 자산, Pillow 파생 PNG·버전·승인

기본 소스 설정은 **fake 엔진과 manual 정책**이다. 일반 키 사용자는 작업과 자산을 공유하며 계정별 격리는 없다. 통합 한글 프롬프트 자동 구성은 최우선 TODO다.

## 로컬 실행

```sh
uv sync --extra dev --locked
export STUDIO_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export STUDIO_ADMIN_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export STUDIO_POLICY=image_priority
./scripts/dev.sh
```

API는 `http://127.0.0.1:8090`, 데이터는 기본적으로 `~/.local/share/bc250-ai-studio`다. 같은 client 키로 `uv run python examples/rp_client.py`를 실행할 수 있다. 실제 GPU 실행은 서버 모델·gate·서비스 권한 설정이 필요하다.

프런트 실행은 [frontend/README.md](frontend/README.md)를 따른다. 로컬 API 연결 시 `VITE_STUDIO_TARGET=http://127.0.0.1:8090`을 설정한다. `VITE_STUDIO_API_KEY`는 브라우저 번들에 포함되므로 사이트 접근 범위를 제한하고 관리자 키를 사용하지 않는다.

## 문서

- [전체 문서 목록](docs/README.md): 현재 구성·API·모델·배포·검증
- [프로젝트 TODO](docs/TODO.md): 미구현 기능과 남은 검증
- [통합 프롬프트 구현 계획](docs/PROMPT_COMPOSER_UNIFIED_IMPLEMENTATION.md): DeepSeek 4.1 Flash 실행용 최우선 명세

문서에는 현재 동작과 TODO만 유지하며 날짜별 태스크 진행 이력은 누적하지 않는다.
