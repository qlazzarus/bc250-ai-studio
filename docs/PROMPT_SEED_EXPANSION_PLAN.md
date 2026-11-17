# 프롬프트 Seed 사전 확장 계획

상태: **S0·S1·S2·S3 완료, S4 부분 완료** · 작성일: 2026-11-15, 갱신일: 2026-11-15. 사전 1.2.0은 MOSS 계열 표현까지 반영했으며 GPU 품질 검증은 아직 수행하지 않았다. Compiler와 UI 작업 상태는 작업 계획을 참조한다. 진행 현황은 [작업 계획](PROMPT_COMPOSER_EXECUTION_TASKS.md)에서 관리한다.

현재 구현은 [구현 현황](PROMPT_COMPOSER_CURRENT.md)을 따른다. 아래 1.0.0/1.1.0 및 미결 사항 설명은 확장 당시 설계 기록이다. 현재는 1.2.0·100개이며 MOSS도 100/100 매핑, 기존 카테고리의 표시 그룹과 분류·ID 정렬이 반영되어 있다.

## 목표와 경계

P1 사전 12개를 포함해 **약 100개**의 직접 큐레이션한 항목으로 확장한다. 모든 모델이 공통 선택·검색 흐름을 사용하고, 모델별 표현과 품질 검증은 구분한다. 100개는 목표 규모이며 억지로 채우지 않는다. 기존 `DictionaryEntry`, `Mapping`, `SelectionSnapshot`, `SceneSpecification`의 타입·의미·스냅샷 계약을 유지한다. P2/P3가 1.0.0을 이용해 독립 진행할 수 있도록 이 계획은 해당 작업의 선행 조건이 아니다.

현재 `mapped`는 **문자열이 존재한다는 데이터 상태**이지 모델 실행 지원이나 BC-250 검증 상태가 아니다. `unavailable`은 해당 사전 표현을 제공하지 않는다는 뜻이며 모델 자체의 미지원을 뜻하지 않는다. 검증·지원 상태를 사전에 새로 추측해 넣지 않는다. 모델 파일·실행·기능 capability는 기존 레지스트리와 상위 계획에서 별도 관리한다. `moss-image`는 매핑 근거를 별도 확인하고 미확정이면 `unavailable`, `fake`는 표현 미제공을 유지한다. 알 수 없는 family도 기존처럼 `unavailable`이다.

## 분류와 ID 호환

Danbooru의 [태그 작성 가이드](https://safebooru.donmai.us/wiki_pages/howto%3Atag)는 general, artist, character, copyright, meta를 구분한다. 아래 열 개는 이 Studio의 **사용자 중심 분류**로, Danbooru의 공식 최상위 분류가 아니다. 일반적인 시각 요소의 범주화에만 참고하며 작가·작품·캐릭터·이미지·메타데이터의 대량 수집은 하지 않는다.

| 화면 분류 | 목표 개수 | 내용과 기존 항목 |
| --- | ---: | --- |
| subject | 8 | 인물, 초상 등 |
| appearance | 12 | 머리 길이·색, 안경 등 |
| clothing | 12 | 셔츠·재킷 등 |
| expression | 8 | 웃음·표정 등 |
| pose | 10 | 자세·동작. 기존 `action.*`은 그대로 유지 |
| setting | 12 | 장소·배경. 기존 `location.*`은 그대로 유지 |
| camera | 10 | 구도·시점. 기존 `composition.*`은 그대로 유지 |
| lighting | 10 | 광원·시간대 |
| style | 10 | 사진·일러스트 등 |
| mood | 8 | 차분함·긴장감 등 |
| 합계 | **100** | 기존 12개 포함한 목표 |

현재 category 값 `action`, `location`, `composition`은 해당 기존 항목에서 변경하지 않는다. P3가 사용할 화면 그룹 매핑(`action → pose`, `location → setting`, `composition → camera`)은 **별도의 표시 계층 후보**이며 저장된 카테고리와 ID를 변경하지 않는다. UI는 기존 여섯 카테고리도 처리하며 사전 확장 없이 동작한다. 신규 항목은 위 열 개 그룹명을 사용하되 이미 있는 개념에 새 중복 ID를 만들지 않는다. 1.0.0의 12개 ID·의미·기존 당시 문자열/스냅샷을 보존하고, 기존 표현 변경이 필요하면 별도 검토·버전 기록 후 과거 스냅샷은 바꾸지 않는다. 비활성화 시에도 이전 선택 스냅샷을 읽을 수 있어야 한다.

사전 버전은 호환되는 항목 추가에 `1.1.0`을 제안한다. 정식 버전은 구현 시 결정하고 변경 기록에 추가·변경·비활성 항목을 남긴다. 항목 삭제·의미 변경 및 구조 변경은 호환성 검토와 별도 마이그레이션 결정이 필요하다.

## 구현 전 샘플 20개

아래 표는 **제안**이다. 각 카테고리 2개이며 `*`는 현재 1.0.0에 있는 ID다. `SD`는 태그형 표현, `자연어`는 Z-Image/FLUX 계열의 초기 표현 가설이다. MOSS는 근거 확인 전 미확정. 열의 표현은 사용할 수 있는 예시일 뿐 이미지 품질·모델 지원 상태의 검증 결과가 아니다. 표의 새 ID·별칭·표현을 아직 코드에 추가하지 않았다.

| 그룹 | 안정 ID | 한국어 표시명 / 검색 별칭 | SD | Z-Image / FLUX 자연어 표현 |
| --- | --- | --- | --- | --- |
| subject | `subject.person` * | 인물 / 사람 | `a person` | `a person` |
| subject | `subject.portrait` * | 인물 초상 / 초상화 | `a portrait` | `a portrait` |
| appearance | `appearance.short_hair` | 짧은 머리 / 단발, 짧은 헤어 | `short hair` | `with short hair` |
| appearance | `appearance.glasses` | 안경 / 안경 착용 | `glasses` | `wearing glasses` |
| clothing | `clothing.white_shirt` | 흰 셔츠 / 흰색 셔츠 | `white shirt` | `wearing a white shirt` |
| clothing | `clothing.jacket` | 재킷 / 자켓 | `jacket` | `wearing a jacket` |
| expression | `expression.smile` | 미소 / 웃는 얼굴 | `smile` | `smiling` |
| expression | `expression.serious` | 진지한 표정 / 엄숙한 얼굴 | `serious expression` | `with a serious expression` |
| pose | `action.standing` * | 서 있기 / 서다 | `standing` | `standing` |
| pose | `action.walking` * | 걷기 / 걷는 | `walking` | `walking` |
| setting | `location.street` * | 거리 / 길거리 | `on a street` | `on a street` |
| setting | `location.room` * | 실내 / 방 | `indoors` | `indoors` |
| camera | `composition.full_body` * | 전신 / 전신샷 | `full body` | `shown full body` |
| camera | `composition.close_up` * | 클로즈업 / 근접 | `close-up` | `shown in close-up` |
| lighting | `lighting.soft` * | 부드러운 조명 / 은은한 빛 | `soft lighting` | `in soft lighting` |
| lighting | `lighting.neon` * | 네온 조명 / 네온사인 | `neon lighting` | `under neon lighting` |
| style | `style.photographic` * | 사진 스타일 / 사진 | `photographic style` | `in a photographic style` |
| style | `style.illustration` * | 일러스트 / 삽화 | `illustration style` | `in an illustration style` |
| mood | `mood.calm` | 차분한 분위기 / 고요한 | `calm mood` | `with a calm mood` |
| mood | `mood.tense` | 긴장된 분위기 / 긴장감 | `tense mood` | `with a tense mood` |

기존 `mappings[family].text`와 위 자연어 예시가 다른 기존 ID는 주의가 필요하다. 현재 1.0.0은 모든 실제 family에 같은 문자열을 저장하므로 P2가 해당 문자열을 해석하는 법, 기존 ID의 family별 표현을 1.1.0에서 바꿀지, 또는 compiler에서 문장 요소를 감쌀지는 **P2와 조정할 미결 사항**이다. 기존 스냅샷에 당시 mapping 문자열만 있고 새 사전을 조회하지 않아도 동작해야 한다. 예시는 최종 인터페이스·구현을 확정하지 않는다.

## 예상 컴파일 결과: 문서상 예시

선택: 인물, 짧은 머리, 흰 셔츠, 미소, 서 있기, 거리, 전신, 부드러운 조명, 사진 스타일, 차분한 분위기. 가중치와 자유 입력은 없음.

- SD 1.5 가설: `a person, short hair, white shirt, smile, standing, on a street, full body, soft lighting, photographic style, calm mood`
- Z-Image 가설: `A person with short hair, wearing a white shirt, stands on a street and smiles. Shown full body in soft lighting, in a photographic style, with a calm mood.`
- FLUX 계열 가설: `A person with short hair, wearing a white shirt, stands on a street and smiles. Shown full body in soft lighting, in a photographic style, with a calm mood.`

위 문장은 사람이 작성한 목표 예시이며 현재 compiler 1.1.0은 자연어 완성 문장 대신 구절을 세미콜론으로 연결한다. 현재 구현의 실제 golden 출력은 `frontend/tests/prompt-compiler.test.mjs`에서 검증한다. 위 예시는 기존 단순 문자열 스냅샷만으로 활용 동사 굴절·관사·문장 연결을 자동으로 보장하지 않는다. P2는 구현 가능한 결정적 규칙을 선택해 실제 golden 사례를 정의하고 누락·추가 없이 비교한다. **문법상 자연스러움을 위해 임의 의미를 만들어내지 않으며**, 불명확하거나 지원되지 않는 경우 구절을 나열하거나 미해결로 표시한다. 자유 한국어 입력은 번역된 것처럼 출력하지 않고 원문과 미변환 표시를 유지한다. 결과를 사용자가 수정·확정한다.

## 순서·충돌·가중치

- 기본 순서 후보: `subject → appearance → clothing → expression → pose/action → setting/location → camera/composition → lighting → style → mood`. 동순위는 사전 정의 순서 또는 안정 ID 순으로 고정하고 선택 순서와 무관한지 P2 계약에서 결정한다. 사용자가 직접 수정한 텍스트는 컴파일 때 덮어쓰지 않는다.
- 예시 경고: 전신과 클로즈업, 걷기와 서 있기, 미소와 진지한 표정, 실내와 거리. 문맥에 따라 함께 가능하므로 차단하지 않고 관련 ID를 표시하는 경고로 시작한다. 여러 인물·시간 차이가 있는 장면에선 오탐이 가능하다.
- 강조 값은 사전 표현 문자열에 `(tag:1.2)`처럼 삽입하지 않는다. 현재 Scene Specification에는 가중치 필드가 없으므로 **이번 확장에 가중치 기능을 추가하지 않는다**. 후속 설계에서 타입·스냅샷·모델별 적용 여부와 미지원 처리, 과거 이력 호환을 확정한 뒤 별도 구조화 값으로 저장한다. 어떤 문법도 SD1.5 이외 모델에 보편 적용하지 않는다.

## 출처·저작권·라이선스

- 본 샘플의 한국어 표현과 영어 문구는 이 프로젝트의 수작업 초안이다. [Danbooru 태그 가이드](https://safebooru.donmai.us/wiki_pages/howto%3Atag)는 분류 방식 참고로만 링크했으며, 위 10개 Studio 분류를 해당 사이트의 공식 taxonomy로 주장하지 않는다.
- Danbooru의 사이트 데이터·위키·이미지 사용 조건은 위 사이트의 소프트웨어 라이선스와 자동으로 같지 않다. 이번 계획에서 외부 데이터 라이선스나 재배포 권한은 확인되지 않았고, 외부 목록·위키 문장·이미지를 복사하거나 재배포하지 않는다. 추후 개별 자료를 가져오려면 정확한 출처 URL, 버전/접근일, 저작권자, 라이선스·적용 범위, 사용 및 재배포 근거와 수정 내역을 항목/자료별로 기록하고 불명확하면 사용하지 않는다.
- 프로젝트가 작성한 사전의 배포 라이선스는 저장소 라이선스 및 작성 권한을 확인해 명시한다. 현재 그것을 단정하지 않는다. 일반적인 짧은 단어가 출처와 무관하게 독점된다는 주장도 하지 않는다.

## 별도 작업과 완료 조건

| 작업 | 의존성 | 완료 조건 |
| --- | --- | --- |
| S0 샘플·계약 | P1, 이 문서 | 20개 초안·모델별 예상 결과·출처와 가중치/호환 쟁점을 문서화. 상태: 완료(계획만). |
| S1 사전 큐레이션 | S0 | **완료:** [후보 100개](PROMPT_SEED_S1_CATALOG.md), 출처 및 라이선스 조사 결과 기록. 프로젝트 배포 라이선스 미명시; 외부 배포 전 별도 결정. |
| S2 데이터 반영 | S1 | **완료:** 1.1.0·100개 반영. 기존 12개 전체 값과 1.0.0 스냅샷, 중복 ID·빈 매핑·누락·비활성 항목·별칭 검색을 단위 검증. 실제 화면과 GPU 품질은 S4. |
| S3 Compiler 연동 검증 | S2 + P2 | **완료:** compiler 1.1.0에서 10개 분류 출력·충돌 경고·미제공 매핑·미번역 원문·모델 변경·구 스냅샷을 단위 검증했다. |
| S4 UI 확인 및 품질 평가 | S2 + P3; GPU 평가는 별도 | 새·기존 카테고리 검색/선택 및 한글 별칭을 확인한다. 각 모델의 정확한 체크포인트·프롬프트·시드·엔진과 BC-250 결과를 기록하기 전 표현은 가설로 남긴다. 실기 실패/미실행이 P2·P3 구현 완료를 막지 않는다. **1.2.0 부분 완료:** MOSS 계열 표현 100/100 반영, 선택 칩·계열 적용률·중복/한도 경고 단위 검증. 브라우저 화면과 BC-250 품질은 미완료. |

P2/P3와 병행할 때는 사전 타입을 일방적으로 변경하지 않는다. 데이터 반영 전에 compiler 담당 변경과 category 표시 규칙을 통합 검토하고, 사전 확장 전의 1.0.0 데이터로도 P2/P3 테스트가 통과해야 한다. S1은 문서 큐레이션, S2는 사전 코드 반영을 완료했다. 모델별 품질은 아직 검증하지 않았다. S3에서 후보 충돌의 일부를 경고로 추가했으며 모든 의미 충돌을 판별한다고 보장하지 않는다.
