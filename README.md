# BC-250 AI Studio

AMD BC-250의 단일 Vulkan GPU를 공유하는 로컬 이미지 생성 플랫폼.
현재 제공 범위는 **Phase 0 + Phase 2**입니다.

- FastAPI `/api/v1`, API 키·관리자 권한, 모델별 설정·프리셋
- SQLite/SQLAlchemy + Alembic 영속 큐, 이미지·배치 작업, 취소·재시도
- 원본 설정·시드·이미지·로그 연결, 네임스페이스별 결과 저장
- 영속 이벤트 기반 SSE 재연결, 재시작 시 interrupted 복구
- Fake Engine, stable-diffusion.cpp 인자 배열 어댑터
- GPU 락, LLM 배수·정지·복구, 실패 시 차단과 관리자 복구
- React/Vite NSFW Art Studio: 모델·프리셋 인지 입력, 큐, 보호된 갤러리, 메타데이터 재사용

**기본값은 Fake Engine과 manual 정책입니다.** Klein 4B Q4의 단일 BC-250 Vulkan
테스트는 512×512·4 steps에서 성공했습니다. API 실제 엔진 전환은 여전히 서비스 allowlist,
LLM admission gate, 최소 polkit 권한 검증이 필요합니다.
모델·기존 서비스·기존 출력은 수정하지 않습니다.

## 빠른 실행 (CPU 전용)

```sh
uv sync --extra dev --locked
export STUDIO_API_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export STUDIO_ADMIN_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export STUDIO_POLICY=image_priority
./scripts/dev.sh
```

다른 셸에는 같은 `STUDIO_API_KEY`를 전달한 뒤:

```sh
uv run python examples/rp_client.py
```

API 기본 주소: `http://127.0.0.1:8090`. 데이터 기본 위치:
`~/.local/share/bc250-ai-studio` (저장소 밖). 비밀 키는 커밋하지 않습니다.

## BC-250 배포 및 외부 테스트

[단계별 배포 가이드](docs/DEPLOYMENT.md)에 Fedora 설치·서비스 등록부터 외부 PNG 다운로드까지 정리했습니다.

1. 소스를 전송하고 전용 계정·가상환경·API 키를 생성합니다.
2. Fake Engine으로 systemd 서비스를 실행합니다.
3. 먼저 SSH 터널로 외부 접속을 검증합니다. 공개 URL이 필요하면 Caddy HTTPS를 추가합니다.
4. 인증 → 작업 접수 → SSE → PNG·메타데이터 조회를 확인합니다.

서버 설정 예제: [환경변수](deploy/studio.env.example), [Caddy](deploy/Caddyfile.example).
웹 UI의 로컬 실행과 SSH 터널 연결은 [frontend/README.md](frontend/README.md)를 참고하세요.
실제 GPU 테스트에는 별도 LLM 요청 게이트와 승인 절차가 필요합니다.

## 문서

- [설계 및 로컬 환경 확인](docs/ARCHITECTURE.md)
- [API 계약](docs/API.md)
- [모델 레지스트리](docs/MODELS.md)
- [실행·서버 조사·배포·복구](docs/DEPLOYMENT.md)
- [단계별 구현 범위](docs/ROADMAP.md)
- [테스트 결과와 한계](docs/TESTING.md)
- [다음 프로젝트 LLM 클라이언트 인계 문서](docs/NEXT_PROJECT_LLM_CLIENT.md)
- [Pixel Studio 설계·API·후속 범위](docs/PIXEL_STUDIO.md)

Pixel Art·Phaser Export는 Phase 3, 통합 LLM 채팅 프록시는 Phase 4입니다.

```sh
uv run pytest -q
uv run ruff check .
```

> 일부 과거 테스트 문서에서 언급하는 서버 진단 자료와 생성 결과물은 공개 저장소에 포함하지 않습니다.
