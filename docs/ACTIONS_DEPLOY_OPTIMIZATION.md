# GitHub Actions 변경 영역별 배포 최적화 검토

검토일: 2026-11-15 · 기준: `.github/workflows/deploy.yml`, `deploy/deploy-release.sh`, `scripts/package-release.py` 로컬 소스. 실제 운영 서버 상태·Actions 실행 시간은 이번에 측정하지 않았다. [현재 배포 절차](ACTIONS_DEPLOYMENT.md) 및 [P5 후속 검증](PROMPT_COMPOSER_EXECUTION_TASKS.md)은 유지한다.

## 현재 동작

main push/수동 실행은 항상 Python·Node 설정 → backend Studio 테스트/ruff → frontend npm ci/lint/build → 전체 아카이브 생성 → SSH 업로드 → 서버 배포를 수행한다. 아카이브는 backend·config·pyproject/lock·frontend/dist를 필수로 갖는다. 서버 설치기는 매번 Studio를 정지하고 DB·코드 백업 후 양쪽을 교체하며 재시작한다. Python 의존성 동기화만 pyproject/lock의 실제 비교 결과에 따라 생략한다. 그러므로 단순히 frontend 빌드 단계를 건너뛰면 backend-only 배포에서 필수 dist가 없어 패키징이 실패한다. 반대로 backend 테스트만 생략해도 전체 backend 파일 교체와 서비스 재시작은 여전히 발생한다.

## 제안과 안전 조건

| 경우 | Actions에서 생략 후보 | 배포 시 조건 |
| --- | --- | --- |
| frontend 전용 | backend 설치·테스트·ruff | 현재 전체 아카이브와 설치기를 유지하면 backend도 교체·재시작하므로, 테스트 생략 전 운영 중 backend가 목표 커밋과 같다는 검증이 필요하다. 별도 정적 전용 설치기는 추가 설계·서버 설치 필요 |
| backend 전용 | frontend npm ci/lint/build | 현 아카이브에 dist 필수. 정확히 일치하는 이전 빌드 산출물을 신뢰할 수 있는 provenance로 가져오거나 별도 backend-only 설치기 필요 |
| 양쪽/공통·분류 불명 | 생략 없음 | 기존 전체 테스트·빌드·배포 |
| 문서 전용 | 배포 자체 생략 후보 | 문서만 변경됐음을 확인하되 이전 미배포 변경이 없다는 증거가 있을 때만 생략 |
| 수동 실행·첫 배포·비교 불가 | 생략 없음 | 전체 경로. 복구/재실행 시 이전 실패를 무시하지 않음 |

### 비교 기준

직전 push의 `before`와 `HEAD`만 비교해서 배포 범위를 결정하면 안 된다. 이전 배포 실패, 수동 서버 변경, 여러 push, 재실행, force push 또는 workflow 중단으로 운영 상태가 직전 Git 커밋과 다를 수 있다. **마지막 성공 배포의 검증된 아티팩트/커밋과 실제 설치 상태**를 기준으로 양쪽 변경을 판단하고 불확실하면 전체 경로로 돌아가야 한다. 경로 분류는 rename/deletion, lockfile, 모델 config, workflow·배포 스크립트, API 계약과 공통 테스트를 포함해야 한다. 프런트 변경이 서버 API에 의존하거나 반대로 API가 프런트 소비 방식에 영향을 주면 통합 검증이 필요하다.

### 구현 선택지

1. **작은 개선:** 전체 아카이브/설치 경로는 유지하고, 배포 기준 및 분류를 검증한 후 영향이 없는 테스트만 조건부로 생략한다. backend-only에서도 frontend dist는構築해야 하므로 frontend 빌드 생략의 효과는 제한된다. 검증된 동등성 증거가 없으면 테스트를 생략하지 않는다. 문서 전용 배포 생략도 동일 조건이다.
2. **부분 배포:** 독립적인 frontend/backend 아티팩트와 root 소유 설치기를 추가한다. 정적 변경만 있을 때는 서버의 실행 중 backend를 건드리지 않는 경로를 검토할 수 있다. backend-only는 기존 frontend를 보존한다. 각 경로의 무결성·설치 상태·API 호환·이전 실패 복구·동시 배포·백업 및 원자적 교체를 검증하고, backend 변경은 기존 모델 전환 journal·백업·서비스 health 보호를 유지한다. 이 방식은 서버 측 스크립트 변경, 설치 및 별도 롤백 검증이 필요하다.
3. **산출물 재사용:** 동일 소스·lock·빌드 설정·Node 버전뿐 아니라 `VITE_STUDIO_API_KEY` 같은 빌드 입력까지 일치하는 검증된 frontend 아티팩트를 재사용한다. 민감한 빌드 결과에 대한 접근 제어, 만료/삭제 및 비밀값 변경 시 무효화를 설계해야 한다. 동일 커밋의 재현 가능 패키징만으로 빌드 입력 동일성이나 아티팩트 신뢰성을 보장하지 않는다. 캐시 실패/검증 실패 시 재빌드한다.

## 후속 검증

- 마지막 성공 배포 기록과 서버 실제 설치본 불일치, 실패 후 다음 push, 여러 커밋, force push, 파일 삭제/이름 변경, 수동 실행, 초기 설치 및 아티팩트 손실을 시험한다.
- frontend-only/backend-only/양쪽/공통/문서-only 분류, 캐시 무효화, API 호환과 기존 직접 생성·retry를 검증한다.
- 서버 설치기 변경 시 root 소유 설치·해시 일치, journal 차단, 백업/복구, DB 및 서비스·gate 상태, 실패 중단 및 동시 실행을 검증한다. 실서버 적용과 롤백은 별도 배포 단계다.
- 현재와 후보의 Actions 단계별 소요 시간, 업로드 크기, 서버 서비스 중단 시간을 같은 조건에서 여러 차례 측정한다. 현재는 수치 근거가 없어 절감 시간을 단정하지 않는다.

이번 검토는 코드 경로 분석만 수행했다. workflow·설치기·운영 서버는 변경하지 않았다. 기존 P5 회귀 및 P6-UX 브라우저 검증은 별도 추적한다.
