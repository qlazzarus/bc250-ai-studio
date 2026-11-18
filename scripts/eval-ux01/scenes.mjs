/**
 * EVAL-UX01 fixtures: twelve hand-written Korean scenes.
 *
 * Two rules this file follows, because they decide whether the numbers mean
 * anything:
 *
 * 1. `textKo` is project-authored. No user prompt and no log is reused.
 * 2. `expected` / `forbid` / `unmatchedKo` were written by reading the sentence,
 *    not by running `suggestSelections` and copying its answer. A rule miss is a
 *    finding to report, not a reason to edit the expectation.
 *
 * `forbid` is the "원치 않는 추가" truth set: an ID that would actively contradict
 * the text if the rules proposed it (the negation scenes exist for this, since the
 * matcher is a plain substring test and cannot see "사람은 없다").
 *
 * `startIds` is only used by the one partial-edit scene, so `partialScope()` has a
 * real selection to lock.
 *
 * `negated: true` marks a scene whose text says a subject is *absent*. It is set by
 * hand because inferring it from words like "없다" would also catch "글자 없이",
 * which is a different kind of condition, not an absent subject.
 */

export const FAMILY = "sd15";

/** The UI protocol the click counts are derived from. Stated once, not per scene. */
export const PROTOCOL = {
  rule: [
    "원문 입력 1회",
    "`원문에서 사전 항목 찾기` 1회",
    "기대에 맞는 제안마다 `선택에 추가` 1회",
    "원치 않는 제안마다 칩 `×` 1회",
    "빠진 항목마다 `세부 조정` 1회 + 분류 1회 + 체크 1회",
  ],
  variant: [
    "원문 입력 1회",
    "`장소와 행동만 바꾼 상황 3개` 1회",
    "쓸 수 있는 후보에 `적용` 1회",
  ],
  /** Not counted for the rule path: the draft renders automatically (UX03). */
  draft: "자동 미리보기 · 별도 클릭 없음",
};

export const SCENES = [
  {
    id: "daily-rain-store",
    title: "일상 · 비 오는 밤",
    kind: "common",
    textKo: "비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람. 네온 조명이 젖은 바닥에 반사된다.",
    expected: [
      { id: "subject.person", why: "“사람”이 장면의 대상" },
      { id: "lighting.neon", why: "“네온 조명” 그대로" },
    ],
    forbid: [],
    unmatchedKo: [
      { text: "비 오는 밤", why: "날씨·시간 항목이 사전에 없음" },
      { text: "편의점", why: "장소 어휘 없음" },
      { text: "우산을 접으며", why: "소품·동작 어휘 없음" },
      { text: "친구를 기다리는", why: "관계·행동 어휘 없음" },
    ],
    notes: "공통 예시(SCENE_EXAMPLES.daily)와 같은 원문. 규칙 경로의 기준선.",
  },
  {
    id: "product-bottle",
    title: "제품 · 유리병",
    kind: "product",
    textKo: "흰 배경 위 유리병 제품, 부드러운 조명, 글자 없이. 제품이 화면 중앙에 놓여 있다.",
    expected: [
      { id: "lighting.soft", why: "“부드러운 조명” 그대로" },
      { id: "setting.plain_background", why: "“흰 배경”은 단색 배경" },
    ],
    forbid: [{ id: "subject.person", why: "사람이 없는 제품 사진" }],
    unmatchedKo: [
      { text: "유리병 제품", why: "제품·재질 어휘 없음" },
      { text: "화면 중앙에 놓여", why: "배치 어휘 없음" },
      { text: "글자 없이", why: "부정 조건을 표현할 필드가 없음" },
    ],
    notes: "‘글자 없이’는 부정 조건인데 이를 담을 자리가 없다. 원문은 그대로 보존된다.",
  },
  {
    id: "landscape-lake-dusk",
    title: "풍경 · 호수와 산",
    kind: "landscape",
    negated: true,
    textKo: "해 질 무렵 넓은 호수와 낮은 산, 잔잔한 수면. 사람은 없다.",
    expected: [
      { id: "setting.mountain", why: "“낮은 산”" },
      { id: "lighting.golden_hour", why: "“해 질 무렵”은 골든 아워" },
    ],
    forbid: [{ id: "subject.person", why: "“사람은 없다”고 명시" }],
    unmatchedKo: [
      { text: "호수", why: "수면 어휘 없음" },
      { text: "잔잔한 수면", why: "수면 상태 어휘 없음" },
    ],
    notes: "부정 장면. ‘사람은 없다’에 ‘사람’이 들어 있어 부분일치가 대상 인물을 제안하면 오탐이다.",
  },
  {
    id: "multi-person-street",
    title: "다인 · 두 사람이 걷는 거리",
    kind: "multi_person",
    textKo: "두 명의 여성이 길거리에서 웃으며 걷는다.",
    expected: [
      { id: "subject.two_people", why: "“두 명”" },
      { id: "action.walking", why: "“걷는다”" },
      { id: "location.street", why: "“길거리”" },
      { id: "expression.smile", why: "“웃으며”" },
    ],
    forbid: [],
    unmatchedKo: [{ text: "여성", why: "성별·연령 항목 없음" }],
    notes: "다인 장면. 어느 인물의 속성인지 구분하는 필드가 없다는 한계가 여기서 드러난다.",
  },
  {
    id: "negation-empty-beach",
    title: "부정 · 텅 빈 해변",
    kind: "negation",
    negated: true,
    textKo: "텅 빈 해변, 파도만 보인다. 사람이나 동물은 전혀 없다.",
    expected: [{ id: "setting.beach", why: "“해변” 그대로" }],
    forbid: [{ id: "subject.person", why: "“사람”이 없다고 명시" }],
    unmatchedKo: [
      { text: "파도", why: "해양 어휘 없음" },
      { text: "텅 빈", why: "비어 있음 상태 어휘 없음" },
      { text: "동물", why: "동물 상위어 항목 없음" },
    ],
    notes: "두 번째 부정 장면. 해변 하나만 남고 대상은 0개여야 한다.",
  },
  {
    id: "partial-lighting-only",
    title: "부분 수정 · 조명만",
    kind: "partial",
    textKo: "같은 인물, 같은 옷. 카페 창가, 어두운 조명. 조명만 바꿔 본다.",
    startIds: ["subject.person", "clothing.white_shirt"],
    /** The same two entries as `startIds`, by Korean label, for the browser arm. */
    startLabels: ["인물", "흰 셔츠"],
    request: { targetGroups: ["lighting"] },
    expected: [
      { id: "setting.cafe", why: "“카페” 그대로" },
      { id: "lighting.window_light", why: "“창가”는 창문 빛" },
      { id: "lighting.low_key", why: "“어두운 조명” 그대로" },
    ],
    forbid: [],
    unmatchedKo: [
      { text: "같은 옷", why: "이미 고른 값을 가리키는 지시문" },
      { text: "조명만 바꿔", why: "요청 범위를 말하는 지시문" },
    ],
    notes: "부분 변경 기준선. 잠긴 값은 인물·흰 셔츠 2개, 바꿀 수 있는 그룹은 조명뿐이다. " +
      "‘카페’는 원문에 있지만 요청 범위 밖이므로 추가되면 안 된다.",
  },
  {
    id: "portrait-front-closeup",
    title: "인물 초상 · 정면 클로즈업",
    kind: "portrait",
    textKo: "정면을 바라보는 인물 초상, 무표정, 짧은 머리. 클로즈업.",
    expected: [
      { id: "subject.portrait", why: "“인물 초상”" },
      { id: "camera.front_view", why: "“정면”" },
      { id: "expression.neutral", why: "“무표정”" },
      { id: "appearance.short_hair", why: "“짧은 머리”" },
      { id: "composition.close_up", why: "“클로즈업”" },
    ],
    forbid: [],
    unmatchedKo: [],
    notes: "여섯 항목 중 다섯이 사전에 있다. 사전 커버리지가 좋은 경우의 상한을 보여 준다.",
  },
  {
    id: "alley-neon-coat",
    title: "거리 · 네온 골목",
    kind: "street",
    textKo: "네온사인이 비치는 좁은 골목, 검은 코트를 입은 사람이 서 있다.",
    expected: [
      { id: "lighting.neon", why: "“네온사인”" },
      { id: "clothing.coat", why: "“코트”" },
      { id: "subject.person", why: "“사람”" },
      { id: "action.standing", why: "“서 있다”" },
    ],
    forbid: [],
    unmatchedKo: [
      { text: "골목", why: "골목 어휘 없음" },
      { text: "좁은", why: "공간감 어휘 없음" },
    ],
    notes: "‘서 있다’와 ‘서다/서있는’의 표기 차이가 드러나는 장면.",
  },
  {
    id: "cat-window-cozy",
    title: "고양이 · 창가",
    kind: "subject",
    textKo: "창가에 앉은 고양이, 포근한 담요. 오후의 은은한 빛.",
    expected: [
      { id: "subject.cat", why: "“고양이”" },
      { id: "pose.sitting", why: "“앉은”" },
      { id: "mood.cozy", why: "“포근한”" },
      { id: "lighting.soft", why: "“은은한 빛”" },
    ],
    forbid: [],
    unmatchedKo: [
      { text: "담요", why: "소품 어휘 없음" },
      { text: "오후", why: "시간대 어휘 없음" },
    ],
    notes: "‘포근한 담요’는 분위기가 아니라 소품이지만 사전은 분위기 표현만 안다.",
  },
  {
    id: "group-hiking",
    title: "다인 · 산에 오르는 사람들",
    kind: "multi_person",
    textKo: "친구들과 함께 산에 오르는 사람들, 맑은 날.",
    expected: [
      { id: "subject.group", why: "“사람들”" },
      { id: "setting.mountain", why: "“산에”" },
    ],
    forbid: [{ id: "subject.person", why: "여러 사람을 단수 인물로 줄이면 안 됨" }],
    unmatchedKo: [
      { text: "친구들과 함께", why: "관계 어휘 없음" },
      { text: "오르는", why: "등산 동작 어휘 없음" },
      { text: "맑은 날", why: "날씨 어휘 없음" },
    ],
    notes: "‘산’은 한 글자라 사전 매칭 최소 길이(2)에 걸린다. ‘사람들’도 단수 인물과 겹친다.",
  },
  {
    id: "beach-sunset-couple",
    title: "해변 · 노을 역광",
    kind: "landscape",
    textKo: "해변에서 노을을 바라보는 두 사람, 역광.",
    expected: [
      { id: "setting.beach", why: "“해변에서”" },
      { id: "subject.two_people", why: "“두 사람”" },
      { id: "lighting.backlight", why: "“역광”" },
    ],
    forbid: [],
    unmatchedKo: [{ text: "노을", why: "일몰 색채 어휘 없음" }],
    notes: "세 항목 모두 사전에 있는 짧은 장면. 클릭 수 하한을 보여 준다.",
  },
  {
    id: "studio-bw-portrait",
    title: "스튜디오 · 흑백 인물",
    kind: "style",
    textKo: "단색 배경 앞 흑백 인물 사진, 로우 앵글, 미소.",
    expected: [
      { id: "setting.plain_background", why: "“단색 배경”" },
      { id: "style.black_and_white", why: "“흑백”" },
      { id: "subject.person", why: "“인물”" },
      { id: "style.photographic", why: "“사진”" },
      { id: "camera.low_angle", why: "“로우 앵글”" },
      { id: "expression.smile", why: "“미소”" },
    ],
    forbid: [],
    unmatchedKo: [],
    notes: "스타일·구도·표정이 한 문장에 모인 경우. 여섯 항목 모두 사전에 있다.",
  },
];