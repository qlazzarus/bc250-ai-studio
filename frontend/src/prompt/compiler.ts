import type { SceneSpecification, SelectionSnapshot } from "./scene";

export const COMPILER_VERSION = "1.1.0";

type Source = { id: string; labelKo: string; dictionaryVersion: string; text: string };
type Warning = { code: "conflict" | "duplicate" | "unsupported_family" | "empty"; ids: string[] };
export type CompileResult = {
  compilerVersion: string;
  targetFamily: string;
  draft: string;
  sources: Source[];
  unresolved: { kind: "selection" | "free_text"; id?: string; text: string }[];
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

function order(selection: SelectionSnapshot): number {
  const category = categoryAliases[selection.category] ?? selection.category;
  const index = categories.indexOf(category);
  return index < 0 ? categories.length : index;
}

/** Pure compilation of frozen selection values. Free text is returned unresolved. */
export function compileScene(scene: SceneSpecification): CompileResult {
  const result: CompileResult = {
    compilerVersion: COMPILER_VERSION, targetFamily: scene.targetFamily, draft: "",
    sources: [], unresolved: [], warnings: [],
  };
  const knownFamily = ["sd15", "z-image", "flux2", "moss-image"].includes(scene.targetFamily);
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
  if (scene.freeTextKo.trim()) result.unresolved.push({ kind: "free_text", text: scene.freeTextKo });
  const phrases = result.sources.map((source) => source.text);
  // Natural-language models receive their mapped phrases as a sentence fragment;
  // do not invent subjects, relationships or a translation of free text.
  result.draft = scene.targetFamily === "sd15" ? phrases.join(", ") : phrases.join("; ");
  if (!scene.selections.length && !scene.freeTextKo.trim()) result.warnings.push({ code: "empty", ids: [] });
  return result;
}
