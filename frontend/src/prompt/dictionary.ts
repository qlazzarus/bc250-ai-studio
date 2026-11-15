/** Operator-maintained seed vocabulary. Expressions are proposals, not quality claims. */
export const DICTIONARY_VERSION = "1.1.0";
export const MODEL_FAMILIES = ["sd15", "z-image", "flux2", "moss-image", "fake"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];
export type Mapping = { status: "mapped"; text: string } | { status: "unavailable" };
export type DictionaryEntry = {
  id: string;
  category: string;
  labelKo: string;
  aliases: string[];
  active: boolean;
  mappings: Record<ModelFamily, Mapping>;
};

const mapped = (text: string): Mapping => ({ status: "mapped", text });
const legacyEntries = [
  ["subject.person", "subject", "인물", ["사람"], "a person"],
  ["subject.portrait", "subject", "인물 초상", ["초상화", "포트레이트"], "a portrait"],
  ["action.standing", "action", "서 있기", ["서있는", "서다"], "standing"],
  ["action.walking", "action", "걷기", ["걷는", "걸어가는"], "walking"],
  ["location.street", "location", "거리", ["길거리", "도로"], "on a street"],
  ["location.room", "location", "실내", ["방", "실내 공간"], "indoors"],
  ["composition.full_body", "composition", "전신", ["전신샷"], "full body"],
  ["composition.close_up", "composition", "클로즈업", ["근접", "가까이"], "close-up"],
  ["lighting.soft", "lighting", "부드러운 조명", ["은은한 빛"], "soft lighting"],
  ["lighting.neon", "lighting", "네온 조명", ["네온", "네온사인"], "neon lighting"],
  ["style.photographic", "style", "사진 스타일", ["사진", "포토리얼"], "photographic style"],
  ["style.illustration", "style", "일러스트", ["그림", "삽화"], "illustration style"],
] as const;

// S1 hand-curated additions; expressions are unverified hypotheses.
const expandedEntries = [
  ["subject.two_people", "subject", "두 사람", ["두 명", "2인"], "two people", "two people"],
  ["subject.group", "subject", "사람들", ["여러 사람", "단체"], "a group of people", "a group of people"],
  ["subject.cat", "subject", "고양이", ["야옹이"], "a cat", "a cat"],
  ["subject.dog", "subject", "개", ["강아지"], "a dog", "a dog"],
  ["subject.tree", "subject", "나무", ["수목"], "a tree", "a tree"],
  ["subject.building", "subject", "건물", ["건축물"], "a building", "a building"],
  ["appearance.short_hair", "appearance", "짧은 머리", ["단발", "짧은 헤어"], "short hair", "with short hair"],
  ["appearance.long_hair", "appearance", "긴 머리", ["긴 헤어"], "long hair", "with long hair"],
  ["appearance.curly_hair", "appearance", "곱슬머리", ["컬", "곱슬"], "curly hair", "with curly hair"],
  ["appearance.straight_hair", "appearance", "생머리", ["직모"], "straight hair", "with straight hair"],
  ["appearance.black_hair", "appearance", "검은 머리", ["흑발"], "black hair", "with black hair"],
  ["appearance.brown_hair", "appearance", "갈색 머리", ["갈발"], "brown hair", "with brown hair"],
  ["appearance.blonde_hair", "appearance", "금발", ["금색 머리"], "blonde hair", "with blonde hair"],
  ["appearance.red_hair", "appearance", "붉은 머리", ["적발"], "red hair", "with red hair"],
  ["appearance.glasses", "appearance", "안경", ["안경 착용"], "glasses", "wearing glasses"],
  ["appearance.freckles", "appearance", "주근깨", ["얼굴 주근깨"], "freckles", "with freckles"],
  ["appearance.beard", "appearance", "수염", ["턱수염"], "beard", "with a beard"],
  ["appearance.ponytail", "appearance", "포니테일", ["묶은 머리", "말총머리"], "ponytail", "with a ponytail"],
  ["clothing.white_shirt", "clothing", "흰 셔츠", ["흰색 셔츠"], "white shirt", "wearing a white shirt"],
  ["clothing.black_shirt", "clothing", "검은 셔츠", ["검정 셔츠"], "black shirt", "wearing a black shirt"],
  ["clothing.t_shirt", "clothing", "티셔츠", ["티", "반팔 티"], "t-shirt", "wearing a t-shirt"],
  ["clothing.sweater", "clothing", "스웨터", ["니트", "풀오버"], "sweater", "wearing a sweater"],
  ["clothing.jacket", "clothing", "재킷", ["자켓"], "jacket", "wearing a jacket"],
  ["clothing.coat", "clothing", "코트", ["외투"], "coat", "wearing a coat"],
  ["clothing.dress", "clothing", "원피스", ["드레스"], "dress", "wearing a dress"],
  ["clothing.jeans", "clothing", "청바지", ["데님 바지"], "jeans", "wearing jeans"],
  ["clothing.trousers", "clothing", "바지", ["긴 바지"], "trousers", "wearing trousers"],
  ["clothing.skirt", "clothing", "치마", ["스커트"], "skirt", "wearing a skirt"],
  ["clothing.hat", "clothing", "모자", ["머리 모자"], "hat", "wearing a hat"],
  ["clothing.scarf", "clothing", "목도리", ["스카프"], "scarf", "wearing a scarf"],
  ["expression.smile", "expression", "미소", ["웃는 얼굴"], "smile", "smiling"],
  ["expression.serious", "expression", "진지한 표정", ["엄숙한 얼굴"], "serious expression", "with a serious expression"],
  ["expression.laughing", "expression", "웃음", ["소리 내어 웃기"], "laughing", "laughing"],
  ["expression.surprised", "expression", "놀란 표정", ["놀람"], "surprised expression", "looking surprised"],
  ["expression.sad", "expression", "슬픈 표정", ["슬픔"], "sad expression", "looking sad"],
  ["expression.neutral", "expression", "무표정", ["표정 없음"], "neutral expression", "with a neutral expression"],
  ["expression.eyes_closed", "expression", "감은 눈", ["눈 감기"], "eyes closed", "with eyes closed"],
  ["expression.looking_at_viewer", "expression", "정면 응시", ["카메라 보기"], "looking at viewer", "looking toward the viewer"],
  ["pose.sitting", "pose", "앉기", ["앉은 자세"], "sitting", "sitting"],
  ["pose.lying", "pose", "누워 있기", ["누운 자세"], "lying down", "lying down"],
  ["pose.running", "pose", "달리기", ["달리는 자세"], "running", "running"],
  ["pose.kneeling", "pose", "무릎 꿇기", ["무릎 꿇은 자세"], "kneeling", "kneeling"],
  ["pose.arms_crossed", "pose", "팔짱", ["팔짱 낀 자세"], "arms crossed", "with arms crossed"],
  ["pose.hands_in_pockets", "pose", "주머니에 손", ["손을 주머니에"], "hands in pockets", "with hands in pockets"],
  ["pose.waving", "pose", "손 흔들기", ["인사"], "waving", "waving"],
  ["pose.looking_back", "pose", "뒤돌아보기", ["고개 돌리기"], "looking back", "looking back"],
  ["setting.park", "setting", "공원", ["도시 공원"], "in a park", "in a park"],
  ["setting.forest", "setting", "숲", ["산림"], "in a forest", "in a forest"],
  ["setting.beach", "setting", "해변", ["바닷가", "모래사장"], "on a beach", "on a beach"],
  ["setting.mountain", "setting", "산", ["산지"], "in the mountains", "in the mountains"],
  ["setting.cafe", "setting", "카페", ["커피숍"], "in a cafe", "in a cafe"],
  ["setting.library", "setting", "도서관", ["서가"], "in a library", "in a library"],
  ["setting.garden", "setting", "정원", ["뜰"], "in a garden", "in a garden"],
  ["setting.rooftop", "setting", "옥상", ["건물 옥상"], "on a rooftop", "on a rooftop"],
  ["setting.train_station", "setting", "기차역", ["철도역", "역"], "at a train station", "at a train station"],
  ["setting.plain_background", "setting", "단색 배경", ["무지 배경"], "plain background", "against a plain background"],
  ["camera.medium_shot", "camera", "미디엄 샷", ["중간 거리 구도"], "medium shot", "in a medium shot"],
  ["camera.wide_shot", "camera", "와이드 샷", ["넓은 구도"], "wide shot", "in a wide shot"],
  ["camera.profile", "camera", "측면", ["옆모습", "측면 구도"], "side view", "seen from the side"],
  ["camera.front_view", "camera", "정면", ["정면 구도"], "front view", "seen from the front"],
  ["camera.back_view", "camera", "후면", ["뒷모습", "뒤에서"], "back view", "seen from behind"],
  ["camera.high_angle", "camera", "하이 앵글", ["위에서 내려다보기"], "high angle", "seen from above"],
  ["camera.low_angle", "camera", "로우 앵글", ["아래에서 올려다보기"], "low angle", "seen from below"],
  ["camera.eye_level", "camera", "눈높이 구도", ["아이레벨"], "eye-level view", "seen at eye level"],
  ["lighting.sunlight", "lighting", "햇빛", ["태양광", "자연광"], "sunlight", "in sunlight"],
  ["lighting.window_light", "lighting", "창문 빛", ["창가 빛"], "window light", "lit by window light"],
  ["lighting.backlight", "lighting", "역광", ["뒤에서 비추는 빛"], "backlighting", "backlit"],
  ["lighting.rim_light", "lighting", "림 라이트", ["테두리 조명"], "rim lighting", "with rim lighting"],
  ["lighting.golden_hour", "lighting", "골든 아워", ["해 질 녘 빛"], "golden hour lighting", "in golden hour light"],
  ["lighting.overcast", "lighting", "흐린 날 빛", ["구름 낀 조명"], "overcast lighting", "in overcast light"],
  ["lighting.candlelight", "lighting", "촛불", ["촛불 조명"], "candlelight", "lit by candlelight"],
  ["lighting.low_key", "lighting", "어두운 조명", ["로우키 조명"], "low-key lighting", "in low-key lighting"],
  ["style.watercolor", "style", "수채화", ["수채화풍"], "watercolor painting", "in a watercolor style"],
  ["style.oil_painting", "style", "유화", ["유화풍"], "oil painting", "in an oil painting style"],
  ["style.pencil_sketch", "style", "연필 스케치", ["연필화"], "pencil sketch", "in a pencil sketch style"],
  ["style.ink_drawing", "style", "잉크 드로잉", ["펜화"], "ink drawing", "in an ink drawing style"],
  ["style.pixel_art", "style", "픽셀 아트", ["도트 그림"], "pixel art", "in a pixel art style"],
  ["style.comic", "style", "만화", ["코믹 스타일"], "comic style", "in a comic style"],
  ["style.3d_render", "style", "3D 렌더", ["3D 렌더링"], "3d render", "in a 3D rendered style"],
  ["style.black_and_white", "style", "흑백", ["모노크롬", "흑백 사진"], "black and white", "in black and white"],
  ["mood.calm", "mood", "차분한 분위기", ["고요한"], "calm mood", "with a calm mood"],
  ["mood.tense", "mood", "긴장된 분위기", ["긴장감"], "tense mood", "with a tense mood"],
  ["mood.cheerful", "mood", "밝은 분위기", ["명랑한"], "cheerful mood", "with a cheerful mood"],
  ["mood.melancholic", "mood", "우울한 분위기", ["쓸쓸한"], "melancholic mood", "with a melancholic mood"],
  ["mood.mysterious", "mood", "신비로운 분위기", ["미스터리"], "mysterious mood", "with a mysterious mood"],
  ["mood.cozy", "mood", "포근한 분위기", ["아늑한"], "cozy mood", "with a cozy mood"],
  ["mood.dramatic", "mood", "극적인 분위기", ["드라마틱"], "dramatic mood", "with a dramatic mood"],
  ["mood.dreamy", "mood", "몽환적인 분위기", ["꿈같은"], "dreamy mood", "with a dreamy mood"],
] as const;

const unavailable = (): Mapping => ({ status: "unavailable" });
export const DICTIONARY: DictionaryEntry[] = [
  ...legacyEntries.map(([id, category, labelKo, aliases, text]) => ({
    id, category, labelKo, aliases: [...aliases], active: true,
    mappings: { sd15: mapped(text), "z-image": mapped(text), flux2: mapped(text),
      "moss-image": mapped(text), fake: unavailable() },
  })),
  ...expandedEntries.map(([id, category, labelKo, aliases, sd, natural]) => ({
    id, category, labelKo, aliases: [...aliases], active: true,
    mappings: { sd15: mapped(sd), "z-image": mapped(natural), flux2: mapped(natural),
      "moss-image": unavailable(), fake: unavailable() },
  })),
];

/** Call before publishing/loading an operator dictionary. */
export function validateDictionary(dictionary: DictionaryEntry[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of dictionary) {
    if (!entry.id.trim() || ids.has(entry.id)) errors.push(`Invalid or duplicate ID: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.category.trim() || !entry.labelKo.trim()) errors.push(`Missing category or label: ${entry.id}`);
    for (const family of MODEL_FAMILIES) {
      const mapping = entry.mappings?.[family];
      if (!mapping || (mapping.status !== "mapped" && mapping.status !== "unavailable") ||
          (mapping.status === "mapped" && !mapping.text.trim())) {
        errors.push(`Invalid mapping: ${entry.id}/${family}`);
      }
    }
  }
  return errors;
}

export function searchDictionary(dictionary: DictionaryEntry[], query: string): DictionaryEntry[] {
  const normalized = query.trim().toLocaleLowerCase("ko");
  return dictionary.filter((entry) => entry.active && (!normalized ||
    [entry.labelKo, ...entry.aliases, entry.id].some((value) => value.toLocaleLowerCase("ko").includes(normalized))));
}

const dictionaryErrors = validateDictionary(DICTIONARY);
if (dictionaryErrors.length) throw new Error(`Invalid prompt dictionary: ${dictionaryErrors.join("; ")}`);
