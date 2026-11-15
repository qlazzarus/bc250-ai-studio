import type { PromptComposition } from "../api";
import { compileScene, type CompileResult } from "./compiler";
import type { SceneSpecification } from "./scene";

export type PromptBuilderState = { scene: SceneSpecification; result: CompileResult | null; generatedFrom: string | null; applied: PromptComposition | null };
export const initialBuilderState: PromptBuilderState = {
  scene: { schemaVersion: 1, targetFamily: "", selections: [], freeTextKo: "" }, result: null, generatedFrom: null, applied: null,
};

/** Restore the captured values without looking them up in the current dictionary. */
export function restoreComposition(composition: PromptComposition): PromptBuilderState {
  const scene: SceneSpecification = {
    schemaVersion: 1, targetFamily: composition.target_family, freeTextKo: composition.free_text_ko,
    selections: composition.selections.map((item) => ({
      id: item.id, category: item.category, labelKo: item.label_ko, dictionaryVersion: item.dictionary_version,
      mapping: item.mapping_status === "mapped" && item.rendered !== null
        ? { status: "mapped", text: item.rendered } : { status: "unavailable" },
    })),
  };
  return { scene, result: { ...compileScene(scene), draft: composition.draft_prompt,
    compilerVersion: composition.compiler_version }, generatedFrom: JSON.stringify(scene), applied: composition };
}
