import type { DictionaryEntry, Mapping } from "./dictionary";

export type SelectionSnapshot = {
  id: string;
  category: string;
  labelKo: string;
  dictionaryVersion: string;
  mapping: Mapping;
};
export type SceneSpecification = {
  schemaVersion: 1;
  targetFamily: string;
  selections: SelectionSnapshot[];
  freeTextKo: string;
};

/** Selections capture their value; later dictionary edits do not change a scene. */
export function selectEntry(scene: SceneSpecification, entry: DictionaryEntry, dictionaryVersion: string): SceneSpecification {
  if (!entry.active || scene.selections.some((item) => item.id === entry.id)) return scene;
  const mapping = Object.hasOwn(entry.mappings, scene.targetFamily)
    ? entry.mappings[scene.targetFamily as keyof typeof entry.mappings]
    : { status: "unavailable" as const };
  return { ...scene, selections: [...scene.selections, {
    id: entry.id, category: entry.category, labelKo: entry.labelKo, dictionaryVersion,
    mapping: mapping.status === "mapped" ? { status: "mapped", text: mapping.text } : { status: "unavailable" },
  }] };
}

export function removeEntry(scene: SceneSpecification, id: string): SceneSpecification {
  return { ...scene, selections: scene.selections.filter((item) => item.id !== id) };
}

/** A model-family change requires explicit rebinding; never reuse old family mappings. */
export function changeSceneFamily(
  scene: SceneSpecification, targetFamily: string, dictionary: DictionaryEntry[], dictionaryVersion: string,
): SceneSpecification {
  let next: SceneSpecification = { ...scene, targetFamily, selections: [] };
  for (const previous of scene.selections) {
    const entry = dictionary.find((item) => item.id === previous.id && item.active);
    if (entry) {
      next = selectEntry(next, entry, dictionaryVersion);
    } else {
      next = { ...next, selections: [...next.selections, { ...previous, mapping: { status: "unavailable" } }] };
    }
  }
  return next;
}
