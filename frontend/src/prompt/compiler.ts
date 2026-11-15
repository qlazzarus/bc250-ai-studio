import type { SceneSpecification, SelectionSnapshot } from "./scene";

export const COMPILER_VERSION = "1.3.0";

/** Server-side caps from backend/app/models/schemas.py; keep the client in sync. */
export const DRAFT_LIMIT = 8000;
export const SELECTION_LIMIT = 100;
/** SD 1.5 text encoders use a 77-token window; beyond it the tail is ignored. */
export const SD15_TOKEN_WINDOW = 77;

type Source = { id: string; labelKo: string; dictionaryVersion: string; text: string };
type Warning = {
  code: "conflict" | "duplicate" | "duplicate_phrase" | "unsupported_family" | "empty"
    | "over_limit" | "token_budget";
  ids: string[];
  detail?: string;
};
export type CompileResult = {
  compilerVersion: string;
  targetFamily: string;
  draft: string;
  sources: Source[];
  unresolved: { kind: "selection" | "free_text"; id?: string | null; text: string }[];
  warnings: Warning[];
};

const categories = ["subject", "appearance", "clothing", "expression", "pose", "setting", "camera", "lighting", "style", "mood"];
const categoryAliases: Record<string, string> = { action: "pose", location: "setting", composition: "camera" };
const conflictPairs: [string, string][] = [
  ["composition.full_body", "composition.close_up"],
  ["action.standing", "action.walking"],
  ["location.room", "location.street"],
  ["style.photographic", "style.illustration"],
  ["expression.smile", "expression.serious"],
  ["mood.calm", "mood.tense"],
  ["appearance.short_hair", "appearance.long_hair"],
  ["appearance.curly_hair", "appearance.straight_hair"],
  ["expression.laughing", "expression.sad"],
  ["action.standing", "pose.sitting"],
  ["camera.front_view", "camera.back_view"],
  ["camera.high_angle", "camera.low_angle"],
];
const exclusiveGroups = [
  ["appearance.black_hair", "appearance.brown_hair", "appearance.blonde_hair", "appearance.red_hair"],
];
/** Families whose text encoder is natural-language oriented rather than tag oriented. */
const naturalLanguageFamilies = ["z-image", "flux2", "moss-image"];
const knownFamilies = ["sd15", ...naturalLanguageFamilies];

function order(selection: SelectionSnapshot): number {
  const category = categoryAliases[selection.category] ?? selection.category;
  const index = categories.indexOf(category);
  return index < 0 ? categories.length : index;
}

/** Approximation only: CLIP-style word pieces are roughly this long. */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/[\s,;]+/).filter(Boolean).length * 1.3);
}

/** Pure compilation of frozen selection values. Free text is returned unresolved. */
export function compileScene(scene: SceneSpecification): CompileResult {
  const result: CompileResult = {
    compilerVersion: COMPILER_VERSION, targetFamily: scene.targetFamily, draft: "",
    sources: [], unresolved: [], warnings: [],
  };
  const knownFamily = knownFamilies.includes(scene.targetFamily);
  if (!knownFamily) result.warnings.push({ code: "unsupported_family", ids: [] });
  const sorted = [...scene.selections].sort((a, b) => order(a) - order(b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  for (const item of sorted) {
    if (seen.has(item.id)) {
      result.warnings.push({ code: "duplicate", ids: [item.id] });
      continue;
    }
    seen.add(item.id);
    if (!knownFamily || item.mapping.status !== "mapped" || !item.mapping.text.trim()) {
      result.unresolved.push({ kind: "selection", id: item.id, text: item.labelKo });
      continue;
    }
    result.sources.push({ id: item.id, labelKo: item.labelKo, dictionaryVersion: item.dictionaryVersion, text: item.mapping.text.trim() });
  }
  for (const [left, right] of conflictPairs) {
    if (seen.has(left) && seen.has(right)) result.warnings.push({ code: "conflict", ids: [left, right] });
  }
  for (const group of exclusiveGroups) {
    const ids = group.filter((id) => seen.has(id));
    if (ids.length > 1) result.warnings.push({ code: "conflict", ids });
  }
  // Distinct IDs can freeze the same rendered phrase. Emitting it twice spends
  // tokens without adding meaning, so the duplicate is reported and dropped.
  const byPhrase = new Map<string, string[]>();
  for (const source of result.sources) {
    const key = source.text.toLocaleLowerCase("en");
    byPhrase.set(key, [...(byPhrase.get(key) ?? []), source.id]);
  }
  for (const ids of byPhrase.values()) {
    if (ids.length > 1) result.warnings.push({ code: "duplicate_phrase", ids });
  }
  if (scene.freeTextKo.trim()) result.unresolved.push({ kind: "free_text", text: scene.freeTextKo });
  const emitted = new Set<string>();
  const phrases = result.sources
    .filter((source) => {
      const key = source.text.toLocaleLowerCase("en");
      if (emitted.has(key)) return false;
      emitted.add(key);
      return true;
    })
    .map((source) => source.text);
  // Natural-language models receive their mapped phrases as a sentence fragment;
  // do not invent subjects, relationships or a translation of free text.
  const natural = naturalLanguageFamilies.includes(scene.targetFamily);
  result.draft = phrases.join(natural ? "; " : ", ");
  if (!scene.selections.length && !scene.freeTextKo.trim()) result.warnings.push({ code: "empty", ids: [] });

  if (Array.from(result.draft).length > DRAFT_LIMIT) {
    result.warnings.push({ code: "over_limit", ids: [], detail: `${Array.from(result.draft).length}/${DRAFT_LIMIT}` });
  }
  if (scene.selections.length > SELECTION_LIMIT) {
    result.warnings.push({ code: "over_limit", ids: [], detail: `${scene.selections.length}/${SELECTION_LIMIT} selections` });
  }
  // Only sd15 gets the 77-token hint; the natural-language families have much
  // larger context windows and a generic warning there would be noise.
  if (scene.targetFamily === "sd15" && result.draft) {
    const tokens = estimateTokens(result.draft);
    if (tokens > SD15_TOKEN_WINDOW) {
      result.warnings.push({ code: "token_budget", ids: [], detail: `~${tokens}/${SD15_TOKEN_WINDOW}` });
    }
  }
  return result;
}

