import type { PromptComposition } from "../api";
import type { CompileResult } from "./compiler";
import type { SceneSpecification } from "./scene";

export type FreeTextMode = "separate" | "verbatim";
export type PromptBuilderState = {
  scene: SceneSpecification; result: CompileResult | null; generatedFrom: string | null;
  applied: PromptComposition | null; freeTextMode: FreeTextMode; generatedMode: FreeTextMode | null;
  provenance: "current" | "saved"; appliedScene: string | null; appliedPrompt: string | null;
};
export const initialBuilderState: PromptBuilderState = {
  scene: { schemaVersion: 1, targetFamily: "", selections: [], freeTextKo: "" }, result: null, generatedFrom: null, applied: null,
  freeTextMode: "separate", generatedMode: null, provenance: "current", appliedScene: null, appliedPrompt: null,
};

export function isDraftStale(state: PromptBuilderState): boolean {
  return state.result !== null && (JSON.stringify(state.scene) !== state.generatedFrom || state.freeTextMode !== state.generatedMode);
}

/** Compose from fresh compiler output, never from the editable final prompt. */
export function withGeneratedDraft(state: PromptBuilderState, result: CompileResult): PromptBuilderState {
  const raw = state.scene.freeTextKo;
  const draft = state.freeTextMode === "verbatim" && raw.length
    ? (result.draft ? `${result.draft}\n${raw}` : raw) : result.draft;
  return { ...state, result: { ...result, draft }, generatedFrom: JSON.stringify(state.scene),
    generatedMode: state.freeTextMode, provenance: "current" };
}

export function draftComposition(state: PromptBuilderState): PromptComposition | null {
  if (!state.result) return null;
  return {
    schema_version: 1, compiler_version: state.result.compilerVersion, target_family: state.scene.targetFamily,
    selections: state.scene.selections.map((item) => ({ id: item.id, category: item.category, label_ko: item.labelKo,
      dictionary_version: item.dictionaryVersion, mapping_status: item.mapping.status,
      rendered: item.mapping.status === "mapped" ? item.mapping.text : null })),
    free_text_ko: state.scene.freeTextKo, draft_prompt: state.result.draft, unresolved: state.result.unresolved,
  };
}

export function withAppliedDraft(state: PromptBuilderState, appliedPrompt = state.result?.draft ?? ""): PromptBuilderState {
  if (!state.result || isDraftStale(state)) return state;
  return { ...state, applied: draftComposition(state), appliedScene: JSON.stringify(state.scene), appliedPrompt };
}

export function applicationStatus(state: PromptBuilderState, prompt: string) {
  return {
    selectionChanged: state.applied !== null && JSON.stringify(state.scene) !== state.appliedScene,
    promptModified: state.appliedPrompt !== null && prompt !== state.appliedPrompt,
    historicalApplicationUnknown: state.applied !== null && state.appliedPrompt === null,
  };
}

/** The approved snapshot only describes the model family it was compiled for. */
export function appliedForFamily(state: PromptBuilderState, family: string, supported = true): PromptComposition | null {
  return supported && state.applied && state.applied.target_family === family ? state.applied : null;
}

/** Restore recorded facts only. Warnings/sources/application method were not recorded. */
export function restoreComposition(composition: PromptComposition): PromptBuilderState {
  const scene: SceneSpecification = {
    schemaVersion: 1, targetFamily: composition.target_family, freeTextKo: composition.free_text_ko,
    selections: composition.selections.map((item) => ({
      id: item.id, category: item.category, labelKo: item.label_ko, dictionaryVersion: item.dictionary_version,
      mapping: item.mapping_status === "mapped" && item.rendered !== null
        ? { status: "mapped", text: item.rendered } : { status: "unavailable" },
    })),
  };
  return { ...initialBuilderState, scene, result: { draft: composition.draft_prompt,
    compilerVersion: composition.compiler_version, targetFamily: composition.target_family,
    unresolved: composition.unresolved, warnings: [], sources: [] }, generatedFrom: JSON.stringify(scene),
    generatedMode: "separate", provenance: "saved", appliedScene: JSON.stringify(scene), applied: composition };
}
