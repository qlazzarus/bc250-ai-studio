# S1 Seed 사전 후보 100개

상태: **S1 큐레이션 완료, S2에서 1.1.0에 반영**. 기준: [Seed 확장 계획](PROMPT_SEED_EXPANSION_PLAN.md). 모델별 표현은 작성 가설이며 이미지 품질이나 모델 실행·기능 지원을 뜻하지 않는다.

표의 SD는 SD 1.5용, 자연어 조각은 Z-Image와 FLUX.2 양쪽에 제안하는 동일 표현이다. 문장 연결은 P2의 실제 동작과 별개 후속 검토 사항이다. MOSS는 기존 12개만 1.0.0 표현을 보존하고 신규 88개는 미제공을 제안한다. Fake는 미제공이다. 각 항목의 미제공은 모델 미지원 판정이 아니다. *는 기존 ID이며 기존 category·라벨·별칭·모델별 mapping을 S2에서 그대로 유지한다. 표의 자연어 열은 후속 표현 검토 초안으로, 기존 스냅샷을 바꾸라는 지시가 아니다.

출처: 항목과 한국어 별칭·영어 문구는 이 저장소 작업의 수작업 초안. [Danbooru 태그 가이드](https://safebooru.donmai.us/wiki_pages/howto%3Atag)는 태그 분류 개념의 참고자료이며 태그 목록·위키 문장·이미지를 가져오지 않았다. 로컬 저장소에서 별도의 LICENSE/COPYING/NOTICE 파일을 찾지 못했다. 프로젝트 사전의 배포 라이선스는 미명시이며 임의로 부여하지 않는다. 외부 배포 또는 외부 자료 도입 전 권리와 조건을 결정한다. 외부 데이터의 라이선스·재배포 권한은 확인되지 않아 외부 자료를 복사하지 않는다.

각 행은 별칭을 쉼표로 구분한다. category 열의 기존 `action`/`location`/`composition`은 유지하고 그룹에서만 각각 포즈/장소/카메라로 묶는다.

## 대상 (8개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `subject.person` * | `subject` | 인물 | 사람 | `a person` | `a person` |
| `subject.portrait` * | `subject` | 인물 초상 | 초상화, 포트레이트 | `a portrait` | `a portrait` |
| `subject.two_people` | `subject` | 두 사람 | 두 명, 2인 | `two people` | `two people` |
| `subject.group` | `subject` | 사람들 | 여러 사람, 단체 | `a group of people` | `a group of people` |
| `subject.cat` | `subject` | 고양이 | 야옹이 | `a cat` | `a cat` |
| `subject.dog` | `subject` | 개 | 강아지 | `a dog` | `a dog` |
| `subject.tree` | `subject` | 나무 | 수목 | `a tree` | `a tree` |
| `subject.building` | `subject` | 건물 | 건축물 | `a building` | `a building` |

## 외형 (12개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `appearance.short_hair` | `appearance` | 짧은 머리 | 단발, 짧은 헤어 | `short hair` | `with short hair` |
| `appearance.long_hair` | `appearance` | 긴 머리 | 긴 헤어 | `long hair` | `with long hair` |
| `appearance.curly_hair` | `appearance` | 곱슬머리 | 컬, 곱슬 | `curly hair` | `with curly hair` |
| `appearance.straight_hair` | `appearance` | 생머리 | 직모 | `straight hair` | `with straight hair` |
| `appearance.black_hair` | `appearance` | 검은 머리 | 흑발 | `black hair` | `with black hair` |
| `appearance.brown_hair` | `appearance` | 갈색 머리 | 갈발 | `brown hair` | `with brown hair` |
| `appearance.blonde_hair` | `appearance` | 금발 | 금색 머리 | `blonde hair` | `with blonde hair` |
| `appearance.red_hair` | `appearance` | 붉은 머리 | 적발 | `red hair` | `with red hair` |
| `appearance.glasses` | `appearance` | 안경 | 안경 착용 | `glasses` | `wearing glasses` |
| `appearance.freckles` | `appearance` | 주근깨 | 얼굴 주근깨 | `freckles` | `with freckles` |
| `appearance.beard` | `appearance` | 수염 | 턱수염 | `beard` | `with a beard` |
| `appearance.ponytail` | `appearance` | 포니테일 | 묶은 머리, 말총머리 | `ponytail` | `with a ponytail` |

## 의상 (12개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `clothing.white_shirt` | `clothing` | 흰 셔츠 | 흰색 셔츠 | `white shirt` | `wearing a white shirt` |
| `clothing.black_shirt` | `clothing` | 검은 셔츠 | 검정 셔츠 | `black shirt` | `wearing a black shirt` |
| `clothing.t_shirt` | `clothing` | 티셔츠 | 티, 반팔 티 | `t-shirt` | `wearing a t-shirt` |
| `clothing.sweater` | `clothing` | 스웨터 | 니트, 풀오버 | `sweater` | `wearing a sweater` |
| `clothing.jacket` | `clothing` | 재킷 | 자켓 | `jacket` | `wearing a jacket` |
| `clothing.coat` | `clothing` | 코트 | 외투 | `coat` | `wearing a coat` |
| `clothing.dress` | `clothing` | 원피스 | 드레스 | `dress` | `wearing a dress` |
| `clothing.jeans` | `clothing` | 청바지 | 데님 바지 | `jeans` | `wearing jeans` |
| `clothing.trousers` | `clothing` | 바지 | 긴 바지 | `trousers` | `wearing trousers` |
| `clothing.skirt` | `clothing` | 치마 | 스커트 | `skirt` | `wearing a skirt` |
| `clothing.hat` | `clothing` | 모자 | 머리 모자 | `hat` | `wearing a hat` |
| `clothing.scarf` | `clothing` | 목도리 | 스카프 | `scarf` | `wearing a scarf` |

## 표정 (8개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `expression.smile` | `expression` | 미소 | 웃는 얼굴 | `smile` | `smiling` |
| `expression.serious` | `expression` | 진지한 표정 | 엄숙한 얼굴 | `serious expression` | `with a serious expression` |
| `expression.laughing` | `expression` | 웃음 | 소리 내어 웃기 | `laughing` | `laughing` |
| `expression.surprised` | `expression` | 놀란 표정 | 놀람 | `surprised expression` | `looking surprised` |
| `expression.sad` | `expression` | 슬픈 표정 | 슬픔 | `sad expression` | `looking sad` |
| `expression.neutral` | `expression` | 무표정 | 표정 없음 | `neutral expression` | `with a neutral expression` |
| `expression.eyes_closed` | `expression` | 감은 눈 | 눈 감기 | `eyes closed` | `with eyes closed` |
| `expression.looking_at_viewer` | `expression` | 정면 응시 | 카메라 보기 | `looking at viewer` | `looking toward the viewer` |

## 포즈·동작 (10개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `action.standing` * | `action` | 서 있기 | 서있는, 서다 | `standing` | `standing` |
| `action.walking` * | `action` | 걷기 | 걷는, 걸어가는 | `walking` | `walking` |
| `pose.sitting` | `pose` | 앉기 | 앉은 자세 | `sitting` | `sitting` |
| `pose.lying` | `pose` | 누워 있기 | 누운 자세 | `lying down` | `lying down` |
| `pose.running` | `pose` | 달리기 | 달리는 자세 | `running` | `running` |
| `pose.kneeling` | `pose` | 무릎 꿇기 | 무릎 꿇은 자세 | `kneeling` | `kneeling` |
| `pose.arms_crossed` | `pose` | 팔짱 | 팔짱 낀 자세 | `arms crossed` | `with arms crossed` |
| `pose.hands_in_pockets` | `pose` | 주머니에 손 | 손을 주머니에 | `hands in pockets` | `with hands in pockets` |
| `pose.waving` | `pose` | 손 흔들기 | 인사 | `waving` | `waving` |
| `pose.looking_back` | `pose` | 뒤돌아보기 | 고개 돌리기 | `looking back` | `looking back` |

## 장소·배경 (12개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `location.street` * | `location` | 거리 | 길거리, 도로 | `on a street` | `on a street` |
| `location.room` * | `location` | 실내 | 방, 실내 공간 | `indoors` | `indoors` |
| `setting.park` | `setting` | 공원 | 도시 공원 | `in a park` | `in a park` |
| `setting.forest` | `setting` | 숲 | 산림 | `in a forest` | `in a forest` |
| `setting.beach` | `setting` | 해변 | 바닷가, 모래사장 | `on a beach` | `on a beach` |
| `setting.mountain` | `setting` | 산 | 산지 | `in the mountains` | `in the mountains` |
| `setting.cafe` | `setting` | 카페 | 커피숍 | `in a cafe` | `in a cafe` |
| `setting.library` | `setting` | 도서관 | 서가 | `in a library` | `in a library` |
| `setting.garden` | `setting` | 정원 | 뜰 | `in a garden` | `in a garden` |
| `setting.rooftop` | `setting` | 옥상 | 건물 옥상 | `on a rooftop` | `on a rooftop` |
| `setting.train_station` | `setting` | 기차역 | 철도역, 역 | `at a train station` | `at a train station` |
| `setting.plain_background` | `setting` | 단색 배경 | 무지 배경 | `plain background` | `against a plain background` |

## 카메라·구도 (10개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `composition.full_body` * | `composition` | 전신 | 전신샷 | `full body` | `full body` |
| `composition.close_up` * | `composition` | 클로즈업 | 근접, 가까이 | `close-up` | `close-up` |
| `camera.medium_shot` | `camera` | 미디엄 샷 | 중간 거리 구도 | `medium shot` | `in a medium shot` |
| `camera.wide_shot` | `camera` | 와이드 샷 | 넓은 구도 | `wide shot` | `in a wide shot` |
| `camera.profile` | `camera` | 측면 | 옆모습, 측면 구도 | `side view` | `seen from the side` |
| `camera.front_view` | `camera` | 정면 | 정면 구도 | `front view` | `seen from the front` |
| `camera.back_view` | `camera` | 후면 | 뒷모습, 뒤에서 | `back view` | `seen from behind` |
| `camera.high_angle` | `camera` | 하이 앵글 | 위에서 내려다보기 | `high angle` | `seen from above` |
| `camera.low_angle` | `camera` | 로우 앵글 | 아래에서 올려다보기 | `low angle` | `seen from below` |
| `camera.eye_level` | `camera` | 눈높이 구도 | 아이레벨 | `eye-level view` | `seen at eye level` |

## 조명 (10개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `lighting.soft` * | `lighting` | 부드러운 조명 | 은은한 빛 | `soft lighting` | `soft lighting` |
| `lighting.neon` * | `lighting` | 네온 조명 | 네온, 네온사인 | `neon lighting` | `neon lighting` |
| `lighting.sunlight` | `lighting` | 햇빛 | 태양광, 자연광 | `sunlight` | `in sunlight` |
| `lighting.window_light` | `lighting` | 창문 빛 | 창가 빛 | `window light` | `lit by window light` |
| `lighting.backlight` | `lighting` | 역광 | 뒤에서 비추는 빛 | `backlighting` | `backlit` |
| `lighting.rim_light` | `lighting` | 림 라이트 | 테두리 조명 | `rim lighting` | `with rim lighting` |
| `lighting.golden_hour` | `lighting` | 골든 아워 | 해 질 녘 빛 | `golden hour lighting` | `in golden hour light` |
| `lighting.overcast` | `lighting` | 흐린 날 빛 | 구름 낀 조명 | `overcast lighting` | `in overcast light` |
| `lighting.candlelight` | `lighting` | 촛불 | 촛불 조명 | `candlelight` | `lit by candlelight` |
| `lighting.low_key` | `lighting` | 어두운 조명 | 로우키 조명 | `low-key lighting` | `in low-key lighting` |

## 스타일 (10개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `style.photographic` * | `style` | 사진 스타일 | 사진, 포토리얼 | `photographic style` | `photographic style` |
| `style.illustration` * | `style` | 일러스트 | 그림, 삽화 | `illustration style` | `illustration style` |
| `style.watercolor` | `style` | 수채화 | 수채화풍 | `watercolor painting` | `in a watercolor style` |
| `style.oil_painting` | `style` | 유화 | 유화풍 | `oil painting` | `in an oil painting style` |
| `style.pencil_sketch` | `style` | 연필 스케치 | 연필화 | `pencil sketch` | `in a pencil sketch style` |
| `style.ink_drawing` | `style` | 잉크 드로잉 | 펜화 | `ink drawing` | `in an ink drawing style` |
| `style.pixel_art` | `style` | 픽셀 아트 | 도트 그림 | `pixel art` | `in a pixel art style` |
| `style.comic` | `style` | 만화 | 코믹 스타일 | `comic style` | `in a comic style` |
| `style.3d_render` | `style` | 3D 렌더 | 3D 렌더링 | `3d render` | `in a 3D rendered style` |
| `style.black_and_white` | `style` | 흑백 | 모노크롬, 흑백 사진 | `black and white` | `in black and white` |

## 분위기 (8개)

| ID | category | 한국어 표시명 | 검색 별칭 | SD 1.5 | Z-Image / FLUX.2 |
| --- | --- | --- | --- | --- | --- |
| `mood.calm` | `mood` | 차분한 분위기 | 고요한 | `calm mood` | `with a calm mood` |
| `mood.tense` | `mood` | 긴장된 분위기 | 긴장감 | `tense mood` | `with a tense mood` |
| `mood.cheerful` | `mood` | 밝은 분위기 | 명랑한 | `cheerful mood` | `with a cheerful mood` |
| `mood.melancholic` | `mood` | 우울한 분위기 | 쓸쓸한 | `melancholic mood` | `with a melancholic mood` |
| `mood.mysterious` | `mood` | 신비로운 분위기 | 미스터리 | `mysterious mood` | `with a mysterious mood` |
| `mood.cozy` | `mood` | 포근한 분위기 | 아늑한 | `cozy mood` | `with a cozy mood` |
| `mood.dramatic` | `mood` | 극적인 분위기 | 드라마틱 | `dramatic mood` | `with a dramatic mood` |
| `mood.dreamy` | `mood` | 몽환적인 분위기 | 꿈같은 | `dreamy mood` | `with a dreamy mood` |

## 충돌·중복 검토와 다음 단계

- 상충 경고 후보: 짧은 머리/긴 머리, 검은 머리/금발 등 동일 속성의 다른 값; 웃음/슬픈 표정; 앉기/서 있기; 실내/거리; 정면/후면; 위/아래 시점; 전신/클로즈업. 복수 인물·시간·혼합 스타일에서는 함께 가능하므로 무조건 차단하지 않는다. S3에서 대표 조합을 경고로 추가했다. 모든 가능한 조합을 판별하지는 않는다.
- 유사 개념은 구분: 인물과 인물 초상, 거리와 옥상, 전신과 와이드 샷, 사진 스타일과 흑백. 흑백과 사진은 함께 선택 가능하다. `긴 머리`와 `포니테일`, `셔츠`와 `재킷`도 동시 선택 가능하다.
- 프롬프트 가중치는 항목 문자열에 넣지 않는다. 현재 P2의 정렬·미변환 처리와 계약을 지키며 문장화는 검토 후 별도 변경한다. S2에서 중복 ID·빈 매핑·별칭 검색·기존 ID 및 스냅샷 보존을 검증한다.
- GPU 검증은 모델·체크포인트·엔진·시드·입력 조합별로 따로 기록한다. 결과가 나오기 전 본 표의 어떤 표현도 Verified로 표시하지 않는다.
