/**
 * Project-authored starting examples for the free-text field. They are plain text
 * the user can edit; picking one calls no LLM and no image generation. No user
 * prompt or log is collected as an example.
 */
export type SceneExample = { id: "daily" | "product" | "landscape"; title: string; text: string };

export const SCENE_EXAMPLES: SceneExample[] = [
  {
    id: "daily",
    title: "일상",
    text: "비 오는 밤, 편의점 앞에서 우산을 접으며 친구를 기다리는 사람. 네온 조명이 젖은 바닥에 반사된다.",
  },
  {
    id: "product",
    title: "제품",
    text: "흰 배경 위 유리병 제품, 부드러운 조명, 글자 없이. 제품이 화면 중앙에 놓여 있다.",
  },
  {
    id: "landscape",
    title: "풍경",
    text: "해 질 무렵 넓은 호수와 낮은 산, 잔잔한 수면. 사람은 없다.",
  },
];

/**
 * The example only fills an empty field silently. Anything already typed must be
 * confirmed by the caller, so an accidental click cannot destroy the user's text.
 */
export function exampleNeedsConfirm(current: string): boolean {
  return current.trim().length > 0;
}

/** Returns the next free text; an empty result means the caller cancelled. */
export function applyExample(current: string, example: SceneExample, confirmReplace: () => boolean): string | null {
  if (exampleNeedsConfirm(current) && !confirmReplace()) return null;
  return example.text;
}
